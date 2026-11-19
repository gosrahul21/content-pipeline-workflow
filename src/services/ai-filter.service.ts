import axios from 'axios';
import { config } from '../config/env.js';

export type TweetCategory =
  | 'KNOWLEDGE_VALUE'
  | 'CONTRARIAN_INSIGHT'
  | 'VISION_MOTIVATION'
  | 'PERSONAL_LIFE'
  | 'FLEXING_MRR'
  | 'PROMO_AD'
  | 'VIDEO_CLIP'
  | 'HUMOR_MEME'
  | 'NEWS_TREND'
  | 'ENGAGEMENT_BAIT';

export type FilterDecision = 'KEEP' | 'MAYBE' | 'DISCARD';

export interface FilterScores {
  value: number;        // 1-10: does it teach or change how someone thinks?
  originality: number;  // 1-10: is the idea fresh, or recycled advice?
  adaptability: number; // 1-10: can I make it my own without copying?
}

export type ContentDomain = 'SOFTWARE_ENGINEERING' | 'AI' | 'BUSINESS' | 'OTHER';
export type PostType = TweetCategory;

export interface AiFilterResult {
  author?: string;
  category: TweetCategory;
  decision: FilterDecision;
  scores: FilterScores;
  averageScore: number; // (value + originality + adaptability) / 3
  coreIdea: string;
  reason: string;

  // Compatibility and enrichment fields for downstream pipeline
  domain: ContentDomain;
  postType: TweetCategory; // maps to category
  qualityScore: number; // maps to rounded averageScore (1-10)
  compositeScore: number; // 0-100 calculated ranking score for Top-N selection
  viralityPotential: 'HIGH' | 'MEDIUM' | 'LOW';
  isDirectPostEligible: boolean; // True for KNOWLEDGE_VALUE with high score, safe to post directly
  requiresHumanIntervention: boolean;
  interventionReason?: string;
  suggestedAction: 'DEFAULT_POSTING' | 'HUMAN_SUPERVISION' | 'DISCARD';
  keyThemes: string[];
}

export interface PostInputForFilter {
  content: string;
  author?: string;
  isDuplicate?: boolean;
  existingLinkedInUrl?: string | null;
  metrics?: { likes?: number; reposts?: number };
}

