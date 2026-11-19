import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { s3Service } from './s3.service.js';
import { PostMedia } from '../types/post.types.js';

export class MediaExtractorService {
  /**
   * Downloads remote media from external URLs (e.g. X CDN) and saves into private S3.
   */
  async extractAndStoreMedia(mediaItems: Array<{ url: string; type?: string; title?: string }>, postId: string): Promise<PostMedia[]> {
    const results: PostMedia[] = [];

    for (const item of mediaItems) {
      if (!item.url) continue;

      try {
        console.log(`[MediaExtractor] Downloading external media from ${item.url}...`);
        const response = await axios.get(item.url, {
          responseType: 'arraybuffer',
          timeout: 25000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          },
        });

        const buffer = Buffer.from(response.data);
        const contentType = String(response.headers['content-type'] || 'image/jpeg');
        const isVideo = contentType.includes('video') || item.url.includes('.mp4') || String(item.type).toLowerCase() === 'video';
        
        const extension = isVideo ? 'mp4' : (contentType.split('/')[1] || 'jpg');
        const s3Key = `pending/${postId}/${uuidv4()}.${extension}`;

        await s3Service.uploadBuffer(s3Key, buffer, contentType);

        results.push({
          id: uuidv4(),
          type: isVideo ? 'VIDEO' : 'IMAGE',
          title: item.title || (isVideo ? 'Video' : 'Image'),
          s3Key,
          mimeType: contentType,
          url: item.url,
        });

        console.log(`[MediaExtractor] Successfully saved to S3: ${s3Key}`);
      } catch (err: any) {
        console.warn(`[MediaExtractor] Failed to extract media from ${item.url}:`, err.message);
        // Fallback: keep remote URL if download fails
        results.push({
          id: uuidv4(),
          type: item.type === 'video' ? 'VIDEO' : 'IMAGE',
          url: item.url,
          title: item.title,
        });
      }
    }

    return results;
  }

  /**
   * Cleans up S3 media files associated with a post after publication.
   */
  async cleanupPostMedia(media?: PostMedia[]): Promise<void> {
    if (!media || media.length === 0) return;

    for (const item of media) {
      if (item.s3Key) {
        console.log(`[MediaExtractor] Cleaning up post-publication media from S3: ${item.s3Key}`);
        await s3Service.deleteFile(item.s3Key);
      }
    }
  }
}

export const mediaExtractorService = new MediaExtractorService();
