import axios from 'axios';
import { s3Service } from './services/s3.service.js';
import { postService } from './services/post.service.js';
async function main() {
    console.log('--- Step 1: Downloading test image buffer ---');
    const sampleImageUrl = 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1080&auto=format&fit=crop&q=80';
    const imgRes = await axios.get(sampleImageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(imgRes.data);
    const s3Key = `media/test/cloud-server-${Date.now()}.jpg`;
    console.log(`--- Step 2: Uploading image to S3 (Key: ${s3Key}) ---`);
    await s3Service.uploadBuffer(s3Key, buffer, 'image/jpeg');
    console.log('Successfully uploaded to S3!');
    console.log('--- Step 3: Publishing post to LinkedIn fetching media from S3 ---');
    const post = await postService.createPost({
        content: '☁️ Live Test: Image streamed directly from private AWS S3 to LinkedIn!\n\nExtracted media successfully cached and uploaded via our Content Engine backend.\n\n#AWS #CloudArchitecture #LinkedInAPI #Automation',
        publishNow: true,
        media: [
            {
                type: 'IMAGE',
                s3Key: s3Key,
                altText: 'Cloud datacenter architecture',
            },
        ],
    });
    console.log('\n--- Result ---');
    console.log('Status:', post.status);
    console.log('Post URN:', post.linkedinPostUrn);
    console.log('Live Post URL:', `https://www.linkedin.com/feed/update/${post.linkedinPostUrn}`);
}
main().catch(console.error);
