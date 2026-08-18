const APK_ORIGIN_URL = 'https://seskia.online/download.php?src=hamkare';

export async function onRequest({ request }) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const upstream = await fetch(APK_ORIGIN_URL, {
    method: request.method,
    headers: request.headers.has('Range') ? { Range: request.headers.get('Range') } : {},
    redirect: 'follow',
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!upstream.ok && upstream.status !== 206) {
    return new Response('دانلود موقتاً در دسترس نیست.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const headers = new Headers(upstream.headers);
  headers.set('Content-Type', 'application/vnd.android.package-archive');
  headers.set('Content-Disposition', 'attachment; filename="hamkare.apk"');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.delete('Set-Cookie');
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}
