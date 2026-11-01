import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { WorkerEnv } from './config';

export interface WorkerStorage {
  get(key: string, maxBytes: number): Promise<Buffer>;
  /** Like get, but resolves null when the object does not exist. */
  getOptional(key: string, maxBytes: number): Promise<Buffer | null>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export function createS3Storage(env: WorkerEnv): WorkerStorage & { destroy(): void } {
  const s3 = new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
  return {
    async get(key, maxBytes) {
      const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      if ((res.ContentLength ?? 0) > maxBytes)
        throw new Error('source snapshot exceeds the size limit');
      const bytes = await res.Body!.transformToByteArray();
      if (bytes.byteLength > maxBytes) throw new Error('source snapshot exceeds the size limit');
      return Buffer.from(bytes);
    },
    async getOptional(key, maxBytes) {
      try {
        return await this.get(key, maxBytes);
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (status === 404 || (err as { name?: string }).name === 'NoSuchKey') return null;
        throw err;
      }
    },
    async put(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    destroy: () => s3.destroy(),
  };
}
