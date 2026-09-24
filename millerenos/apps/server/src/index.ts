import { loadConfig } from './config.js';
import { buildApp } from './http/app.js';
import { createLogger } from './logger.js';
import { createServices } from './services.js';

const cfg = loadConfig();
const log = createLogger(cfg.LOG_LEVEL);
const services = await createServices(cfg, log);
const app = await buildApp(services);

await app.listen({ port: cfg.PORT, host: cfg.HOST });
log.info({ env: cfg.NODE_ENV, bot: Boolean(services.handleUpdate), ai: services.ai.id }, 'millerenos server started');

let closing = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    log.info({ sig }, 'shutting down');
    const timer = setTimeout(() => process.exit(1), 10_000);
    await app.close();
    await services.db.close();
    clearTimeout(timer);
    process.exit(0);
  });
}
