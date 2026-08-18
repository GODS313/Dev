export async function onRequestGet() {
  return Response.json(
    { ok: true, service: "hamkare-web", status: "healthy" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
