// Shared helpers for the new CMS/media endpoints. Kept separate from the
// existing api/admin/config.js and api/admin/sync.js on purpose: those two
// files are the production-critical token/chat-id path and are left untouched.

export const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  },
});

export function constantTimeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export function requireAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  return constantTimeEqual(request.headers.get('X-Admin-Key') || '', env.ADMIN_PASSWORD || '');
}
