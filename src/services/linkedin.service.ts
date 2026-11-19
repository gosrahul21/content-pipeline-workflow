import axios, { AxiosInstance } from 'axios';
import { config } from '../config/env.js';
import { LinkedInPublishResult, PostMedia } from '../types/post.types.js';
import { s3Service } from './s3.service.js';

export class LinkedInService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.linkedin.com',
      headers: {
        Authorization: `Bearer ${config.linkedin.accessToken}`,
        'LinkedIn-Version': config.linkedin.apiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60s timeout for video uploads
    });
  }

  /**
   * Publish a post to LinkedIn (supports text, images, and videos)
   */
  public async publishPost(
    text: string,
    mediaList?: PostMedia[],
    options?: { authorUrn?: string }
  ): Promise<LinkedInPublishResult> {
    const author = options?.authorUrn || config.linkedin.authorUrn;
    const primaryMedia = mediaList && mediaList.length > 0 ? mediaList[0] : undefined;

    // 1. Dry Run / Mock Mode
    if (config.linkedin.mockMode) {
      console.log('\n================ [LINKEDIN MOCK PUBLISH] ================');
      console.log(`[Author]: ${author || 'urn:li:person:MOCK_USER_ID'}`);
      console.log(`[Content]:\n${text}`);
      if (primaryMedia) {
        console.log(`[Media Type]: ${primaryMedia.type}`);
        console.log(`[Media Details]: ${JSON.stringify(primaryMedia, null, 2)}`);
      }
      console.log('=========================================================\n');

      const mockId = Math.floor(100000000 + Math.random() * 900000000);
      const postUrn = `urn:li:share:${mockId}`;
      return {
        success: true,
        postUrn,
        url: `https://www.linkedin.com/feed/update/${postUrn}`,
      };
    }

    // 2. Validate Credentials
    if (!config.linkedin.accessToken) {
      throw new Error(
        'LINKEDIN_ACCESS_TOKEN is missing. Set it in .env or enable LINKEDIN_MOCK_MODE=true for testing.'
      );
    }
    if (!author) {
      throw new Error(
        'LINKEDIN_AUTHOR_URN is missing. E.g., urn:li:person:XXXX or urn:li:organization:XXXX.'
      );
    }

    try {
      let mediaUrn: string | undefined;

      // 3. Handle media upload (IMAGE or VIDEO)
      if (primaryMedia) {
        if (primaryMedia.type === 'VIDEO') {
          mediaUrn = await this.uploadVideo(primaryMedia, author);
        } else if (primaryMedia.type === 'IMAGE') {
          mediaUrn = await this.uploadImage(primaryMedia, author);
        }
      }

      // 4. Construct LinkedIn REST Post Payload
      const payload: Record<string, any> = {
        author,
        commentary: text,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      };

      if (mediaUrn && primaryMedia) {
        if (primaryMedia.type === 'VIDEO') {
          payload.content = {
            media: {
              id: mediaUrn,
              title: primaryMedia.title || 'Video',
            },
          };
        } else {
          payload.content = {
            media: {
              id: mediaUrn,
              altText: primaryMedia.altText || 'Post image',
            },
          };
        }
      }

      // 5. Submit to LinkedIn REST API
      const response = await this.client.post('/rest/posts', payload);
      
      const postUrn = response.headers['x-restli-id'] || response.data?.id;

      return {
        success: true,
        postUrn,
        url: postUrn ? `https://www.linkedin.com/feed/update/${postUrn}` : undefined,
      };
    } catch (err: any) {
      const errDetails = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      console.error('[LinkedInService] Failed to publish post:', errDetails);
      return {
        success: false,
        error: errDetails,
      };
    }
  }

  /**
   * Upload an image to LinkedIn using the 2-step direct upload protocol
   */
  private async uploadImage(media: PostMedia, authorUrn: string): Promise<string> {
    const mediaSource = media.s3Key ? `s3://${media.s3Bucket || config.aws.s3Bucket}/${media.s3Key}` : media.url;
    console.log(`[LinkedInService] Initializing image upload for: ${mediaSource}`);

    // Step A: Initialize upload with LinkedIn
    const initResponse = await this.client.post('/rest/images?action=initializeUpload', {
      initializeUploadRequest: {
        owner: authorUrn,
      },
    });

    const { uploadUrl, image: imageUrn } = initResponse.data.value;

    // Step B: Get file buffer from S3 or URL
    const { buffer, contentType } = await this.resolveMediaBuffer(media, 'image/jpeg');

    // Step C: Upload binary directly to LinkedIn uploadUrl
    await axios.put(uploadUrl, buffer, {
      headers: {
        'Content-Type': contentType,
      },
    });

    console.log(`[LinkedInService] Image successfully uploaded to LinkedIn: ${imageUrn}`);
    return imageUrn;
  }

  /**
   * Upload an original video to LinkedIn using the LinkedIn Videos REST API
   * Supports both S3 media (s3Key) and direct URL media
   */
  private async uploadVideo(media: PostMedia, authorUrn: string): Promise<string> {
    const mediaSource = media.s3Key ? `s3://${media.s3Bucket || config.aws.s3Bucket}/${media.s3Key}` : media.url;
    console.log(`[LinkedInService] Initializing video upload for: ${mediaSource}`);

    // Step A: Fetch video buffer from S3 or URL
    const { buffer } = await this.resolveMediaBuffer(media, 'video/mp4');
    const fileSizeBytes = buffer.length;
    console.log(`[LinkedInService] Video size: ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB (${fileSizeBytes} bytes)`);

    // Step B: Initialize video upload request with LinkedIn
    const initResponse = await this.client.post('/rest/videos?action=initializeUpload', {
      initializeUploadRequest: {
        owner: authorUrn,
        fileSizeBytes,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    });

    const { video: videoUrn, uploadInstructions, uploadToken } = initResponse.data.value;

    if (!uploadInstructions || uploadInstructions.length === 0) {
      throw new Error('LinkedIn did not return uploadInstructions for video upload');
    }

    console.log(`[LinkedInService] Video split into ${uploadInstructions.length} upload chunk(s).`);

    // Step C: Upload each chunk according to firstByte and lastByte boundaries
    const uploadedPartIds: string[] = [];

    for (let i = 0; i < uploadInstructions.length; i++) {
      const instruction = uploadInstructions[i];
      const start = instruction.firstByte;
      const end = instruction.lastByte + 1;
      const chunk = buffer.subarray(start, end);

      console.log(
        `[LinkedInService] Uploading chunk ${i + 1}/${uploadInstructions.length} (${(chunk.length / 1024).toFixed(1)} KB)...`
      );

      const uploadRes = await axios.put(instruction.uploadUrl, chunk, {
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      const etag = (uploadRes.headers['etag'] as string) || '';
      if (etag) {
        uploadedPartIds.push(etag);
      }
    }

    // Step D: Finalize video upload
    try {
      await this.client.post('/rest/videos?action=finalizeUpload', {
        finalizeUploadRequest: {
          video: videoUrn,
          uploadToken: uploadToken || '',
          uploadedPartIds,
        },
      });
      console.log(`[LinkedInService] Video finalized successfully: ${videoUrn}`);
    } catch (err: any) {
      console.warn(
        `[LinkedInService] Finalize upload warning (single-part may be auto-finalized):`,
        err.response?.data || err.message
      );
    }

    // Step E: Wait for LinkedIn video transcoding/processing to become AVAILABLE
    await this.waitForVideoReady(videoUrn);

    return videoUrn;
  }

  /**
   * Polls LinkedIn until the uploaded video has completed transcoding and is AVAILABLE
   */
  private async waitForVideoReady(videoUrn: string, maxWaitSeconds = 60): Promise<void> {
    console.log(`[LinkedInService] Waiting for video ${videoUrn} to finish processing...`);
    const encodedUrn = encodeURIComponent(videoUrn);
    const startTime = Date.now();

    while ((Date.now() - startTime) / 1000 < maxWaitSeconds) {
      try {
        const response = await this.client.get(`/rest/videos/${encodedUrn}`);
        const status = response.data?.status;
        console.log(`[LinkedInService] Video processing status: ${status}`);

        if (status === 'AVAILABLE') {
          console.log(`[LinkedInService] Video is ready for publishing!`);
          return;
        }

        if (status === 'PROCESSING_FAILED') {
          throw new Error('LinkedIn reported video PROCESSING_FAILED');
        }
      } catch (err: any) {
        // If GET returns 404 momentarily while indexing, wait and retry
        console.log(`[LinkedInService] Polling video status: ${err.response?.status || err.message}`);
      }

      // Wait 3 seconds between polls
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    console.warn(`[LinkedInService] Video polling reached timeout (${maxWaitSeconds}s). Attempting post anyway...`);
  }

  /**
   * Helper to retrieve media buffer from either S3 or HTTP URL
   */
  private async resolveMediaBuffer(
    media: PostMedia,
    fallbackMimeType: string
  ): Promise<{ buffer: Buffer; contentType: string }> {
    if (media.s3Key) {
      const s3Result = await s3Service.getFileBuffer(media.s3Key, media.s3Bucket);
      return {
        buffer: s3Result.buffer,
        contentType: media.mimeType || s3Result.contentType || fallbackMimeType,
      };
    } else if (media.url) {
      const mediaResponse = await axios.get(media.url, { responseType: 'arraybuffer' });
      return {
        buffer: Buffer.from(mediaResponse.data),
        contentType: String(mediaResponse.headers['content-type'] || media.mimeType || fallbackMimeType),
      };
    }
    throw new Error('Media must provide either "s3Key" or "url"');
  }
}

export const linkedInService = new LinkedInService();
