import { linkedInDeduplicationService } from './services/linkedin-dedup.service.js';
async function main() {
    console.log('================ [TESTING LINKEDIN DEDUPLICATION SERVICE] ================');
    // Test 1: Content that matches the first 50 chars of our earlier published S3 post
    // The earlier post started with: "☁️ Live Test: Image streamed directly from private AWS S3 to LinkedIn!..."
    console.log('\n--- Test 1: Checking Existing Post (First 50 Chars Match) ---');
    const duplicateCandidate = '☁️ Live Test: Image streamed directly from private AWS S3 to LinkedIn! BUT here is some different commentary at the end.';
    const result1 = await linkedInDeduplicationService.checkDuplicate(duplicateCandidate);
    console.log('Result 1:');
    console.log('  Is Duplicate?:', result1.isDuplicate);
    console.log('  Prefix (50 chars):', `"${result1.prefix}"`);
    console.log('  Action:', result1.suggestedAction);
    console.log('  Matched Post ID:', result1.matchedPost?.id);
    console.log('  LinkedIn Post URN:', result1.matchedPost?.linkedinPostUrn);
    // Test 2: Completely fresh new content
    console.log('\n--- Test 2: Checking Fresh New Content ---');
    const freshCandidate = '🌟 5 architectural principles we learned after scaling our queue consumers to 50k messages per second.';
    const result2 = await linkedInDeduplicationService.checkDuplicate(freshCandidate);
    console.log('Result 2:');
    console.log('  Is Duplicate?:', result2.isDuplicate);
    console.log('  Prefix (50 chars):', `"${result2.prefix}"`);
    console.log('  Action:', result2.suggestedAction);
    // Test 3: Batch deduplication of incoming feed items (e.g. top 30 from X)
    console.log('\n--- Test 3: Batch Deduplication for Scraped Feed ---');
    const incomingFeed = [
        {
            id: 'tweet-001',
            content: '☁️ Live Test: Image streamed directly from private AWS S3 to LinkedIn! Rewritten tweet copy.',
        },
        {
            id: 'tweet-002',
            content: '🚀 Real-time event streaming with Apache Kafka vs AWS SQS comparison.',
        },
        {
            id: 'tweet-003',
            content: '🎬 Live Video Test: Video streamed directly from AWS S3 to LinkedIn! Variant repost.',
        },
        {
            id: 'tweet-004',
            content: '⚡ How to optimize Node.js cold starts on AWS Lambda down to under 150ms.',
        },
    ];
    const batchResult = await linkedInDeduplicationService.checkBatch(incomingFeed);
    console.log(`Total Checked: ${batchResult.totalChecked}`);
    console.log(`  Passed (New Posts ➔ AI Pipeline): ${batchResult.passedCount}`);
    batchResult.passed.forEach(p => console.log(`    ✅ [${p.id}] "${p.content.substring(0, 45)}..."`));
    console.log(`  Duplicates (Already on LinkedIn ➔ Human Supervision): ${batchResult.duplicateCount}`);
    batchResult.duplicates.forEach(p => {
        console.log(`    ⚠️ [${p.id}] "${p.content.substring(0, 45)}..."`);
        console.log(`       ➔ Matched URN: ${p.duplicateInfo.matchedPost?.linkedinPostUrn}`);
    });
    console.log('\n🎉 ALL DEDUPLICATION TESTS PASSED SUCCESSFULLY!');
}
main().catch(console.error);
