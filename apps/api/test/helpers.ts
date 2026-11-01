import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { APP_CONFIG, type AppConfig } from '../src/config/env';
import { createDb, migrateToLatest } from '../src/database/connection';
import { seedDatabase } from '../src/database/seed-data';

export const TEST_PASSWORD = 'integration-test-password';
export const WEB_ORIGIN = 'http://localhost:3000';

const adminUrl =
  process.env.TEST_DATABASE_ADMIN_URL ??
  'postgres://latex_cloud:latex_cloud@localhost:5432/postgres';

/** Creates an isolated, migrated and seeded database for one test file. */
export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `lc_test_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const db = createDb(url.toString(), 2);
  await migrateToLatest(db);
  await seedDatabase(db, TEST_PASSWORD);
  await db.destroy();

  return {
    url: url.toString(),
    drop: async () => {
      const c = new Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

export async function createTestApp(databaseUrl: string): Promise<NestExpressApplication> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    // Deliberately unreachable: readiness must report these as down, not hang.
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:1',
    S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:1',
    S3_BUCKET: 'latex-cloud-test',
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test-secret',
    WEB_ORIGIN,
    LOGIN_RATE_LIMIT_PER_15M: '5',
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app, app.get<AppConfig>(APP_CONFIG));
  await app.init();
  return app;
}
