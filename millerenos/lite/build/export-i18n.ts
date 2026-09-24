// Exports the bot translation catalogs (single source of truth: apps/server/src/i18n) for the PHP edition.
import { writeFileSync } from 'node:fs';
import { en } from '../../apps/server/src/i18n/en.js';
import { fa } from '../../apps/server/src/i18n/fa.js';

const out = new URL('../src/i18n.json', import.meta.url);
writeFileSync(out, JSON.stringify({ en, fa }, null, 1) + '\n');
console.log('wrote', out.pathname);
