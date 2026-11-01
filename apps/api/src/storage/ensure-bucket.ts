/* CLI: create the configured bucket if missing. Works with MinIO, S3 and other
 * S3-compatible stores. Usage: node dist/storage/ensure-bucket.js */
import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { loadConfig } from '../config/env';
import { createS3 } from '../health/dependencies';

async function main() {
  const config = loadConfig();
  const s3 = createS3(config);
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
        console.log(`bucket "${config.S3_BUCKET}" exists`);
        return;
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (status === 404) {
          await s3.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
          console.log(`bucket "${config.S3_BUCKET}" created`);
          return;
        }
        if (attempt >= 10) throw err;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  } finally {
    s3.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(`ensure-bucket failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
