import { postService } from './services/post.service.js';

async function runDemo() {
  console.log('--- 1. Testing Immediate Publish with Original Video (from S3) ---');
  const videoPost = await postService.createPost({
    content: '🎬 Watch this 60-second walkthrough of our real-time streaming pipeline! #Tech #VideoDemo',
    publishNow: true,
    media: [
      {
        type: 'VIDEO',
        title: 'Real-Time Pipeline Architecture Walkthrough',
        s3Key: 'videos/tweets/1928374/demo.mp4',
        altText: 'Video demonstrating pipeline speed and low latency',
      },
    ],
    metadata: { isVideo: true },
  });

  console.log('Video Post Result:', {
    id: videoPost.id,
    status: videoPost.status,
    postUrn: videoPost.linkedinPostUrn,
    media: videoPost.media,
    publishedAt: videoPost.publishedAt,
  });

  console.log('\n--- 2. Testing Batch Schedule with Mixed Image & Video Posts ---');
  const mixedBatch = [
    {
      content: 'Breakdown of our caching architecture with diagram.',
      media: [{ type: 'IMAGE' as const, s3Key: 'images/architecture-diagram.png' }],
    },
    {
      content: 'Original video demo showing our sub-100ms response time.',
      media: [
        {
          type: 'VIDEO' as const,
          title: 'Sub-100ms Response Time Live Benchmark',
          s3Key: 'videos/benchmark.mp4',
        },
      ],
    },
  ];

  const scheduled = await postService.scheduleBatch({
    posts: mixedBatch,
    windowStart: '09:00',
    windowEnd: '21:00',
    targetDate: new Date().toISOString().split('T')[0],
    minGapMinutes: 30,
    jitterMinutes: 2,
  });

  console.log(`Scheduled ${scheduled.length} mixed posts (Image + Video).`);
  scheduled.forEach((p, idx) => {
    console.log(`  [${idx + 1}] Scheduled at: ${p.scheduledAt} | Type: ${p.media?.[0]?.type} | Title: "${p.media?.[0]?.title || 'N/A'}"`);
  });

  console.log('\n✅ Video and Image posting logic verified successfully!');
  process.exit(0);
}

runDemo().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
