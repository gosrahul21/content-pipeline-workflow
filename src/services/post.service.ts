import { v4 as uuidv4 } from 'uuid';
import { postStore } from '../db/post.store.js';
import { linkedInService } from './linkedin.service.js';
import { schedulerService } from './scheduler.service.js';
import { awsSchedulerService } from './aws-scheduler.service.js';
import { mediaExtractorService } from './media-extractor.service.js';
import { BatchScheduleDTO, CreatePostDTO, Post, PostStatus } from '../types/post.types.js';

export class PostService {
  constructor() {}

  /**
   * Create a new post (immediate, scheduled, or draft)
   */
  public async createPost(dto: CreatePostDTO): Promise<Post> {
    const now = new Date().toISOString();
    const id = uuidv4();

    let initialStatus: PostStatus = 'DRAFT';
    if (dto.publishNow) {
      initialStatus = 'PUBLISHING';
    } else if (dto.scheduledAt) {
      initialStatus = 'SCHEDULED';
    }

    // If remote media URLs are provided, extract and save to S3
    let processedMedia = dto.media || [];
    const needsExtraction = processedMedia.some((m) => m.url && !m.s3Key);
    if (needsExtraction) {
      console.log(`[PostService] Extracting remote media for post ${id}...`);
      processedMedia = await mediaExtractorService.extractAndStoreMedia(processedMedia as any, id);
    }

    const post: Post = {
      id,
      sourceTweetId: dto.sourceTweetId,
      originalText: dto.originalText,
      content: dto.content,
      media: processedMedia,
      status: initialStatus,
      platform: 'LINKEDIN',
      scheduledAt: dto.scheduledAt,
      metadata: dto.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    postStore.save(post);

    if (dto.publishNow) {
      return await this.publishPostNow(post);
    }

    if (post.status === 'SCHEDULED' && post.scheduledAt) {
      await awsSchedulerService.schedulePost(post.id, new Date(post.scheduledAt));
    }

    return post;
  }

  /**
   * Immediately publish a post to LinkedIn
   */
  public async publishPostNow(postOrId: Post | string): Promise<Post> {
    const post = typeof postOrId === 'string' ? postStore.findById(postOrId) : postOrId;
    if (!post) {
      throw new Error(`Post not found`);
    }

    // Set to publishing state
    post.status = 'PUBLISHING';
    postStore.save(post);

    // Safeguard: Ensure all remote media URLs are extracted and stored in S3 before publishing
    if (post.media && post.media.some((m) => m.url && !m.s3Key)) {
      console.log(`[PostService:publishPostNow] Extracting remote media to S3 before publishing post ${post.id}...`);
      post.media = await mediaExtractorService.extractAndStoreMedia(post.media as any, post.id);
      postStore.save(post);
    }

    try {
      const result = await linkedInService.publishPost(post.content, post.media);

      if (result.success && result.postUrn) {
        post.status = 'PUBLISHED';
        post.linkedinPostUrn = result.postUrn;
        post.publishedAt = new Date().toISOString();
        post.error = undefined;
        console.log(`[PostService] Post ${post.id} successfully published to LinkedIn (${result.postUrn})`);

        // As per diagram: Delete from S3 after post
        await mediaExtractorService.cleanupPostMedia(post.media);
      } else {
        post.status = 'FAILED';
        post.error = result.error || 'Failed to publish to LinkedIn';
        console.error(`[PostService] Post ${post.id} publish failed: ${post.error}`);
      }
    } catch (err: any) {
      post.status = 'FAILED';
      post.error = err.message;
      console.error(`[PostService] Exception publishing post ${post.id}:`, err);
    }

    return postStore.save(post);
  }

  /**
   * Batch schedule posts across a random window
   */
  public async scheduleBatch(dto: BatchScheduleDTO): Promise<Post[]> {
    const postsToSchedule: Post[] = [];

    // Case 1: Existing post IDs provided
    if (dto.postIds && dto.postIds.length > 0) {
      for (const id of dto.postIds) {
        const post = postStore.findById(id);
        if (post) postsToSchedule.push(post);
      }
    }

    // Case 2: New posts payload provided
    if (dto.posts && dto.posts.length > 0) {
      for (const p of dto.posts) {
        const created = await this.createPost({ ...p, publishNow: false, scheduledAt: undefined });
        postsToSchedule.push(created);
      }
    }

    if (postsToSchedule.length === 0) {
      throw new Error('No posts provided to schedule');
    }

    // Generate randomized distribution timestamps
    const timestamps = schedulerService.generateRandomSchedule(postsToSchedule.length, {
      windowStart: dto.windowStart,
      windowEnd: dto.windowEnd,
      targetDate: dto.targetDate,
      minGapMinutes: dto.minGapMinutes,
      jitterMinutes: dto.jitterMinutes,
    });

    // Assign timestamps to each post
    const updatedPosts: Post[] = [];
    for (let i = 0; i < postsToSchedule.length; i++) {
      const post = postsToSchedule[i];
      const scheduledDate = timestamps[i];
      post.scheduledAt = scheduledDate.toISOString();
      post.status = 'SCHEDULED';
      postStore.save(post);

      // Register with AWS EventBridge Scheduler (or mock log)
      await awsSchedulerService.schedulePost(post.id, scheduledDate);

      updatedPosts.push(post);
    }

    console.log(
      `[PostService] Scheduled ${updatedPosts.length} post(s) between ${dto.windowStart} and ${dto.windowEnd}`
    );
    return updatedPosts;
  }

  /**
   * Reschedule an existing post to a new time
   */
  public async reschedule(id: string, newScheduledAt: string): Promise<Post> {
    const post = postStore.findById(id);
    if (!post) throw new Error('Post not found');

    const scheduledDate = new Date(newScheduledAt);
    post.scheduledAt = scheduledDate.toISOString();
    post.status = 'SCHEDULED';
    postStore.save(post);

    // Update AWS EventBridge schedule
    await awsSchedulerService.cancelSchedule(id);
    await awsSchedulerService.schedulePost(id, scheduledDate);

    return post;
  }

  /**
   * Cancel a scheduled post
   */
  public async cancel(id: string): Promise<Post> {
    const post = postStore.findById(id);
    if (!post) throw new Error('Post not found');

    post.status = 'CANCELLED';
    postStore.save(post);

    // Cancel AWS EventBridge schedule
    await awsSchedulerService.cancelSchedule(id);

    return post;
  }

  public getPost(id: string): Post | undefined {
    return postStore.findById(id);
  }

  public listPosts(status?: any): Post[] {
    return postStore.listAll(status ? { status } : undefined);
  }
}

export const postService = new PostService();
