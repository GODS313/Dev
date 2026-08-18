export async function onRequestGet() {
  return Response.json(
    { ok: true, service: "hamkare-web", version: "2026.08" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
