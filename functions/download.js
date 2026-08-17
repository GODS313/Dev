const RELEASE_URL = 'https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk';

export async function onRequestGet() {
  return Response.redirect(RELEASE_URL, 302);
}
