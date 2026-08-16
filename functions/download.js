const DEFAULT_UPSTREAM = 'https://seskia.online/est/download';
const DEFAULT_ALLOWED_HOSTS = new Set(['seskia.online', 'www.seskia.online']);

function allowedHosts(env) {
  const hosts = new Set(DEFAULT_ALLOWED_HOSTS);
  for (const value of String(env.APK_ALLOWED_HOSTS || '').split(',')) {
    const host = value.trim().toLowerCase();
    if (/^[a-z0-9.-]+$/.test(host)) hosts.add(host);
  }
  return hosts;
}

function safeUpstream(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.has(url.hostname.toLowerCase()) ? url.href : '';
  } catch {
    return '';
  }
}

async function fetchAllowed(startUrl, hosts) {
  let currentUrl = startUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Hamkare-Download-Gateway/2.0',
        Accept: 'application/vnd.android.package-archive,application/octet-stream;q=0.9,*/*;q=0.5',
      },
      cf: { cacheEverything: true, cacheTtl: 300 },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 3) return null;
      const location = response.headers.get('Location');
      if (!location) return null;
      const nextUrl = safeUpstream(new URL(location, currentUrl).href, hosts);
      if (!nextUrl) return null;
      currentUrl = nextUrl;
      continue;
    }
    if (response.url && !safeUpstream(response.url, hosts)) return null;
    return response;
  }
  return null;
}

export async function onRequestGet({ env }) {
  const hosts = allowedHosts(env);
  const configured = safeUpstream(String(env.APK_DOWNLOAD_URL || '').trim(), hosts);
  const fallback = safeUpstream(DEFAULT_UPSTREAM, hosts);
  const upstreams = [...new Set([configured, fallback].filter(Boolean))];
  for (const url of upstreams) {
    try {
      const response = await fetchAllowed(url, hosts);
      if (!response) continue;
      if (!response.ok || !response.body) continue;
      const type = (response.headers.get('Content-Type') || '').toLowerCase();
      if (type.includes('text/html') || type.includes('application/json')) continue;
      const rawLength = response.headers.get('Content-Length') || '';
      if (!/^\d+$/.test(rawLength)) continue;
      const length = Number(rawLength);
      if (!Number.isSafeInteger(length) || length <= 0 || length > 200 * 1024 * 1024) continue;
      const filename = String(env.APK_FILENAME || 'hamkare.apk').replace(/[^A-Za-z0-9._-]/g, '') || 'hamkare.apk';
      const headers = new Headers({
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-site',
      });
      headers.set('Content-Length', String(length));
      return new Response(response.body, { status: 200, headers });
    } catch (error) {
      console.error('download upstream failed', error instanceof Error ? error.name : 'unknown');
    }
  }
  return new Response('دانلود موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.', {
    status: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '60',
    },
  });
}
