import { migrate } from './migrate.js';

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('DATABASE_MIGRATION_URL is required (role millerenos_owner).');
  process.exit(1);
}
migrate(url, (m) => console.log(m))
  .then((applied) => console.log(applied.length ? `applied ${applied.length} migration(s)` : 'schema up to date'))
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
