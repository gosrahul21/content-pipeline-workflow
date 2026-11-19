import { Request, Response } from 'express';
import { postService } from '../services/post.service.js';
import { linkedInDeduplicationService } from '../services/linkedin-dedup.service.js';
import { sqsService, SqsPostMessage } from '../services/sqs.service.js';
import { sqsProcessorService } from '../services/sqs-processor.service.js';
import { config } from '../config/env.js';
import { BatchScheduleDTO, CreatePostDTO } from '../types/post.types.js';

export class PostController {
  public async create(req: Request, res: Response) {
    try {
      const { content, media, scheduledAt, publishNow, sourceTweetId, originalText, metadata } = req.body;

      if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'content is required and must be a string' });
      }

      const dto: CreatePostDTO = {
        content,
        media,
        scheduledAt,
        publishNow: Boolean(publishNow),
        sourceTweetId,
        originalText,
        metadata,
      };

      const post = await postService.createPost(dto);
      return res.status(201).json({ success: true, post });
    } catch (err: any) {
      console.error('[PostController] Error creating post:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public async scheduleBatch(req: Request, res: Response) {
    try {
      const { postIds, posts, windowStart, windowEnd, targetDate, minGapMinutes, jitterMinutes } = req.body;

      if (!windowStart || !windowEnd) {
        return res.status(400).json({
          error: 'windowStart (e.g. "09:00") and windowEnd (e.g. "21:00") are required',
        });
      }

      if ((!postIds || postIds.length === 0) && (!posts || posts.length === 0)) {
        return res.status(400).json({
          error: 'Either postIds (array of strings) or posts (array of new post objects) must be provided',
        });
      }

      const dto: BatchScheduleDTO = {
        postIds,
        posts,
        windowStart,
        windowEnd,
        targetDate,
        minGapMinutes: minGapMinutes ? Number(minGapMinutes) : undefined,
        jitterMinutes: jitterMinutes ? Number(jitterMinutes) : undefined,
      };

      const scheduled = await postService.scheduleBatch(dto);
      return res.status(200).json({
        success: true,
        count: scheduled.length,
        posts: scheduled,
      });
    } catch (err: any) {
      console.error('[PostController] Error scheduling batch:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  public async publishNow(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const post = await postService.publishPostNow(id);
      return res.status(200).json({ success: true, post });
    } catch (err: any) {
      console.error(`[PostController] Error publishing post ${req.params.id}:`, err);
      return res.status(500).json({ error: err.message });
    }
  }

  public async reschedule(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { scheduledAt } = req.body;

      if (!scheduledAt) {
        return res.status(400).json({ error: 'scheduledAt (ISO date string) is required' });
      }

      const post = await postService.reschedule(id, scheduledAt);
      return res.status(200).json({ success: true, post });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  public async cancel(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const post = await postService.cancel(id);
      return res.status(200).json({ success: true, post });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  public async getById(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const post = postService.getPost(id);
      if (!post) {
        return res.status(404).json({ error: 'Post not found' });
      }
      return res.status(200).json({ post });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  public async list(req: Request, res: Response) {
    try {
      const { status } = req.query;
      const posts = postService.listPosts(status as any);
      return res.status(200).json({ count: posts.length, posts });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  public async checkDuplicate(req: Request, res: Response) {
    try {
      const { content } = req.body;
      if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'content is required and must be a string' });
      }

      const result = await linkedInDeduplicationService.checkDuplicate(content);
      return res.status(200).json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  public async checkBatchDuplicates(req: Request, res: Response) {
    try {
      const { posts } = req.body;
      if (!posts || !Array.isArray(posts)) {
        return res.status(400).json({ error: 'posts is required and must be an array' });
      }

      const result = await linkedInDeduplicationService.checkBatch(posts);
      return res.status(200).json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Endpoint for Chrome Extension to publish scraped post(s) to AWS SQS.
   * Accepts:
   * - Single post: { content: string, media?: [...], author?: string, isDuplicate?: boolean, ... }
   * - Batch wrapper: { source: string, extractedAt: string, posts: [...] }
   * - Raw array of posts: [ { content: string, ... }, ... ]
   */
  public async publishToSqs(req: Request, res: Response) {
    try {
      const body = req.body;

      // Normalize into array of posts
      let rawPosts: any[] = [];
      if (Array.isArray(body)) {
        rawPosts = body;
      } else if (body.posts && Array.isArray(body.posts)) {
        rawPosts = body.posts;
      } else if (body.content) {
        rawPosts = [body];
      } else {
        return res.status(400).json({
          error: 'Invalid request payload. Expected "content" for a single post or "posts" array for a batch.',
        });
      }

      if (rawPosts.length === 0) {
        return res.status(400).json({ error: 'No posts provided in payload.' });
      }

      // Map to SqsPostMessage format
      const sqsPosts: SqsPostMessage[] = rawPosts.map((p) => ({
        id: p.id,
        source: p.source || body.source || 'chrome_extension',
        content: p.content,
        author: p.author || p.authorHandle,
        authorName: p.authorName,
        originalTweetId: p.originalTweetId || p.sourceTweetId || p.tweetId,
        media: p.media,
        metrics: p.metrics,
        isDuplicate: Boolean(p.isDuplicate),
        existingLinkedInUrl: p.existingLinkedInUrl || null,
        suggestedAction: p.suggestedAction || (p.isDuplicate ? 'RE_IMPROVISE' : 'DIRECT_SCHEDULE'),
        skipAiFilter: Boolean(p.skipAiFilter || body.skipAiFilter),
        extractedAt: p.extractedAt || body.extractedAt || new Date().toISOString(),
        metadata: p.metadata,
      }));

      // Validate presence of content in all posts
      const invalid = sqsPosts.find((p) => !p.content || typeof p.content !== 'string');
      if (invalid) {
        return res.status(400).json({
          error: 'Every post must contain a non-empty string "content"',
        });
      }

      // Check if mock mode requested via query or body
      const isMock = req.query.mock === 'true' || Boolean(body.mock);

      // If single post received
      if (sqsPosts.length === 1) {
        // Trigger AI processing in background
        sqsProcessorService.processSqsPost(sqsPosts[0]).catch((err) => {
          console.error('[Ingest] Single post AI processing error:', err.message);
        });

        let result;
        try {
          result = await sqsService.publishPost(sqsPosts[0], isMock);
        } catch (sqsErr: any) {
          result = {
            success: true,
            messageId: `local-${Date.now()}`,
            queueUrl: config.aws.sqsQueueUrl,
            post: sqsPosts[0],
            mock: true,
            warning: sqsErr.message,
          };
        }

        return res.status(200).json({
          success: true,
          type: 'SINGLE',
          messageId: result.messageId,
          queueUrl: result.queueUrl,
          post: result.post,
          mock: result.mock,
        });
      }

      // If batch of posts received (e.g. 30 scraped items from Chrome Extension)
      console.log(`[Ingest] Received batch of ${sqsPosts.length} posts. Launching AI Filtration & Top-3 Selection...`);
      
      // 1. Immediately trigger the AI Filtration & Top-3 Selection pipeline
      sqsProcessorService.rankAndSelectTopPosts(sqsPosts, 3).catch((err) => {
        console.error('[Ingest] AI Filtration & Top-3 Selection error:', err.message);
      });

      // 2. Queue into AWS SQS buffer (falls back smoothly if AWS IAM permission is pending)
      let batchResult;
      try {
        batchResult = await sqsService.publishBatch(sqsPosts, isMock);
      } catch (sqsErr: any) {
        console.warn(`[Ingest] AWS SQS buffer warning (bypassed to AI Filtration): ${sqsErr.message}`);
        batchResult = {
          success: false,
          totalReceived: sqsPosts.length,
          totalPublished: 0,
          totalFailed: sqsPosts.length,
          queueUrl: config.aws.sqsQueueUrl,
          messageIds: [],
          failedEntries: [{ id: 'all', error: sqsErr.message }],
          posts: sqsPosts,
          note: 'Directly processed through AI Filtration & Top-3 Selection',
        };
      }

      return res.status(200).json({
        success: true,
        type: 'BATCH',
        message: `Successfully ingested ${sqsPosts.length} posts. AI Filtration & Top-3 Selection in progress.`,
        totalReceived: sqsPosts.length,
        totalPublished: batchResult.totalPublished,
        sqsResult: batchResult,
      });
    } catch (err: any) {
      console.error('[PostController] Error publishing to SQS:', err);
      return res.status(500).json({
        error: err.message || 'Failed to publish post to SQS',
      });
    }
  }
}

export const postController = new PostController();
