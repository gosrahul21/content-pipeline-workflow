import fs from 'fs';
import path from 'path';
import { Post, PostStatus } from '../types/post.types.js';
import { neonDbService } from './neon.service.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'posts.json');

class PostStore {
  private posts: Map<string, Post> = new Map();
  private dbInitialized = false;

  constructor() {
    this.initStorage();
  }

  private async initStorage() {
    // 1. Load local backup file first for instantaneous startup
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const list: Post[] = JSON.parse(raw);
        list.forEach((p) => this.posts.set(p.id, p));
        console.log(`[PostStore] Loaded ${this.posts.size} posts from local storage.`);
      }
    } catch (err) {
      console.warn('[PostStore] Failed to load local posts file, starting fresh:', err);
    }

    // 2. If Neon DB is configured, sync with Neon Postgres
    if (neonDbService.isAvailable()) {
      try {
        console.log('[PostStore] Syncing with Neon PostgreSQL...');
        await neonDbService.ensureSchema();
        const dbPosts = await neonDbService.listAll();
        
        // Merge DB posts into memory
        dbPosts.forEach((p) => this.posts.set(p.id, p));
        console.log(`[PostStore] Synced with Neon DB: ${this.posts.size} total active posts.`);
        this.dbInitialized = true;

        // Push any local posts not yet in DB
        const localList = Array.from(this.posts.values());
        for (const p of localList) {
          const existsInDb = dbPosts.some((dp) => dp.id === p.id);
          if (!existsInDb) {
            await neonDbService.savePost(p).catch(() => {});
          }
        }
      } catch (err: any) {
        console.warn('[PostStore] Neon DB sync warning:', err.message);
      }
    }
  }

  private persist() {
    try {
      const list = Array.from(this.posts.values());
      fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('[PostStore] Failed to persist posts:', err);
    }
  }

  public save(post: Post): Post {
    post.updatedAt = new Date().toISOString();
    this.posts.set(post.id, post);
    this.persist();

    // Async write to Neon Serverless Postgres if enabled
    if (neonDbService.isAvailable()) {
      neonDbService.savePost(post).catch((err) => {
        console.error(`[PostStore] Failed to save post ${post.id} to Neon DB:`, err.message);
      });
    }

    return post;
  }

  public async saveAsync(post: Post): Promise<Post> {
    post.updatedAt = new Date().toISOString();
    this.posts.set(post.id, post);
    this.persist();

    if (neonDbService.isAvailable()) {
      return await neonDbService.savePost(post);
    }
    return post;
  }

  public findById(id: string): Post | undefined {
    return this.posts.get(id);
  }

  public async findByIdAsync(id: string): Promise<Post | undefined> {
    if (neonDbService.isAvailable()) {
      const dbPost = await neonDbService.findById(id);
      if (dbPost) {
        this.posts.set(dbPost.id, dbPost);
        return dbPost;
      }
    }
    return this.posts.get(id);
  }

  public findBySourceTweetId(tweetId: string): Post | undefined {
    return Array.from(this.posts.values()).find((p) => p.sourceTweetId === tweetId);
  }

  public listAll(filter?: { status?: PostStatus }): Post[] {
    const list = Array.from(this.posts.values());
    if (filter?.status) {
      return list.filter((p) => p.status === filter.status);
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async listAllAsync(filter?: { status?: PostStatus }): Promise<Post[]> {
    if (neonDbService.isAvailable()) {
      const dbList = await neonDbService.listAll(filter);
      dbList.forEach((p) => this.posts.set(p.id, p));
      return dbList;
    }
    return this.listAll(filter);
  }

  public findDueScheduledPosts(now: Date = new Date()): Post[] {
    const nowIso = now.toISOString();
    return Array.from(this.posts.values()).filter(
      (p) => p.status === 'SCHEDULED' && p.scheduledAt && p.scheduledAt <= nowIso
    );
  }

  public delete(id: string): boolean {
    const deleted = this.posts.delete(id);
    if (deleted) {
      this.persist();
      if (neonDbService.isAvailable()) {
        neonDbService.delete(id).catch(() => {});
      }
    }
    return deleted;
  }
}

export const postStore = new PostStore();
