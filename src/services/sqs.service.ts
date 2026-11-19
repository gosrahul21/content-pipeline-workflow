import {
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
  SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env.js';

export interface SqsPostMessage {
  id?: string;
  source?: string;
  content: string;
  author?: string;
  authorName?: string;
  originalTweetId?: string;
  media?: Array<{
    type: 'image' | 'video';
    url: string;
    s3Key?: string;
  }>;
  metrics?: {
    likes?: number;
    reposts?: number;
    replies?: number;
    views?: number;
  };
  isDuplicate?: boolean;
  existingLinkedInUrl?: string | null;
  suggestedAction?: 'RE_IMPROVISE' | 'DIRECT_SCHEDULE' | 'MANUAL_REVIEW';
  skipAiFilter?: boolean;
  extractedAt?: string;
  metadata?: Record<string, any>;
}

export interface SqsPublishResult {
  success: boolean;
  messageId: string;
  queueUrl: string;
  post: SqsPostMessage;
  mock?: boolean;
  error?: string;
}

export interface SqsBatchPublishResult {
  success: boolean;
  totalReceived: number;
  totalPublished: number;
  totalFailed: number;
  queueUrl: string;
  messageIds: string[];
  failedEntries: Array<{ id: string; error: string }>;
  posts: SqsPostMessage[];
  mock?: boolean;
}

class SqsService {
  private client: SQSClient | null = null;

  constructor() {
    this.initClient();
  }

  private initClient() {
    if (config.aws.accessKeyId && config.aws.secretAccessKey) {
      this.client = new SQSClient({
        region: config.aws.region,
        credentials: {
          accessKeyId: config.aws.accessKeyId,
          secretAccessKey: config.aws.secretAccessKey,
        },
      });
    } else {
      this.client = new SQSClient({ region: config.aws.region });
    }
  }

  /**
   * Publish a single post message to AWS SQS.
   */
  async publishPost(post: SqsPostMessage, forceMock = false): Promise<SqsPublishResult> {
    const queueUrl = config.aws.sqsQueueUrl;
    const postId = post.id || uuidv4();
    const enrichedPost: SqsPostMessage = {
      ...post,
      id: postId,
      source: post.source || 'chrome_extension',
      extractedAt: post.extractedAt || new Date().toISOString(),
    };

    if (config.aws.sqsMockMode || forceMock || !queueUrl) {
      const mockId = `mock-sqs-${uuidv4()}`;
      console.log(`[SQS:Mock] Enqueued post ${postId} (MessageId: ${mockId})`);
      return {
        success: true,
        messageId: mockId,
        queueUrl: queueUrl || 'mock://media-extraction-queue',
        post: enrichedPost,
        mock: true,
      };
    }

    try {
      const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(enrichedPost),
        MessageAttributes: {
          source: {
            DataType: 'String',
            StringValue: enrichedPost.source || 'chrome_extension',
          },
          isDuplicate: {
            DataType: 'String',
            StringValue: String(Boolean(enrichedPost.isDuplicate)),
          },
          postId: {
            DataType: 'String',
            StringValue: postId,
          },
        },
      });

      const response = await this.client!.send(command);
      console.log(`[SQS] Successfully published message ${response.MessageId} to ${queueUrl}`);

      return {
        success: true,
        messageId: response.MessageId || `sqs-${uuidv4()}`,
        queueUrl,
        post: enrichedPost,
      };
    } catch (err: any) {
      console.error(`[SQS] Failed to publish message to SQS:`, err.message);
      throw new Error(`AWS SQS SendMessage Error: ${err.message}`);
    }
  }

  /**
   * Publish a batch of posts to AWS SQS (chunks in batches of 10 for SQS limits).
   */
  async publishBatch(posts: SqsPostMessage[], forceMock = false): Promise<SqsBatchPublishResult> {
    const queueUrl = config.aws.sqsQueueUrl;
    const enrichedPosts: SqsPostMessage[] = posts.map((p) => ({
      ...p,
      id: p.id || uuidv4(),
      source: p.source || 'chrome_extension',
      extractedAt: p.extractedAt || new Date().toISOString(),
    }));

    if (config.aws.sqsMockMode || forceMock || !queueUrl) {
      const mockIds = enrichedPosts.map(() => `mock-sqs-${uuidv4()}`);
      console.log(`[SQS:Mock] Enqueued batch of ${enrichedPosts.length} posts to SQS`);
      return {
        success: true,
        totalReceived: posts.length,
        totalPublished: posts.length,
        totalFailed: 0,
        queueUrl: queueUrl || 'mock://media-extraction-queue',
        messageIds: mockIds,
        failedEntries: [],
        posts: enrichedPosts,
        mock: true,
      };
    }

    // SQS SendMessageBatch allows up to 10 messages per batch call
    const CHUNK_SIZE = 10;
    const allMessageIds: string[] = [];
    const allFailedEntries: Array<{ id: string; error: string }> = [];

    for (let i = 0; i < enrichedPosts.length; i += CHUNK_SIZE) {
      const chunk = enrichedPosts.slice(i, i + CHUNK_SIZE);
      const entries: SendMessageBatchRequestEntry[] = chunk.map((p, idx) => ({
        Id: `msg_${i + idx}_${p.id!.substring(0, 8)}`,
        MessageBody: JSON.stringify(p),
        MessageAttributes: {
          source: {
            DataType: 'String',
            StringValue: p.source || 'chrome_extension',
          },
          isDuplicate: {
            DataType: 'String',
            StringValue: String(Boolean(p.isDuplicate)),
          },
          postId: {
            DataType: 'String',
            StringValue: p.id!,
          },
        },
      }));

      try {
        const command = new SendMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: entries,
        });

        const response = await this.client!.send(command);

        if (response.Successful) {
          for (const s of response.Successful) {
            if (s.MessageId) allMessageIds.push(s.MessageId);
          }
        }

        if (response.Failed) {
          for (const f of response.Failed) {
            allFailedEntries.push({
              id: f.Id || 'unknown',
              error: `${f.Code}: ${f.Message}`,
            });
          }
        }
      } catch (err: any) {
        console.error(`[SQS] Batch chunk failed:`, err.message);
        for (const c of chunk) {
          allFailedEntries.push({
            id: c.id!,
            error: err.message,
          });
        }
      }
    }

    const success = allFailedEntries.length === 0;

    return {
      success,
      totalReceived: posts.length,
      totalPublished: allMessageIds.length,
      totalFailed: allFailedEntries.length,
      queueUrl,
      messageIds: allMessageIds,
      failedEntries: allFailedEntries,
      posts: enrichedPosts,
    };
  }
}

export const sqsService = new SqsService();
