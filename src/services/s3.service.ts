import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { config } from '../config/env.js';

export class S3Service {
  private client: S3Client;
  private defaultBucket: string;

  constructor() {
    const s3Config: any = { region: config.aws.region };
    if (config.aws.accessKeyId && config.aws.secretAccessKey) {
      s3Config.credentials = {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      };
    }
    this.client = new S3Client(s3Config);
    this.defaultBucket = config.aws.s3Bucket;
  }

  /**
   * Fetch a media file directly from S3 as a binary Buffer
   * Does NOT require the S3 bucket to be public.
   */
  public async getFileBuffer(
    s3Key: string,
    bucketOverride?: string
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const bucket = bucketOverride || this.defaultBucket;

    // Handle Mock / Local testing fallback if bucket is not configured
    if (!bucket) {
      console.log(`[S3Service] (Mock Mode) Simulating S3 fetch for key: "${s3Key}"`);
      // Return a 1x1 transparent PNG buffer for mock uploads
      const mockBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
      );
      return {
        buffer: mockBuffer,
        contentType: 'image/png',
      };
    }

    try {
      console.log(`[S3Service] Fetching s3://${bucket}/${s3Key}`);
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: s3Key,
      });

      const response = await this.client.send(command);

      if (!response.Body) {
        throw new Error(`Empty body returned from S3 for key: ${s3Key}`);
      }

      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];

      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }

      const buffer = Buffer.concat(chunks);
      const contentType = response.ContentType || 'image/jpeg';

      console.log(`[S3Service] Successfully fetched ${buffer.length} bytes (${contentType}) from S3`);
      return { buffer, contentType };
    } catch (err: any) {
      console.error(`[S3Service] Error fetching s3://${bucket}/${s3Key}:`, err.message);
      throw err;
    }
  }

  /**
   * Save a buffer into S3 (e.g., when scraping media from X feed)
   */
  public async uploadBuffer(
    s3Key: string,
    buffer: Buffer,
    contentType: string,
    bucketOverride?: string
  ): Promise<string> {
    const bucket = bucketOverride || this.defaultBucket;

    if (!bucket) {
      console.log(`[S3Service] (Mock Mode) Simulating S3 upload for key: "${s3Key}"`);
      return `s3://mock-bucket/${s3Key}`;
    }

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
    });

    await this.client.send(command);
    console.log(`[S3Service] Uploaded s3://${bucket}/${s3Key}`);
    return `s3://${bucket}/${s3Key}`;
  }

  /**
   * Delete an object from S3 after posting if needed
   */
  public async deleteFile(s3Key: string, bucketOverride?: string): Promise<boolean> {
    const bucket = bucketOverride || this.defaultBucket;
    if (!bucket) return true;

    try {
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: s3Key,
      });
      await this.client.send(command);
      console.log(`[S3Service] Deleted s3://${bucket}/${s3Key}`);
      return true;
    } catch (err: any) {
      console.warn(`[S3Service] Failed to delete s3://${bucket}/${s3Key}:`, err.message);
      return false;
    }
  }
}

export const s3Service = new S3Service();
