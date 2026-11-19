import { postStore } from '../db/post.store.js';
import { Post } from '../types/post.types.js';

export interface DeduplicationResult {
  isDuplicate: boolean;
  prefix: string; // Characters checked
  matchedPost?: {
    id: string;
    linkedinPostUrn?: string;
    url?: string; // Direct link to the post on LinkedIn
    snippet: string;
    publishedAt?: string;
    status: string;
  };
  suggestedAction: 'PASS_TO_AI_PIPELINE' | 'ROUTE_TO_HUMAN_SUPERVISION';
  reason?: string;
}

export interface BatchDeduplicationResult {
  totalChecked: number;
  passedCount: number;
  duplicateCount: number;
  passed: Array<{ id?: string; content: string; metadata?: any }>;
  duplicates: Array<{
    id?: string;
    content: string;
    metadata?: any;
    duplicateInfo: DeduplicationResult;
  }>;
}

export class LinkedInDeduplicationService {
  private customSeedArchive: Array<{ text: string; id?: string; linkedinUrn?: string }> = [];

  /**
   * Normalize text by collapsing whitespace and trimming
   */
  public normalizeText(text: string): string {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Extract prefix characters of post content (default 50 chars)
   */
  public extractPrefix(text: string, length = 50): string {
    const normalized = this.normalizeText(text);
    return normalized.substring(0, length);
  }

  public extract50Chars(text: string): string {
    return this.extractPrefix(text, 50);
  }

  public extract80Chars(text: string): string {
    return this.extractPrefix(text, 80);
  }

  /**
   * Check if a single post content already exists on LinkedIn
   * Matches the first 50 characters against published/scheduled posts
   */
  public async checkDuplicate(candidateContent: string): Promise<DeduplicationResult> {
    const prefix = this.extract80Chars(candidateContent);

    if (prefix.length < 10) {
      // Content too short to reliably deduplicate by 50 chars, pass through
      return {
        isDuplicate: false,
        prefix,
        suggestedAction: 'PASS_TO_AI_PIPELINE',
      };
    }

    // 1. Check against our published & scheduled posts database
    const allPosts = postStore.listAll();
    const relevantPosts = allPosts.filter(
      (p) => p.status === 'PUBLISHED' || p.status === 'SCHEDULED' || p.status === 'PUBLISHING'
    );

    for (const post of relevantPosts) {
      const existingPrefix = this.extract80Chars(post.content);
      if (existingPrefix === prefix) {
        const url = post.linkedinPostUrn
          ? `https://www.linkedin.com/feed/update/${post.linkedinPostUrn}`
          : undefined;

        return {
          isDuplicate: true,
          prefix,
          matchedPost: {
            id: post.id,
            linkedinPostUrn: post.linkedinPostUrn,
            url,
            snippet: post.content.substring(0, 100),
            publishedAt: post.publishedAt,
            status: post.status,
          },
          suggestedAction: 'ROUTE_TO_HUMAN_SUPERVISION',
          reason: `Matches characters of post ${post.id}`,
        };
      }
    }

    // 2. Check against any custom seeded external LinkedIn post archive
    for (const seed of this.customSeedArchive) {
      const seedPrefix = this.extract80Chars(seed.text);
      if (seedPrefix === prefix) {
        const url = seed.linkedinUrn
          ? `https://www.linkedin.com/feed/update/${seed.linkedinUrn}`
          : undefined;

        return {
          isDuplicate: true,
          prefix,
          matchedPost: {
            id: seed.id || 'seed-archive',
            linkedinPostUrn: seed.linkedinUrn,
            url,
            snippet: seed.text.substring(0, 100),
            status: 'PUBLISHED',
          },
          suggestedAction: 'ROUTE_TO_HUMAN_SUPERVISION',
          reason: 'Matches characters of external LinkedIn post history',
        };
      }
    }

    return {
      isDuplicate: false,
      prefix,
      suggestedAction: 'PASS_TO_AI_PIPELINE',
    };
  }

  /**
   * Batch deduplication for incoming feed of posts (e.g. 30 posts from X)
   * Splits posts into 'passed' and 'duplicates' for human supervision
   */
  public async checkBatch(
    posts: Array<{ id?: string; content: string; metadata?: any }>
  ): Promise<BatchDeduplicationResult> {
    const passed: Array<{ id?: string; content: string; metadata?: any }> = [];
    const duplicates: Array<{
      id?: string;
      content: string;
      metadata?: any;
      duplicateInfo: DeduplicationResult;
    }> = [];

    for (const post of posts) {
      const result = await this.checkDuplicate(post.content);

      if (result.isDuplicate) {
        duplicates.push({
          ...post,
          duplicateInfo: result,
        });
      } else {
        passed.push(post);
      }
    }

    return {
      totalChecked: posts.length,
      passedCount: passed.length,
      duplicateCount: duplicates.length,
      passed,
      duplicates,
    };
  }

  /**
   * Seed historical LinkedIn posts if you want to import past posts
   */
  public seedExternalPosts(posts: Array<{ text: string; id?: string; linkedinUrn?: string }>) {
    this.customSeedArchive.push(...posts);
    console.log(`[LinkedInDeduplicationService] Seeded ${posts.length} historical LinkedIn posts.`);
  }
}

export const linkedInDeduplicationService = new LinkedInDeduplicationService();
