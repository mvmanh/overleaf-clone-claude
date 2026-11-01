/* CLI: seed development users/projects. Usage: node dist/database/seed.js */
import { MIN_PASSWORD_LENGTH } from '../auth/password-hasher';
import { createDb } from './connection';
import { SEED_USERS, seedDatabase } from './seed-data';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to seed development data with NODE_ENV=production');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const password = process.env.SEED_USER_PASSWORD ?? 'latex-cloud-dev-password';
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_USER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const db = createDb(url, 1);
  try {
    await seedDatabase(db, password);
    console.log(`seeded ${SEED_USERS.length} users: ${SEED_USERS.map((u) => u.email).join(', ')}`);
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
