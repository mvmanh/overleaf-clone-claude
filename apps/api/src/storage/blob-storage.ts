import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { S3 } from '../health/dependencies';

/** Object storage abstraction (ADR-0006). Keys are internal; never user-chosen. */
export interface BlobStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Promise<{ stream: Readable; size: number | undefined }>;
}

export const BLOB_STORAGE = Symbol('BLOB_STORAGE');

@Injectable()
export class S3BlobStorage implements BlobStorage {
  constructor(
    @Inject(S3) private readonly s3: S3Client,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async getStream(key: string): Promise<{ stream: Readable; size: number | undefined }> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
    );
    return { stream: res.Body as Readable, size: res.ContentLength };
  }
}
