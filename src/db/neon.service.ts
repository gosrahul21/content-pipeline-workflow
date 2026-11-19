import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { config } from '../config/env.js';
import { Post, PostStatus } from '../types/post.types.js';

export class NeonDbService {
  private sql: NeonQueryFunction<false, false> | null = null;
  private isInitialized = false;

  constructor() {
    this.initClient();
  }

  private initClient() {
    if (config.db.url) {
      this.sql = neon(config.db.url);
      console.log('[NeonDb] Initialized serverless Neon Postgres client');
    }
  }

  public isAvailable(): boolean {
    return Boolean(config.db.url && this.sql);
  }

  /**
   * Initializes the table schema in Neon if not exists.
   */
  public async ensureSchema(): Promise<void> {
    if (!this.sql || this.isInitialized) return;

    try {
      await this.sql`
        CREATE TABLE IF NOT EXISTS posts (
          id UUID PRIMARY KEY,
          source_tweet_id TEXT,
          original_text TEXT,
          content TEXT NOT NULL,
          media JSONB DEFAULT '[]'::jsonb,
          status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
          platform VARCHAR(50) NOT NULL DEFAULT 'LINKEDIN',
          scheduled_at TIMESTAMPTZ,
          published_at TIMESTAMPTZ,
          linkedin_post_urn TEXT,
          error TEXT,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      await this.sql`CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);`;
      await this.sql`CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at);`;
      await this.sql`CREATE INDEX IF NOT EXISTS idx_posts_source_tweet_id ON posts(source_tweet_id);`;

      this.isInitialized = true;
      console.log('[NeonDb] Schema verified (table "posts" and indices ready)');
    } catch (err: any) {
      console.error('[NeonDb] Failed to verify schema:', err.message);
    }
  }

  public async savePost(post: Post): Promise<Post> {
    if (!this.sql) throw new Error('Neon DB is not configured');
    await this.ensureSchema();

    const now = new Date().toISOString();
    post.updatedAt = now;

    await this.sql`
      INSERT INTO posts (
        id, source_tweet_id, original_text, content, media, status,
        platform, scheduled_at, published_at, linkedin_post_urn, error,
        metadata, created_at, updated_at
      ) VALUES (
        ${post.id},
        ${post.sourceTweetId || null},
        ${post.originalText || null},
        ${post.content},
        ${JSON.stringify(post.media || [])}::jsonb,
        ${post.status},
        ${post.platform || 'LINKEDIN'},
        ${post.scheduledAt || null},
        ${post.publishedAt || null},
        ${post.linkedinPostUrn || null},
        ${post.error || null},
        ${JSON.stringify(post.metadata || {})}::jsonb,
        ${post.createdAt || now},
        ${now}
      )
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        media = EXCLUDED.media,
        status = EXCLUDED.status,
        scheduled_at = EXCLUDED.scheduled_at,
        published_at = EXCLUDED.published_at,
        linkedin_post_urn = EXCLUDED.linkedin_post_urn,
        error = EXCLUDED.error,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at;
    `;

    return post;
  }

  public async findById(id: string): Promise<Post | undefined> {
    if (!this.sql) return undefined;
    await this.ensureSchema();

    const rows = await this.sql`
      SELECT * FROM posts WHERE id = ${id} LIMIT 1;
    `;

    if (rows.length === 0) return undefined;
    return this.mapRowToPost(rows[0]);
  }

  public async findBySourceTweetId(tweetId: string): Promise<Post | undefined> {
    if (!this.sql) return undefined;
    await this.ensureSchema();

    const rows = await this.sql`
      SELECT * FROM posts WHERE source_tweet_id = ${tweetId} LIMIT 1;
    `;

    if (rows.length === 0) return undefined;
    return this.mapRowToPost(rows[0]);
  }

  public async listAll(filter?: { status?: PostStatus }): Promise<Post[]> {
    if (!this.sql) return [];
    await this.ensureSchema();

    let rows;
    if (filter?.status) {
      rows = await this.sql`
        SELECT * FROM posts WHERE status = ${filter.status} ORDER BY created_at DESC;
      `;
    } else {
      rows = await this.sql`
        SELECT * FROM posts ORDER BY created_at DESC;
      `;
    }

    return rows.map((r) => this.mapRowToPost(r));
  }

  public async findDueScheduledPosts(now: Date = new Date()): Promise<Post[]> {
    if (!this.sql) return [];
    await this.ensureSchema();

    const nowIso = now.toISOString();
    const rows = await this.sql`
      SELECT * FROM posts
      WHERE status = 'SCHEDULED' AND scheduled_at IS NOT NULL AND scheduled_at <= ${nowIso}
      ORDER BY scheduled_at ASC;
    `;

    return rows.map((r) => this.mapRowToPost(r));
  }

  public async delete(id: string): Promise<boolean> {
    if (!this.sql) return false;
    await this.ensureSchema();

    await this.sql`DELETE FROM posts WHERE id = ${id};`;
    return true;
  }

  private mapRowToPost(row: any): Post {
    return {
      id: row.id,
      sourceTweetId: row.source_tweet_id || undefined,
      originalText: row.original_text || undefined,
      content: row.content,
      media: typeof row.media === 'string' ? JSON.parse(row.media) : row.media || [],
      status: row.status,
      platform: row.platform,
      scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : undefined,
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : undefined,
      linkedinPostUrn: row.linkedin_post_urn || undefined,
      error: row.error || undefined,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}

export const neonDbService = new NeonDbService();
