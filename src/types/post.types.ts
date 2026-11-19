export type PostStatus = 
  | 'DRAFT'
  | 'QUEUED'
  | 'PENDING_REVIEW'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'CANCELLED';

export type PostPlatform = 'LINKEDIN' | 'X' | 'ALL';

export interface PostMedia {
  id?: string;
  type: 'IMAGE' | 'VIDEO';
  title?: string; // Title for videos or articles
  url?: string; // Optional remote URL or public URL
  s3Key?: string; // S3 object key (e.g., "media/tweet-123.mp4")
  s3Bucket?: string; // Optional override S3 bucket name
  mimeType?: string;
  altText?: string;
  linkedinAssetUrn?: string;
}

export interface Post {
  id: string;
  sourceTweetId?: string;
  originalText?: string;
  content: string; // Text to be posted to LinkedIn
  media?: PostMedia[];
  status: PostStatus;
  platform: PostPlatform;
  scheduledAt?: string; // ISO 8601 string
  publishedAt?: string; // ISO 8601 string
  linkedinPostUrn?: string;
  error?: string;
  metadata?: {
    category?: string;
    aiScore?: number;
    tags?: string[];
    [key: string]: any;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreatePostDTO {
  sourceTweetId?: string;
  originalText?: string;
  content: string;
  media?: PostMedia[];
  scheduledAt?: string; // If omitted and publishNow=false, status is DRAFT
  publishNow?: boolean;
  metadata?: Record<string, any>;
}

export interface BatchScheduleDTO {
  postIds?: string[]; // If providing existing drafts
  posts?: CreatePostDTO[]; // Or creating and scheduling in one go
  windowStart: string; // ISO 8601 or '09:00'
  windowEnd: string; // ISO 8601 or '21:00'
  targetDate?: string; // YYYY-MM-DD, defaults to today
  minGapMinutes?: number; // Minimum minutes between posts (default 30 min)
  jitterMinutes?: number; // Random +/- variance (default 3 min)
}

export interface LinkedInPublishResult {
  success: boolean;
  postUrn?: string;
  url?: string;
  error?: string;
}
