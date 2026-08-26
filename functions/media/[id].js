// Public streaming route for images uploaded from the admin CMS or the master bot.
// The id doubles as the R2 object key; it is always a random UUID + known extension,
// so no path traversal is possible and no admin auth is needed to view a public image.

const ID_RE = /^[a-f0-9-]{8,64}\.(png|jpe?g|webp)$/i;

export async function onRequestGet({ params, env }) {
  const id = String(params.id || '');
  if (!env.MEDIA || !ID_RE.test(id)) return new Response('Not found', { status: 404 });

  const object = await env.MEDIA.get(id);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
}
