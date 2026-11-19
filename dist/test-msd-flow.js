import { sqsProcessorService } from './services/sqs-processor.service.js';
async function runMsdTest() {
    console.log('===============================================================');
    console.log('🚀 TESTING ENTIRE SQS-TO-LINKEDIN FLOW FOR MSD TWEET');
    console.log('Tweet: "Man, we really miss MSD a lot"');
    console.log('URL: https://x.com/PSTtwtz/status/2123058028689625501');
    console.log('Mode: SKIP AI FILTRATION -> DIRECT SQS CONSUMPTION -> S3 MEDIA EXTRACT -> LINKEDIN PUBLISH');
    console.log('===============================================================\n');
    const sqsMessage = {
        source: 'chrome_extension',
        content: 'Man, we really miss MSD a lot',
        author: '@PSTtwtz',
        authorName: 'PST',
        originalTweetId: '2123058028689625501',
        media: [
            {
                type: 'video',
                url: 'https://video.twimg.com/amplify_video/2123057970573418496/vid/avc1/1280x692/ZqmpsXgzcV16UG2N.mp4?tag=29',
            },
        ],
        skipAiFilter: true,
        extractedAt: new Date().toISOString(),
    };
    console.log('1. Dispatching SQS message to processor...');
    const outcome = await sqsProcessorService.processSqsPost(sqsMessage);
    console.log('\n===============================================================');
    console.log('🏁 SQS PROCESSING OUTCOME:');
    console.log(`Action Taken:   ${outcome.actionTaken}`);
    console.log(`Post ID:        ${outcome.postId}`);
    console.log(`Post Status:    ${outcome.post.status}`);
    console.log(`LinkedIn URN:   ${outcome.post.linkedinPostUrn || 'N/A'}`);
    console.log(`LinkedIn URL:   ${outcome.publishedUrl || 'N/A'}`);
    if (outcome.post.error) {
        console.log(`Error:          ${outcome.post.error}`);
    }
    console.log('===============================================================');
}
runMsdTest().catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
});
