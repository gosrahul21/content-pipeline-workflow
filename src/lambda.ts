import { configure } from '@codegenie/serverless-express';
import { app } from './app.js';
import { postService } from './services/post.service.js';
import { postStore } from './db/post.store.js';
import { sqsProcessorService } from './services/sqs-processor.service.js';

// 1. Cached serverless-express instance for API Gateway / Lambda Function URL
let cachedApiHandler: any;

function getApiHandler() {
  if (!cachedApiHandler) {
    cachedApiHandler = configure({ app });
  }
  return cachedApiHandler;
}

/**
 * Handler A: API Gateway & Function URL HTTP Requests
 * Handles: GET /health, POST /api/posts, POST /api/posts/schedule-batch, etc.
 */
export const apiHandler = async (event: any, context: any, callback?: any) => {
  const handler = getApiHandler();
  return handler(event, context, callback);
};

/**
 * Handler B: AWS EventBridge Scheduler Execution (Option 1)
 * Fired at the exact scheduled second with payload:
 * { "source": "aws.scheduler", "action": "PUBLISH_POST", "postId": "uuid-here" }
 */
export const schedulerHandler = async (event: any, context?: any) => {
  console.log('[Lambda:schedulerHandler] Invoked with event:', JSON.stringify(event));

  const postId = event.postId || event.detail?.postId;

  if (postId) {
    console.log(`[Lambda:schedulerHandler] Publishing scheduled post ID: ${postId}`);
    const post = await postService.publishPostNow(postId);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, post }),
    };
  }

  // Fallback: Check due posts if triggered without specific postId
  const duePosts = postStore.findDueScheduledPosts();
  console.log(`[Lambda:schedulerHandler] Found ${duePosts.length} due post(s) to publish`);

  for (const p of duePosts) {
    await postService.publishPostNow(p);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, processedCount: duePosts.length }),
  };
};

/**
 * Handler C: AWS SQS Queue Consumer
 * Handles incoming post records pushed to the SQS queue.
 * Routes through AI Filtration & Categorization, Telegram supervision, and Post Service.
 */
export const sqsHandler = async (event: { Records: Array<{ body: string; messageId: string }> }) => {
  console.log(`[Lambda:sqsHandler] Processing ${event.Records?.length || 0} SQS record(s)...`);
  const outcomes = [];

  for (const record of event.Records || []) {
    try {
      const payload = JSON.parse(record.body);
      console.log(`[Lambda:sqsHandler] Processing message ${record.messageId}:`, payload.content?.substring(0, 60));
      const outcome = await sqsProcessorService.processSqsPost(payload);
      outcomes.push(outcome);
    } catch (err: any) {
      console.error(`[Lambda:sqsHandler] Failed to process message ${record.messageId}:`, err);
      throw err; // Trigger SQS retry / DLQ
    }
  }

  return {
    statusCode: 200,
    processedCount: event.Records?.length || 0,
    outcomes,
  };
};

/**
 * Universal Unified Lambda Handler (Default Export).
 * 
 * Auto-detects the event source and routes to the correct handler:
 * - SQS Event (contains `Records[0].messageId` or `eventSource === 'aws:sqs'`) -> routes to sqsHandler
 * - EventBridge Scheduler (contains `action === 'PUBLISH_POST'` or `source === 'aws.scheduler'`) -> routes to schedulerHandler
 * - API Gateway / Function URL HTTP Request -> routes to apiHandler
 * 
 * Set Lambda configuration Handler to: `dist/lambda.handler`
 */
export const handler = async (event: any, context: any, callback?: any) => {
  // 1. Detect SQS Event
  if (event.Records && Array.isArray(event.Records) && event.Records[0]?.eventSource === 'aws:sqs') {
    return sqsHandler(event);
  }

  // 2. Detect EventBridge Scheduler Event
  if (event.source === 'aws.scheduler' || event.action === 'PUBLISH_POST') {
    return schedulerHandler(event, context);
  }

  // 3. Fallback to HTTP API Handler (API Gateway / Function URL / ALB)
  return apiHandler(event, context, callback);
};
