import { linkedInDeduplicationService } from './services/linkedin-dedup.service.js';
import { postStore } from './db/post.store.js';
const postContent = `Everyone seems to have forgotten that code is a liability, not an asset.

That means that producing thousands of lines of code you didn’t read isn’t something to celebrate. It’s something to worry about!

Every line of code needs to be tested, secured, and maintained.  Even the ones that create no value for customers and therefore no value to the business.

That’s why every line of code is a liability. And producing more liabilities isn’t good engineering or good business.

Good engineering isn't about producing more code. It's about solving problems with the least amount of code.

The asset is the solution, not the code`;
async function run() {
    console.log('--- Checking in Local / Published Post Store ---');
    const result = await linkedInDeduplicationService.checkDuplicate(postContent);
    console.log('Result:', JSON.stringify(result, null, 2));
    console.log('\n--- Checking first 50 chars prefix ---');
    console.log('Extracted prefix (50 chars):', `"${linkedInDeduplicationService.extract50Chars(postContent)}"`);
    // Also print all posts in store to see what exists
    const allPosts = postStore.listAll();
    console.log(`\nTotal posts in DB: ${allPosts.length}`);
    for (const p of allPosts) {
        const existingPrefix = linkedInDeduplicationService.extract50Chars(p.content);
        if (existingPrefix.includes('everyone seems') || p.content.toLowerCase().includes('code is a liability')) {
            console.log('MATCH FOUND in post store:', p.id, p.linkedinPostUrn);
        }
    }
}
run().catch(console.error);
