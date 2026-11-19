import { Router, Request, Response } from 'express';
import axios from 'axios';
import { sqsProcessorService } from '../services/sqs-processor.service.js';
import { telegramService } from '../services/telegram.service.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * Universal Supervision Callback (For Web, Mobile App, or direct testing):
 * Body: { postId: string, action: "post_now" | "schedule" | "improvise" | "post_now_revised" | "schedule_revised" | "reject", customInstructions?: string }
 */
router.post('/callback', async (req: Request, res: Response) => {
  try {
    const { postId, action, customInstructions } = req.body;

    if (!postId || !action) {
      return res.status(400).json({ error: 'postId and action are required' });
    }

    const result = await sqsProcessorService.handleSupervisionAction({
      postId,
      action,
      customInstructions,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[SupervisionRoutes] Error handling callback:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * On-demand Top-N Daily Ranking Endpoint:
 * Evaluates candidate posts for SWE/AI domain, scores Knowledge vs Life vs MRR,
 * and sends the Top 3 to Telegram for human review/action.
 * Body: { posts: [...] }
 */
router.post('/rank-top-3', async (req: Request, res: Response) => {
  try {
    const { posts } = req.body;
    if (!posts || !Array.isArray(posts) || posts.length === 0) {
      return res.status(400).json({ error: 'posts array is required' });
    }

    const result = await sqsProcessorService.rankAndSelectTopPosts(posts, 3);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[SupervisionRoutes] Error ranking top posts:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Telegram Webhook Handler:
 * Receives callback_query updates when a user taps inline buttons in Telegram.
 */
router.post('/telegram/webhook', async (req: Request, res: Response) => {
  try {
    const update = req.body;

    if (update.callback_query) {
      const callbackQueryId = update.callback_query.id;
      const data = update.callback_query.data; // e.g. "post_now:postId", "schedule:postId"
      const [action, postId] = data.split(':');
      const chatId = update.callback_query.message?.chat?.id;

      console.log(`[TelegramWebhook] Callback query received: action=${action}, postId=${postId}`);

      // 1. Immediately acknowledge Telegram to unfreeze button spinner
      await telegramService.answerCallbackQuery(callbackQueryId, `Processing ${action}...`);

      // 2. Execute requested action
      if (action && postId) {
        const result = await sqsProcessorService.handleSupervisionAction({
          postId,
          action: action as any,
        });

        // 3. Send feedback notification back to Telegram chat
        if (result.success) {
          if (action === 'post_now' || action === 'post_now_revised') {
            await telegramService.sendMessage(
              `🚀 <b>Post Published Live to LinkedIn!</b>\n🔗 <a href="${result.publishedUrl || 'https://www.linkedin.com/feed/'}">View on LinkedIn</a>`,
              String(chatId)
            );
          } else if (action === 'schedule' || action === 'schedule_revised') {
            await telegramService.sendMessage(
              `📅 <b>Post Scheduled!</b>\nTarget Time: <code>${result.scheduledAt}</code>`,
              String(chatId)
            );
          } else if (action === 'reject') {
            await telegramService.sendMessage(`❌ Post cancelled.`, String(chatId));
          }
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[TelegramWebhook] Error handling webhook:', err);
    return res.status(200).json({ ok: false, error: err.message }); // Always return 200 to Telegram
  }
});

/**
 * Test Telegram Bot Connectivity:
 * GET /api/supervision/telegram/test
 */
router.get('/telegram/test', async (_req: Request, res: Response) => {
  const result = await telegramService.testConnection();
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.status(200).json(result);
});

/**
 * Register Telegram Webhook URL:
 * POST /api/supervision/telegram/set-webhook
 * Body: { webhookUrl: "https://your-domain-or-lambda/api/supervision/telegram/webhook" }
 */
router.post('/telegram/set-webhook', async (req: Request, res: Response) => {
  const { webhookUrl } = req.body;
  const botToken = config.telegram.botToken;

  if (!botToken) {
    return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN is not configured in .env' });
  }
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    return res.status(400).json({ error: 'webhookUrl (https://...) is required' });
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    const response = await axios.get(url);
    return res.status(200).json(response.data);
  } catch (err: any) {
    return res.status(500).json({ error: err.response?.data?.description || err.message });
  }
});

export default router;
