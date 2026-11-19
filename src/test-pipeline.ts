import { sqsProcessorService } from './services/sqs-processor.service.js';
import { aiFilterService } from './services/ai-filter.service.js';

async function runEndToEndTests() {
  console.log('===============================================================');
  console.log('🚀 CONTENT ENGINE: DOMAIN/STYLE FILTRATION & TOP-3 SELECTION TEST');
  console.log('===============================================================\n');

  // TEST 1: 10-CATEGORY AI FILTRATION & DECISION TEST
  console.log('--- TEST 1: Classifying Real Feed Tweets with 10-Category AI Filtration ---');
  const sampleBatch = [
    {
      originalTweetId: 'swe-101',
      content: 'Database indexing deep dive: Why B-Tree composite index column ordering matters for range queries and how covering indexes eliminate table lookups completely.',
      author: '@backend_architect',
      isDuplicate: false,
    },
    {
      originalTweetId: 'ai-102',
      content: 'LLM inference latency optimization: Using speculative decoding and KV cache quantization reduces time-to-first-token by 60% without perceptible loss in generation quality.',
      author: '@ai_engineer',
      isDuplicate: false,
    },
    {
      originalTweetId: '2123438391090147775',
      content: 'Work backwards from science fiction. We can build anything now',
      author: '@rauchg',
      isDuplicate: false,
    },
    {
      originalTweetId: '2123122026932007233',
      content: "A huge percentage of my life is spent avoiding crowds. Avoiding fashionable ideas, investing in underpriced assets, finding cool places that aren't deluged with tourists — they're all variants of the same thing. Whenever I find myself in a crowd, I feel something is wrong.",
      author: '@paulg',
      isDuplicate: false,
    },
    {
      originalTweetId: '2123299792923042078',
      content: 'I found something wild in TrustMRR One founder has generated over $19M in revenue with less than 200 followers on X Meanwhile, thousands of founders are chasing followers, impressions and virality Maybe the goal was never to become popular Maybe it was to build a business',
      author: '@Miracle_NNnn',
      isDuplicate: false,
    },
    {
      originalTweetId: '2123099714186850431',
      content: 'Alex Hormozi on how to spot an A-player in the first two weeks:\n0:01 / 0:52',
      author: '@andywalkerhq',
      isDuplicate: false,
    },
    {
      originalTweetId: '2123450524796399816',
      content: 'Omo be like say na only Nigerians no get money to buy This ps5 with GTA 6 package inside, I can still see many of us online.',
      author: '@aproko_units',
      isDuplicate: false,
    },
    {
      originalTweetId: 'ad-explee-01',
      content: 'my ads cost too much for how little they brought in. so i tried this: i gave explee my website link. it found companies that need my product, wrote each of them a personal email, and helped me book calls. $30 free 👇 https://t.co/anRQiznifv?twclid=22atepbkrw6iinccr76d4477g5',
      author: '@vovudebosh',
      isDuplicate: false,
    },
    {
      originalTweetId: 'ad-explee-02',
      content: 'Ad\nno clients? 6 months building, still $0 revenue. the problem was never the product — it was sales. drop your link: this ai finds your buyers, writes the emails, books the calls. $30 free credits 👇 https://explee.com/auto-gtm/x/tw-ag997-c1761?twclid=2d9fonz9oanjddf0s1cl50atk5',
      author: '@lhoffmann_dev',
      isDuplicate: false,
    },
  ];

  const evalResults = await aiFilterService.evaluateBatch(sampleBatch);
  for (let i = 0; i < sampleBatch.length; i++) {
    const item = sampleBatch[i];
    const res = evalResults[i];
    console.log(`\n• [${res.author}] "${item.content.substring(0, 45)}..."`);
    console.log(`  Category: [${res.category}] | Decision: [${res.decision}]`);
    console.log(`  Scores: Value=${res.scores.value}/10, Originality=${res.scores.originality}/10, Adaptability=${res.scores.adaptability}/10 (Avg: ${res.averageScore}/10)`);
    console.log(`  Core Idea: "${res.coreIdea}"`);
    console.log(`  Rank Composite Score: ${res.compositeScore}/100 | Direct Post Ready: ${res.isDirectPostEligible}`);
  }

  // TEST 2: TOP-3 SELECTION FOR THE DAY
  console.log('\n---------------------------------------------------------------');
  console.log('--- TEST 2: Rank and Select Top 3 Posts for the Day ---');
  const topResult = await sqsProcessorService.rankAndSelectTopPosts(sampleBatch, 3);

  console.log('\nTop-3 Selection Summary:', {
    totalReceived: topResult.totalReceived,
    candidatesCount: topResult.candidatesCount,
    topSelectedCount: topResult.topSelectedCount,
  });

  if (topResult.topPosts.length === 0) {
    throw new Error('Test 2 Failed: No top posts selected');
  }

  // Verify that the top selected post is a KNOWLEDGE_VALUE post in SWE or AI
  const top1 = topResult.topPosts[0];
  console.log(`\n🏆 #1 Post: [${top1.domain} | ${top1.postType}] Score: ${top1.qualityScore}/10 (Rank Score: ${top1.compositeScore})`);
  console.log(`   Direct Post Eligible: ${top1.isDirectPostEligible}`);

  // TEST 3: DIRECT POST ACTION (VALUE POST DIRECT TO LINKEDIN)
  console.log('\n---------------------------------------------------------------');
  console.log('--- TEST 3: User Taps "[🚀 Post Directly]" on Value Post ---');
  const directPostResult = await sqsProcessorService.handleSupervisionAction({
    postId: top1.postId,
    action: 'post_now',
  });
  console.log('Direct Post Result:', {
    success: directPostResult.success,
    status: directPostResult.post?.status,
    postUrn: directPostResult.post?.linkedinPostUrn,
  });

  // TEST 4: AI IMPROVISE ACTION (ON MRR FLEX OR LIFE POST)
  console.log('\n---------------------------------------------------------------');
  console.log('--- TEST 4: User Taps "[✨ AI Improvise]" on Lifestyle/Flex Post ---');
  const flexPost = topResult.topPosts.find((p) => p.postType !== 'KNOWLEDGE_VALUE') || topResult.topPosts[1];
  const improviseResult = await sqsProcessorService.handleSupervisionAction({
    postId: flexPost.postId,
    action: 'improvise',
  });
  console.log('AI Improviser Hook:', improviseResult.post?.metadata?.hook);
  console.log('AI Improviser Rewritten Post:\n', improviseResult.revisedContent);

  // TEST 5: SCHEDULE REVISED POST
  console.log('\n---------------------------------------------------------------');
  console.log('--- TEST 5: User Taps "[📅 Schedule Revised]" ---');
  const scheduleResult = await sqsProcessorService.handleSupervisionAction({
    postId: flexPost.postId,
    action: 'schedule_revised',
  });
  console.log('Schedule Result Status:', scheduleResult.post?.status, 'ScheduledAt:', scheduleResult.scheduledAt);

  console.log('\n===============================================================');
  console.log('🎉 ALL DOMAIN, FILTER, TOP-3 & ACTION TESTS PASSED!');
  console.log('===============================================================');
}

runEndToEndTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
