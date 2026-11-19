import axios from 'axios';
import { s3Service } from './services/s3.service.js';
import { postService } from './services/post.service.js';

async function main() {
  console.log('--- Step 1: Downloading sample MP4 video buffer ---');
  const videoUrl = 'https://raw.githubusercontent.com/mediaelement/mediaelement-files/master/big_buck_bunny.mp4';
  const vidRes = await axios.get(videoUrl, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(vidRes.data);
  const s3Key = `media/test/sample-video-${Date.now()}.mp4`;

  console.log(`--- Step 2: Uploading ${(buffer.length / (1024 * 1024)).toFixed(2)} MB video to S3 (Key: ${s3Key}) ---`);
  await s3Service.uploadBuffer(s3Key, buffer, 'video/mp4');
  console.log('Successfully uploaded video to S3!');

  console.log('--- Step 3: Publishing post with S3 video to LinkedIn ---');
  const post = await postService.createPost({
    content: '🎬 Live Video Test: Video streamed directly from AWS S3 to LinkedIn!\n\nDemonstrating our automated Content Engine media pipeline with full video processing.\n\n#AWS #LinkedInVideo #ContentEngine #Automation',
    publishNow: true,
    media: [
      {
        type: 'VIDEO',
        title: 'Content Engine Video Demo',
        s3Key: s3Key,
        altText: 'Video demonstration of content engine pipeline',
      },
    ],
  });

  console.log('\n--- Video Post Result ---');
  console.log('Status:', post.status);
  console.log('Post URN:', post.linkedinPostUrn);
  console.log('Live Post URL:', `https://www.linkedin.com/feed/update/${post.linkedinPostUrn}`);
}

main().catch(console.error);
