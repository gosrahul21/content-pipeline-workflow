import { sqsService } from './services/sqs.service.js';

async function main() {
  console.log('--- Testing SQS Service Mock Mode ---');
  process.env.SQS_MOCK_MODE = 'true';

  // 1. Test single post
  const single = await sqsService.publishPost({
    content: 'Testing single post to SQS from Chrome Extension',
    author: '@karpathy',
    isDuplicate: false,
    media: [
      {
        type: 'image',
        url: 'https://pbs.twimg.com/media/example.jpg',
      },
    ],
  });
  console.log('Single Post Result:', {
    success: single.success,
    messageId: single.messageId,
    queueUrl: single.queueUrl,
    mock: single.mock,
    postId: single.post.id,
  });

  // 2. Test batch of 25 posts (tests chunking in batches of 10)
  const posts = Array.from({ length: 25 }, (_, i) => ({
    content: `Tweet #${i + 1}: AI agents are transforming engineering workflows.`,
    author: `@engineer_${i + 1}`,
    authorName: `Engineer ${i + 1}`,
    originalTweetId: `18580000000000000${i + 10}`,
    isDuplicate: i % 3 === 0,
    existingLinkedInUrl: i % 3 === 0 ? `https://www.linkedin.com/feed/update/urn:li:activity:75200000000000000${i}` : null,
    metrics: {
      likes: (i + 1) * 42,
      reposts: (i + 1) * 7,
      replies: i * 3,
    },
  }));

  const batch = await sqsService.publishBatch(posts);
  console.log('\nBatch Post Result (25 posts):', {
    success: batch.success,
    totalReceived: batch.totalReceived,
    totalPublished: batch.totalPublished,
    totalFailed: batch.totalFailed,
    chunks: Math.ceil(batch.totalPublished / 10),
    sampleMessageId: batch.messageIds[0],
    mock: batch.mock,
  });

  console.log('\n✅ SQS Service tests completed successfully!');
}

main().catch(console.error);
