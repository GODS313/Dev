// Pre-renders the public website (apps/server/src/web) into static files for the shared-hosting edition.
// Usage: tsx lite/build/render-site.ts <outDir>   (needs DATABASE_URL / DATABASE_SYSTEM_URL of a migrated DB for plan prices)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, basePath } from '../../apps/server/src/config.js';
import { buildApp } from '../../apps/server/src/http/app.js';
import { createLogger } from '../../apps/server/src/logger.js';
import { createServices } from '../../apps/server/src/services.js';
import { PAGES } from '../../apps/server/src/web/content.js';

const out = path.resolve(process.argv[2] ?? 'lite-build/public');
const env = { ...process.env, AI_PROVIDER: 'disabled', LOG_LEVEL: 'error' };
delete env.TELEGRAM_BOT_TOKEN; // render only: no bot init
delete env.TRON_RECEIVE_ADDRESS; // crypto checkout is not part of the shared-hosting edition yet
const cfg = loadConfig(env);
const bp = basePath(cfg);
const s = await createServices(cfg, createLogger('error'));
const app = await buildApp(s, { miniappDir: '/nonexistent' });

const files: Record<string, string> = {
  '': 'index.html',
  'sitemap.xml': 'sitemap.xml',
  'sitemap-en.xml': 'sitemap-en.xml',
  'sitemap-fa.xml': 'sitemap-fa.xml',
  'robots.txt': 'robots.txt',
  'favicon.svg': 'favicon.svg',
  'assets/og.svg': 'assets/og.svg',
  '.well-known/security.txt': '.well-known/security.txt',
};
for (const l of ['en', 'fa']) for (const p of PAGES) files[`${l}/${p.path}`] = p.path ? `${l}/${p.path}.html` : `${l}/index.html`;

function write(rel: string, body: string) {
  const f = path.join(out, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, body);
}
for (const [url, file] of Object.entries(files)) {
  const res = await app.inject({ method: 'GET', url: `${bp}/${url}` });
  if (res.statusCode !== 200) throw new Error(`${url} → ${res.statusCode}`);
  write(file, res.body);
  const css = res.body.match(new RegExp(`${bp}/(assets/site\\.[a-f0-9]+\\.css)`));
  if (css && !files[css[1]!]) {
    files[css[1]!] = css[1]!;
    write(css[1]!, (await app.inject({ method: 'GET', url: `${bp}/${css[1]}` })).body);
  }
}
write('404.html', (await app.inject({ method: 'GET', url: `${bp}/en/__not_found__` })).body);
await app.close();
await s.db.close();
console.log(`rendered ${Object.keys(files).length + 1} files to ${out}`);
