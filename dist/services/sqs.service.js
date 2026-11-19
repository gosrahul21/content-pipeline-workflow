import { SQSClient, SendMessageCommand, SendMessageBatchCommand, } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env.js';
class SqsService {
    client = null;
    constructor() {
        this.initClient();
    }
    initClient() {
        if (config.aws.accessKeyId && config.aws.secretAccessKey) {
            this.client = new SQSClient({
                region: config.aws.region,
                credentials: {
                    accessKeyId: config.aws.accessKeyId,
                    secretAccessKey: config.aws.secretAccessKey,
                },
            });
        }
        else {
            this.client = new SQSClient({ region: config.aws.region });
        }
    }
    /**
     * Publish a single post message to AWS SQS.
     */
    async publishPost(post, forceMock = false) {
        const queueUrl = config.aws.sqsQueueUrl;
        const postId = post.id || uuidv4();
        const enrichedPost = {
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
            const response = await this.client.send(command);
            console.log(`[SQS] Successfully published message ${response.MessageId} to ${queueUrl}`);
            return {
                success: true,
                messageId: response.MessageId || `sqs-${uuidv4()}`,
                queueUrl,
                post: enrichedPost,
            };
        }
        catch (err) {
            console.error(`[SQS] Failed to publish message to SQS:`, err.message);
            throw new Error(`AWS SQS SendMessage Error: ${err.message}`);
        }
    }
    /**
     * Publish a batch of posts to AWS SQS (chunks in batches of 10 for SQS limits).
     */
    async publishBatch(posts, forceMock = false) {
        const queueUrl = config.aws.sqsQueueUrl;
        const enrichedPosts = posts.map((p) => ({
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
        const allMessageIds = [];
        const allFailedEntries = [];
        for (let i = 0; i < enrichedPosts.length; i += CHUNK_SIZE) {
            const chunk = enrichedPosts.slice(i, i + CHUNK_SIZE);
            const entries = chunk.map((p, idx) => ({
                Id: `msg_${i + idx}_${p.id.substring(0, 8)}`,
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
                        StringValue: p.id,
                    },
                },
            }));
            try {
                const command = new SendMessageBatchCommand({
                    QueueUrl: queueUrl,
                    Entries: entries,
                });
                const response = await this.client.send(command);
                if (response.Successful) {
                    for (const s of response.Successful) {
                        if (s.MessageId)
                            allMessageIds.push(s.MessageId);
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
            }
            catch (err) {
                console.error(`[SQS] Batch chunk failed:`, err.message);
                for (const c of chunk) {
                    allFailedEntries.push({
                        id: c.id,
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
