import { v4 as uuidv4 } from 'uuid';
import { aiFilterService } from './ai-filter.service.js';
import { aiImproviserService } from './ai-improviser.service.js';
import { telegramService } from './telegram.service.js';
import { postService } from './post.service.js';
import { postStore } from '../db/post.store.js';
import { schedulerService } from './scheduler.service.js';
import { config } from '../config/env.js';
export class SqsProcessorService {
    /**
     * Process a batch of scraped posts (e.g. 30 items), evaluate them for domain
     * (SWE & AI) and category (Knowledge/Value vs Personal vs MRR Flex), rank them,
     * and send the Top 3 to Telegram for human review/actions.
     */
    async rankAndSelectTopPosts(messages, topN = 3) {
        console.log(`\n===============================================================`);
        console.log(`[Top-3 Selection] Ranking ${messages.length} scraped posts for today...`);
        console.log(`[Top-${topN} Selection] Evaluating ${messages.length} incoming candidate posts with AI filter...`);
        console.log(`===============================================================`);
        // 1. Evaluate all posts in batch
        const evalResults = await aiFilterService.evaluateBatch(messages.map((m) => ({
            content: m.content,
            author: m.author,
            isDuplicate: m.isDuplicate,
            existingLinkedInUrl: m.existingLinkedInUrl,
            metrics: m.metrics,
        })));
        const evaluatedItems = [];
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const evalResult = evalResults[i];
            const postId = msg.id || uuidv4();
            const rawMedia = (msg.media || []).map((m) => ({
                id: uuidv4(),
                type: (m.type?.toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE'),
                url: m.url,
                s3Key: m.s3Key,
            }));
            const now = new Date().toISOString();
            const post = {
                id: postId,
                sourceTweetId: msg.originalTweetId,
                originalText: msg.content,
                content: msg.content,
                media: rawMedia,
                status: 'PENDING_REVIEW',
                platform: 'LINKEDIN',
                metadata: {
                    category: evalResult.category,
                    decision: evalResult.decision,
                    scores: evalResult.scores,
                    averageScore: evalResult.averageScore,
                    coreIdea: evalResult.coreIdea,
                    domain: evalResult.domain,
                    postType: evalResult.postType,
                    qualityScore: evalResult.qualityScore,
                    compositeScore: evalResult.compositeScore,
                    viralityPotential: evalResult.viralityPotential,
                    isDirectPostEligible: evalResult.isDirectPostEligible,
                    isDuplicate: msg.isDuplicate,
                    existingLinkedInUrl: msg.existingLinkedInUrl,
                    author: msg.author,
                    source: msg.source,
                    extractedAt: msg.extractedAt,
                },
                createdAt: now,
                updatedAt: now,
            };
            postStore.save(post);
            evaluatedItems.push({ message: msg, post, evalResult });
        }
        // 2. Filter eligible candidates (Keep only KEEP or MAYBE decisions, non-duplicates, and score >= 6)
        const eligible = evaluatedItems.filter((item) => item.evalResult.decision !== 'DISCARD' && !item.message.isDuplicate && item.evalResult.averageScore >= 6);
        console.log(`[Top-${topN} Selection] ${eligible.length}/${messages.length} posts passed AI filtration (non-discard & non-duplicate).`);
        // 3. Sort candidates by composite score (KNOWLEDGE_VALUE & CONTRARIAN_INSIGHT get top priority)
        eligible.sort((a, b) => b.evalResult.compositeScore - a.evalResult.compositeScore);
        // 4. Apply Diversity across categories (Knowledge, Contrarian, Vision, etc.)
        const selected = [];
        const usedCategories = new Set();
        for (const item of eligible) {
            if (!usedCategories.has(item.evalResult.category) && selected.length < topN) {
                selected.push(item);
                usedCategories.add(item.evalResult.category);
            }
        }
        // Fill remaining spots from highest composite score among remaining eligible
        for (const item of eligible) {
            if (selected.length >= topN)
                break;
            if (!selected.includes(item)) {
                selected.push(item);
            }
        }
        // Fallback if less than topN eligible: take non-duplicate candidates
        if (selected.length < topN) {
            for (const item of evaluatedItems) {
                if (!selected.includes(item) && !item.message.isDuplicate) {
                    selected.push(item);
                    if (selected.length >= topN)
                        break;
                }
            }
        }
        console.log(`\n🏆 [Top-3 Selection] Selected Top ${selected.length} Posts for Today:`);
        const topResults = [];
        // 5. Send Telegram review cards for the selected Top Posts
        for (let rank = 1; rank <= selected.length; rank++) {
            const item = selected[rank - 1];
            console.log(`#${rank}: [${item.evalResult.domain} | ${item.evalResult.postType}] Score: ${item.evalResult.qualityScore}/10 (Rank Score: ${item.evalResult.compositeScore}) - "${item.post.content.substring(0, 60)}..."`);
            await telegramService.sendSupervisionRequest({
                postId: item.post.id,
                rank,
                totalRanked: selected.length,
                domain: item.evalResult.domain,
                postType: item.evalResult.postType,
                category: item.evalResult.category,
                decision: item.evalResult.decision,
                scores: item.evalResult.scores,
                averageScore: item.evalResult.averageScore,
                coreIdea: item.evalResult.coreIdea,
                isDirectPostEligible: item.evalResult.isDirectPostEligible,
                author: item.message.author,
                content: item.post.content,
                qualityScore: item.evalResult.qualityScore,
                isDuplicate: item.message.isDuplicate,
                existingLinkedInUrl: item.message.existingLinkedInUrl,
                reason: item.evalResult.interventionReason,
            });
            topResults.push({
                rank,
                postId: item.post.id,
                domain: item.evalResult.domain,
                postType: item.evalResult.postType,
                qualityScore: item.evalResult.qualityScore,
                compositeScore: item.evalResult.compositeScore,
                isDirectPostEligible: item.evalResult.isDirectPostEligible,
                post: item.post,
            });
        }
        return {
            totalReceived: messages.length,
            candidatesCount: eligible.length,
            topSelectedCount: topResults.length,
            topPosts: topResults,
        };
    }
    /**
     * Process a single post consumed from SQS.
     */
    async processSqsPost(message) {
        const postId = message.id || uuidv4();
        console.log(`\n[SqsProcessor] Processing single post ${postId} from queue...`);
        // Handle skipAiFilter flag: bypass AI evaluation and directly publish to LinkedIn
        const shouldSkipAi = Boolean(message.skipAiFilter || message.metadata?.skipAiFilter);
        if (shouldSkipAi) {
            console.log(`[SqsProcessor] ⚡ skipAiFilter is TRUE for post ${postId}. Bypassing AI filtration and directly publishing to LinkedIn...`);
            const rawMedia = (message.media || []).map((m) => ({
                id: uuidv4(),
                type: (String(m.type).toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE'),
                url: m.url,
                s3Key: m.s3Key,
            }));
            const now = new Date().toISOString();
            const post = {
                id: postId,
                sourceTweetId: message.originalTweetId,
                originalText: message.content,
                content: message.content,
                media: rawMedia,
                status: 'PUBLISHING',
                platform: 'LINKEDIN',
                metadata: {
                    skippedAiFilter: true,
                    author: message.author,
                    source: message.source,
                    extractedAt: message.extractedAt,
                },
                createdAt: now,
                updatedAt: now,
            };
            postStore.save(post);
            // Directly publish to LinkedIn (extracts media to S3 -> uploads to LinkedIn -> cleans up S3)
            const publishedPost = await postService.publishPostNow(post);
            const publishedUrl = publishedPost.linkedinPostUrn
                ? `https://www.linkedin.com/feed/update/${publishedPost.linkedinPostUrn}`
                : undefined;
            console.log(`[SqsProcessor] ✅ Direct publish completed: ${publishedPost.status} (${publishedPost.linkedinPostUrn || publishedPost.error})`);
            if (telegramService.isConfigured()) {
                await telegramService.sendMessage(`🚀 <b>[Content Engine] Post Published to LinkedIn (Direct Flow)</b>\n\n` +
                    `👤 <b>Author:</b> ${message.author || 'Unknown'}\n` +
                    `📝 <b>Content:</b> <blockquote>${message.content}</blockquote>\n` +
                    (publishedUrl ? `🔗 <a href="${publishedUrl}">View on LinkedIn</a>\n` : '') +
                    `📊 <b>Status:</b> ${publishedPost.status}` +
                    (publishedPost.error ? `\n⚠️ <i>Error: ${publishedPost.error}</i>` : ''));
            }
            return {
                postId,
                actionTaken: 'DIRECTLY_PUBLISHED',
                post: publishedPost,
                publishedUrl,
            };
        }
        const evalResult = await aiFilterService.evaluatePost({
            content: message.content,
            author: message.author,
            isDuplicate: message.isDuplicate,
            existingLinkedInUrl: message.existingLinkedInUrl,
            metrics: message.metrics,
        });
        console.log(`[SqsProcessor] AI Evaluation: Domain=${evalResult.domain}, PostType=${evalResult.postType}, Score=${evalResult.qualityScore}/10, DirectPostReady=${evalResult.isDirectPostEligible}`);
        const now = new Date().toISOString();
        const rawMedia = (message.media || []).map((m) => ({
            id: uuidv4(),
            type: (m.type?.toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE'),
            url: m.url,
            s3Key: m.s3Key,
        }));
        const post = {
            id: postId,
            sourceTweetId: message.originalTweetId,
            originalText: message.content,
            content: message.content,
            media: rawMedia,
            status: 'PENDING_REVIEW',
            platform: 'LINKEDIN',
            metadata: {
                domain: evalResult.domain,
                postType: evalResult.postType,
                category: evalResult.category,
                qualityScore: evalResult.qualityScore,
                compositeScore: evalResult.compositeScore,
                viralityPotential: evalResult.viralityPotential,
                isDirectPostEligible: evalResult.isDirectPostEligible,
                isDuplicate: message.isDuplicate,
                existingLinkedInUrl: message.existingLinkedInUrl,
                author: message.author,
                source: message.source,
                extractedAt: message.extractedAt,
            },
            createdAt: now,
            updatedAt: now,
        };
        postStore.save(post);
        if (evalResult.domain === 'OTHER' && !message.isDuplicate) {
            console.log(`[SqsProcessor] Post is outside target domain (SWE/AI). Status kept in review.`);
        }
        // Send to Telegram Channel with interactive actions (Post Directly, Schedule, Improvise, Reject)
        await telegramService.sendSupervisionRequest({
            postId,
            domain: evalResult.domain,
            postType: evalResult.postType,
            category: evalResult.category,
            decision: evalResult.decision,
            scores: evalResult.scores,
            averageScore: evalResult.averageScore,
            coreIdea: evalResult.coreIdea,
            isDirectPostEligible: evalResult.isDirectPostEligible,
            author: message.author,
            content: message.content,
            qualityScore: evalResult.qualityScore,
            isDuplicate: message.isDuplicate,
            existingLinkedInUrl: message.existingLinkedInUrl,
            reason: evalResult.interventionReason,
        });
        return {
            postId,
            actionTaken: 'SENT_TO_SUPERVISION',
            domain: evalResult.domain,
            postType: evalResult.postType,
            qualityScore: evalResult.qualityScore,
            compositeScore: evalResult.compositeScore,
            isDirectPostEligible: evalResult.isDirectPostEligible,
            requiresHumanIntervention: evalResult.requiresHumanIntervention,
            interventionReason: evalResult.interventionReason,
            post,
        };
    }
    /**
     * Universal Supervision Action Handler:
     * Supports:
     * - 'post_now' / 'post_now_revised': Publishes immediately to LinkedIn via PostService
     * - 'schedule' / 'schedule_revised' / 'approve': Schedules in daily window via EventBridge
     * - 'improvise': Calls AI Post Improviser to rewrite for LinkedIn
     * - 'reject': Cancels post
     */
    async handleSupervisionAction(params) {
        const post = postStore.findById(params.postId);
        if (!post) {
            return { success: false, action: params.action, error: `Post ${params.postId} not found` };
        }
        console.log(`[Supervision] Received action '${params.action}' for post ${params.postId}`);
        // Ensure any remote media is downloaded to S3 first
        let media = post.media || [];
        if (media.some((m) => m.url && !m.s3Key)) {
            console.log(`[Supervision] Extracting remote media to S3 for post ${post.id}...`);
            const { mediaExtractorService } = await import('./media-extractor.service.js');
            media = await mediaExtractorService.extractAndStoreMedia(media, post.id);
            post.media = media;
            postStore.save(post);
        }
        switch (params.action) {
            // 1. Direct Immediate Post to LinkedIn
            case 'post_now':
            case 'post_now_revised': {
                console.log(`[Supervision] Direct Post triggered for post ${post.id}...`);
                const publishedPost = await postService.publishPostNow(post);
                const publishedUrl = publishedPost.linkedinPostUrn
                    ? `https://www.linkedin.com/feed/update/${publishedPost.linkedinPostUrn}`
                    : undefined;
                console.log(`[Supervision] ✅ Post ${post.id} successfully published to LinkedIn: ${publishedUrl || publishedPost.linkedinPostUrn}`);
                return {
                    success: publishedPost.status === 'PUBLISHED',
                    action: params.action,
                    post: publishedPost,
                    publishedUrl,
                };
            }
            // 2. Schedule across randomized EventBridge window
            case 'schedule':
            case 'schedule_revised':
            case 'approve':
            case 'approve_improved': {
                const [scheduledTimestamp] = schedulerService.generateRandomSchedule(1, {
                    windowStart: config.scheduler.defaultWindowStart,
                    windowEnd: config.scheduler.defaultWindowEnd,
                });
                post.status = 'SCHEDULED';
                post.scheduledAt = scheduledTimestamp.toISOString();
                post.updatedAt = new Date().toISOString();
                postStore.save(post);
                // Register with AWS EventBridge Scheduler
                const { awsSchedulerService } = await import('./aws-scheduler.service.js');
                await awsSchedulerService.schedulePost(post.id, scheduledTimestamp);
                console.log(`[Supervision] Post ${post.id} scheduled for ${post.scheduledAt}`);
                return {
                    success: true,
                    action: params.action,
                    post,
                    scheduledAt: post.scheduledAt,
                };
            }
            // 3. AI Post Improviser
            case 'improvise': {
                console.log(`[Supervision] Invoking AI Post Improviser for post ${post.id}...`);
                const result = await aiImproviserService.improvisePost({
                    content: post.originalText || post.content,
                    author: post.metadata?.author,
                    isDuplicate: Boolean(post.metadata?.isDuplicate),
                    instructions: params.customInstructions,
                });
                post.content = result.improvedContent;
                post.metadata = {
                    ...post.metadata,
                    aiImprovised: true,
                    hook: result.hook,
                    takeaways: result.takeaways,
                    suggestedHashtags: result.suggestedHashtags,
                };
                post.updatedAt = new Date().toISOString();
                postStore.save(post);
                // Send revised review card to Telegram
                await telegramService.sendImprovisedReview({
                    postId: post.id,
                    originalContent: post.originalText || post.content,
                    improvedContent: result.improvedContent,
                    hook: result.hook,
                    takeaways: result.takeaways,
                });
                return {
                    success: true,
                    action: 'improvise',
                    post,
                    revisedContent: result.improvedContent,
                };
            }
            // 4. Reject
            case 'reject': {
                post.status = 'CANCELLED';
                post.updatedAt = new Date().toISOString();
                postStore.save(post);
                console.log(`[Supervision] Post ${post.id} rejected by user`);
                return { success: true, action: 'reject', post };
            }
            default:
                return { success: false, action: params.action, error: `Unknown action: ${params.action}` };
        }
    }
}
export const sqsProcessorService = new SqsProcessorService();