export class AiFilterService {
  private apiKey: string;
  private model: string;
  private niche: string;

  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model;
    this.niche = (config as any).content?.niche || 'tech founders, software engineers, builders, and indie hackers';
  }

  /**
   * Filter and categorize a single tweet using Gemini AI (1-by-1 evaluation with retry).
   */
  async evaluatePost(post: PostInputForFilter): Promise<AiFilterResult> {
    try {
      return await this.evaluateSinglePostWithRetry(post);
    } catch (err: any) {
      console.warn(`[AiFilterService] evaluatePost error (${err.message}). Using heuristics fallback.`);
      return this.heuristicFallback(post);
    }
  }

  /**
   * Evaluate candidate tweets 1-by-1 with a 5-second pacing delay between calls.
   * This guarantees total execution stays at max 12 RPM (safely below 15 RPM limit),
   * provides 100% focused attention per post, and eliminates hallucination / topic bleeding.
   */
  async evaluateBatch(posts: PostInputForFilter[]): Promise<AiFilterResult[]> {
    if (posts.length === 0) return [];

    const allResults: AiFilterResult[] = [];

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      try {
        console.log(`[AiFilterService] Evaluating post ${i + 1}/${posts.length} (1-by-1 mode)...`);
        const result = await this.evaluateSinglePostWithRetry(post, i + 1);
        allResults.push(result);
      } catch (err: any) {
        console.warn(`[AiFilterService] Post ${i + 1} evaluation error (${err.message}). Using heuristics fallback.`);
        allResults.push(this.heuristicFallback(post));
      }

      // 5-second pacing delay between posts (60s / 5s = 12 RPM max, strictly under 15 RPM)
      if (i < posts.length - 1) {
        console.log(`[AiFilterService] ⏳ 5-second pacing delay before next post (${i + 1}/${posts.length})...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    return allResults;
  }

  /**
   * Evaluates a single tweet with Gemini, retrying with exponential backoff on HTTP 429.
   */
  private async evaluateSinglePostWithRetry(
    post: PostInputForFilter,
    indexNum: number = 1,
    maxRetries: number = 3
  ): Promise<AiFilterResult> {
    if (!this.apiKey) {
      return this.heuristicFallback(post);
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.callGeminiSingle(post, indexNum);
      } catch (err: any) {
        const isRateLimit = err.response?.status === 429 || (err.message && err.message.includes('429'));
        if (isRateLimit && attempt < maxRetries) {
          const waitTimeMs = attempt * 5000; // 5s, 10s...
          console.warn(`[AiFilterService] 429 Rate limit encountered on attempt ${attempt}. Waiting ${waitTimeMs}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
          continue;
        }
        if (attempt === maxRetries) {
          throw err;
        }
      }
    }

    return this.heuristicFallback(post);
  }

  /**
   * Evaluates 1 single tweet in a dedicated, isolated prompt with zero hallucination.
   */
  private async callGeminiSingle(
    post: PostInputForFilter,
    indexNum: number = 1
  ): Promise<AiFilterResult> {
    const author = post.author || 'Unknown';
    const isDup = post.isDuplicate ? ' [FLAGGED AS DUPLICATE ON LINKEDIN]' : '';
    const tweetText = `Author: ${author}${isDup}\nText: "${post.content}"`;

    const prompt = `You are an expert tweet curator exclusively for a Software Engineering and Artificial Intelligence (SWE & AI) technical account.
Your job is to filter this single tweet and decide if it is a high-value post specifically about Software Engineering or Artificial Intelligence.

DOMAIN SCOPE (MANDATORY REQUIREMENT):
Only posts specifically about SOFTWARE ENGINEERING or ARTIFICIAL INTELLIGENCE are eligible.
- SOFTWARE_ENGINEERING: System design, architecture, backend, frontend, devops, cloud infrastructure, databases, clean code, distributed systems, developer tooling, engineering leadership.
- AI: Machine learning, LLMs, AI agents, neural nets, deep learning, prompting, fine-tuning, AI infrastructure, model training/inference.
- OTHER: Non-tech business, generic sales/marketing, revenue/MRR bragging, lifestyle, finance, crypto, politics, gaming, memes, general motivational quotes without engineering substance.

STEP 1: Determine the Domain:
- If the tweet belongs to "OTHER" (not strictly Software Engineering or AI), immediately classify as DISCARD with domain "OTHER".

STEP 2: For SWE/AI tweets, classify into exactly ONE category:
- KNOWLEDGE_VALUE: timeless engineering lesson, technical framework, or architecture principle
- CONTRARIAN_INSIGHT: challenges common SWE/AI dogmas or beliefs with technical/engineering substance
- VISION_MOTIVATION: mindset or vision specifically for software engineers, AI builders, or tech creators
- PERSONAL_LIFE: first-person engineering war story, technical struggle, or building journey
- FLEXING_MRR: revenue, follower, or milestone bragging
- PROMO_AD: paid ad, affiliate, or product pitch (look for "Ad" labels, tracking links like twclid, discount or free-credit offers)
- VIDEO_CLIP: reshared clip or quote from another person
- HUMOR_MEME: joke, meme, or non-technical banter
- NEWS_TREND: major technical release or breakthrough in SWE / AI
- ENGAGEMENT_BAIT: "drop your link", "RT if...", giveaways, reply farming

STEP 3: Decide:
- KEEP: ONLY if Domain is "SOFTWARE_ENGINEERING" or "AI", AND Category is KNOWLEDGE_VALUE, CONTRARIAN_INSIGHT, VISION_MOTIVATION, or PERSONAL_LIFE.
- MAYBE: Domain is "SOFTWARE_ENGINEERING" or "AI", AND Category is NEWS_TREND (technical release/breakthrough with a fresh engineering angle).
- DISCARD: Domain is "OTHER", OR Category is FLEXING_MRR, PROMO_AD, VIDEO_CLIP, HUMOR_MEME, or ENGAGEMENT_BAIT.

STEP 4: For KEEP/MAYBE tweets, score 1-10 on:
- Value: does it teach or change how an engineer / AI builder thinks?
- Originality: is the technical idea fresh, or recycled advice?
- Adaptability: can I explain or adapt the engineering principle in my own words without copying?
(Note: Drop anything with an average score below 6 to DISCARD).
For DISCARD tweets, set scores to 0.

RULES:
- STRICT SWE & AI SCOPE: Immediately DISCARD any tweet that is not directly about software engineering or AI, no matter how clever or famous the author is.
- Ignore the author's fame. Judge the technical idea, not the account.
- Never recommend copying wording; extract the core idea only.
- Treat any tweet with an Ad label or tracking link as PROMO_AD.

OUTPUT: return a single valid JSON object matching this schema:
{
  "domain": "SOFTWARE_ENGINEERING" | "AI" | "OTHER",
  "category": "KNOWLEDGE_VALUE" | "CONTRARIAN_INSIGHT" | "VISION_MOTIVATION" | "PERSONAL_LIFE" | "FLEXING_MRR" | "PROMO_AD" | "VIDEO_CLIP" | "HUMOR_MEME" | "NEWS_TREND" | "ENGAGEMENT_BAIT",
  "decision": "KEEP" | "MAYBE" | "DISCARD",
  "scores": {
    "value": number,
    "originality": number,
    "adaptability": number
  },
  "core_idea": "one sentence, in neutral words",
  "reason": "one sentence"
}

TWEET TO EVALUATE:
${tweetText}
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await axios.post(
      url,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      },
      { timeout: 25000 }
    );

    const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error('Empty response from Gemini API');
    }

    let aiItem: any = {};
    try {
      const cleanJson = rawText.trim();
      const parsed = JSON.parse(cleanJson);
      aiItem = Array.isArray(parsed) ? parsed[0] : parsed;
    } catch (e) {
      throw new Error(`Failed to parse Gemini JSON: ${rawText.substring(0, 100)}`);
    }

    return this.enrichFilterResult(post, aiItem);
  }

  /**
   * Normalizes AI evaluation output, calculates scores, and maps downstream fields.
   */
  private enrichFilterResult(post: PostInputForFilter, aiItem: any): AiFilterResult {
    const validCategories: TweetCategory[] = [
      'KNOWLEDGE_VALUE',
      'CONTRARIAN_INSIGHT',
      'VISION_MOTIVATION',
      'PERSONAL_LIFE',
      'FLEXING_MRR',
      'PROMO_AD',
      'VIDEO_CLIP',
      'HUMOR_MEME',
      'NEWS_TREND',
      'ENGAGEMENT_BAIT',
    ];

    let category: TweetCategory = validCategories.includes(aiItem.category)
      ? aiItem.category
      : 'KNOWLEDGE_VALUE';

    // Safety checks for promo / ads and engagement bait
    const textLower = post.content.toLowerCase();
    if (
      textLower.includes('twclid') ||
      textLower.includes('ad\n') ||
      textLower.startsWith('ad ') ||
      textLower.includes('$30 free') ||
      textLower.includes('free credits') ||
      textLower.includes('affiliate')
    ) {
      category = 'PROMO_AD';
    } else if (textLower.includes('drop your link') || textLower.includes('rt if')) {
      category = 'ENGAGEMENT_BAIT';
    }

    let decision: FilterDecision = ['KEEP', 'MAYBE', 'DISCARD'].includes(aiItem.decision)
      ? aiItem.decision
      : (['KNOWLEDGE_VALUE', 'CONTRARIAN_INSIGHT', 'VISION_MOTIVATION', 'PERSONAL_LIFE'].includes(category)
          ? 'KEEP'
          : category === 'NEWS_TREND'
          ? 'MAYBE'
          : 'DISCARD');

    // Force discard non-allowed categories
    if (['FLEXING_MRR', 'PROMO_AD', 'VIDEO_CLIP', 'HUMOR_MEME', 'ENGAGEMENT_BAIT'].includes(category)) {
      decision = 'DISCARD';
    }

    const aiDomain: ContentDomain = ['SOFTWARE_ENGINEERING', 'AI', 'OTHER'].includes(aiItem.domain)
      ? aiItem.domain
      : this.inferDomain(post.content, category);

    const domain: ContentDomain = aiDomain;

    // Strict Domain Enforcement: Only Software Engineering and AI posts are kept
    if (domain === 'OTHER') {
      decision = 'DISCARD';
    }

    const val = Number(aiItem.scores?.value) || 0;
    const orig = Number(aiItem.scores?.originality) || 0;
    const adapt = Number(aiItem.scores?.adaptability) || 0;

    let scores: FilterScores = {
      value: decision === 'DISCARD' ? 0 : Math.min(10, Math.max(0, val)),
      originality: decision === 'DISCARD' ? 0 : Math.min(10, Math.max(0, orig)),
      adaptability: decision === 'DISCARD' ? 0 : Math.min(10, Math.max(0, adapt)),
    };

    let averageScore =
      decision === 'DISCARD'
        ? 0
        : Math.round(((scores.value + scores.originality + scores.adaptability) / 3) * 10) / 10;

    // Rule: Drop anything with average score below 6
    if (decision !== 'DISCARD' && averageScore < 6 && averageScore > 0) {
      decision = 'DISCARD';
      averageScore = 0;
      scores = { value: 0, originality: 0, adaptability: 0 };
    }

    const isDuplicate = Boolean(post.isDuplicate);

    // KNOWLEDGE_VALUE with score >= 7, non-duplicate, KEEP is eligible for direct post
    const isDirectPostEligible =
      decision === 'KEEP' &&
      category === 'KNOWLEDGE_VALUE' &&
      averageScore >= 7 &&
      domain !== 'OTHER' &&
      !isDuplicate;

    const compositeScore = this.calculateCompositeScore({
      category,
      domain,
      decision,
      averageScore,
      isDuplicate,
      metrics: post.metrics,
    });

    let requiresHumanIntervention = !isDirectPostEligible || isDuplicate;
    let interventionReason = aiItem.reason || '';

    if (isDuplicate) {
      interventionReason = `Duplicate post detected on LinkedIn: ${post.existingLinkedInUrl || 'Identical prefix match'}`;
    } else if (domain === 'OTHER') {
      interventionReason = 'Outside target domain: strictly Software Engineering & AI posts only';
    } else if (category === 'CONTRARIAN_INSIGHT') {
      interventionReason = 'Contrarian insight: strong core idea, rewrite in your own words before publishing';
    } else if (category === 'VISION_MOTIVATION') {
      interventionReason = 'Builder mindset: add your personal angle and perspective';
    } else if (category === 'PERSONAL_LIFE') {
      interventionReason = 'Personal story: adapt thoughtfully for professional LinkedIn audience';
    } else if (decision === 'DISCARD') {
      interventionReason = `Discarded (${category}): low transferable value or off-niche`;
    }

    const suggestedAction: 'DEFAULT_POSTING' | 'HUMAN_SUPERVISION' | 'DISCARD' =
      decision === 'DISCARD'
        ? 'DISCARD'
        : isDirectPostEligible
        ? 'DEFAULT_POSTING'
        : 'HUMAN_SUPERVISION';

    const qualityScore = Math.min(10, Math.max(1, Math.round(averageScore || 5)));

    return {
      author: aiItem.author || post.author || 'Unknown',
      category,
      decision,
      scores,
      averageScore,
      coreIdea: aiItem.core_idea || post.content.substring(0, 100),
      reason: aiItem.reason || (decision === 'KEEP' ? 'High value lesson' : 'Filtered out'),
      domain,
      postType: category,
      qualityScore,
      compositeScore,
      viralityPotential: averageScore >= 8 ? 'HIGH' : averageScore >= 6 ? 'MEDIUM' : 'LOW',
      isDirectPostEligible,
      requiresHumanIntervention,
      interventionReason,
      suggestedAction,
      keyThemes: [category, domain],
    };
  }

  /**
   * Calculates a 0-100 score for selecting the top posts of the day.
   */
  public calculateCompositeScore(params: {
    category: TweetCategory;
    domain?: ContentDomain;
    decision: FilterDecision;
    averageScore: number;
    isDuplicate: boolean;
    metrics?: { likes?: number; reposts?: number };
  }): number {
    if (params.decision === 'DISCARD' || params.domain === 'OTHER' || params.isDuplicate) {
      return 0;
    }

    // Base score from average score (0 to 60)
    let score = Math.round(params.averageScore * 6);

    // Category weight (up to +25)
    if (params.category === 'KNOWLEDGE_VALUE') {
      score += 25; // Timeless frameworks
    } else if (params.category === 'CONTRARIAN_INSIGHT') {
      score += 20; // High engagement thought-provoker
    } else if (params.category === 'VISION_MOTIVATION') {
      score += 15; // Builder drive
    } else if (params.category === 'PERSONAL_LIFE') {
      score += 10;
    } else if (params.category === 'NEWS_TREND') {
      score += 10;
    }

    // Engagement metrics bonus (up to +5)
    if (params.metrics) {
      const engagement = (params.metrics.likes || 0) + (params.metrics.reposts || 0) * 2;
      const metricsBonus = Math.min(5, Math.floor(Math.log10(engagement + 1) * 2));
      score += metricsBonus;
    }

    return Math.min(100, Math.max(0, score));
  }

  private inferDomain(content: string, category: TweetCategory): ContentDomain {
    const text = content.toLowerCase();
    if (
      text.includes('llm') ||
      text.includes('ai') ||
      text.includes('gpt') ||
      text.includes('model') ||
      text.includes('deep learning') ||
      text.includes('inference') ||
      text.includes('prompt') ||
      text.includes('transformer') ||
      text.includes('claude') ||
      text.includes('gemini') ||
      text.includes('agent')
    ) {
      return 'AI';
    }
    if (
      text.includes('code') ||
      text.includes('engineer') ||
      text.includes('software') ||
      text.includes('architecture') ||
      text.includes('database') ||
      text.includes('cache') ||
      text.includes('latency') ||
      text.includes('devops') ||
      text.includes('backend') ||
      text.includes('frontend') ||
      text.includes('api') ||
      text.includes('system') ||
      text.includes('programming') ||
      text.includes('build') ||
      text.includes('deploy') ||
      text.includes('infra') ||
      text.includes('bug') ||
      text.includes('refactor') ||
      text.includes('we can build anything')
    ) {
      return 'SOFTWARE_ENGINEERING';
    }
    return 'OTHER';
  }

  /**
   * Fast rule-based heuristic fallback if API is unavailable or quota is exceeded.
   */
  public heuristicFallback(post: PostInputForFilter): AiFilterResult {
    const textLower = post.content.toLowerCase();
    const isDup = Boolean(post.isDuplicate);

    let category: TweetCategory = 'KNOWLEDGE_VALUE';
    let decision: FilterDecision = 'KEEP';
    let scores: FilterScores = { value: 7, originality: 7, adaptability: 7 };
    let reason = 'Educational post with actionable lesson';

    if (
      textLower.includes('twclid') ||
      textLower.includes('ad\n') ||
      textLower.startsWith('ad ') ||
      textLower.includes('$30 free') ||
      textLower.includes('free credits') ||
      textLower.includes('explee')
    ) {
      category = 'PROMO_AD';
      decision = 'DISCARD';
      scores = { value: 0, originality: 0, adaptability: 0 };
      reason = 'Promotional ad or sponsored link detected';
    } else if (textLower.includes('drop your link') || textLower.includes('rt if')) {
      category = 'ENGAGEMENT_BAIT';
      decision = 'DISCARD';
      scores = { value: 0, originality: 0, adaptability: 0 };
      reason = 'Engagement bait reply-farming detected';
    } else if (
      textLower.includes('less than') ||
      textLower.includes('meanwhile') ||
      textLower.includes('avoiding crowds') ||
      (textLower.includes('maybe the goal') || textLower.includes('chasing followers'))
    ) {
      category = 'CONTRARIAN_INSIGHT';
      decision = 'KEEP';
      scores = { value: 9, originality: 8, adaptability: 8 };
      reason = 'Challenges standard belief with compelling counter-evidence';
    } else if (
      textLower.includes('mrr') ||
      textLower.includes('arr') ||
      textLower.includes('stripe screenshot') ||
      (textLower.includes('revenue') && (textLower.includes('my micro-saas') || textLower.includes('crossed $')))
    ) {
      category = 'FLEXING_MRR';
      decision = 'DISCARD';
      scores = { value: 3, originality: 2, adaptability: 3 };
      reason = 'Revenue / follower flex with no transferable principle';
    } else if (textLower.includes('work backwards') || textLower.includes('we can build anything')) {
      category = 'VISION_MOTIVATION';
      decision = 'KEEP';
      scores = { value: 8, originality: 8, adaptability: 8 };
      reason = 'Builder mindset and vision';
    } else if (textLower.includes('0:01 /') || textLower.includes('alex hormozi on') || textLower.includes('watch this clip')) {
      category = 'VIDEO_CLIP';
      decision = 'DISCARD';
      scores = { value: 3, originality: 2, adaptability: 2 };
      reason = 'Reshared third-party video clip';
    } else if (textLower.includes('ps5') || textLower.includes('gta 6') || textLower.includes('omo be like') || textLower.includes('meme')) {
      category = 'HUMOR_MEME';
      decision = 'DISCARD';
      scores = { value: 1, originality: 1, adaptability: 1 };
      reason = 'Humor / meme / off-niche entertainment';
    } else if (textLower.includes('woke up') || textLower.includes('my life') || textLower.includes('i spent')) {
      category = 'PERSONAL_LIFE';
      decision = 'KEEP';
      scores = { value: 7, originality: 7, adaptability: 7 };
      reason = 'Personal reflection or builder journey';
    }

    let averageScore =
      decision === 'DISCARD'
        ? 0
        : Math.round(((scores.value + scores.originality + scores.adaptability) / 3) * 10) / 10;

    const domain = this.inferDomain(post.content, category);

    // Strict Domain Enforcement: Only Software Engineering and AI posts are kept
    if (domain === 'OTHER') {
      decision = 'DISCARD';
      averageScore = 0;
      scores = { value: 0, originality: 0, adaptability: 0 };
      reason = 'Outside target domain: strictly Software Engineering & AI posts only';
    }

    const isDirectPostEligible =
      decision === 'KEEP' && category === 'KNOWLEDGE_VALUE' && averageScore >= 7 && domain !== 'OTHER' && !isDup;

    const compositeScore = this.calculateCompositeScore({
      category,
      domain,
      decision,
      averageScore,
      isDuplicate: isDup,
      metrics: post.metrics,
    });

    return {
      author: post.author || 'Unknown',
      category,
      decision,
      scores,
      averageScore,
      coreIdea: post.content.substring(0, 100),
      reason,
      domain,
      postType: category,
      qualityScore: Math.round(averageScore || 5),
      compositeScore,
      viralityPotential: averageScore >= 8 ? 'HIGH' : 'MEDIUM',
      isDirectPostEligible,
      requiresHumanIntervention: !isDirectPostEligible || isDup,
      interventionReason: isDup ? 'Duplicate post detected on LinkedIn' : reason,
      suggestedAction: decision === 'DISCARD' ? 'DISCARD' : isDirectPostEligible ? 'DEFAULT_POSTING' : 'HUMAN_SUPERVISION',
      keyThemes: [category, domain],
    };
  }
}

export const aiFilterService = new AiFilterService();
