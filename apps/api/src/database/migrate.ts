/* CLI: apply pending migrations. Usage: node dist/database/migrate.js */
import { createDb, migrateToLatest } from './connection';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = createDb(url, 1);
  try {
    const applied = await migrateToLatest(db);
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database is up to date');
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
