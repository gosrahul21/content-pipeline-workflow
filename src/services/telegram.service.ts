import axios from 'axios';
import { config } from '../config/env.js';
import { ContentDomain, PostType, TweetCategory, FilterDecision, FilterScores } from './ai-filter.service.js';

export interface TelegramNotificationParams {
  postId: string;
  rank?: number;
  totalRanked?: number;
  domain?: ContentDomain;
  postType?: PostType;
  category?: TweetCategory | string;
  decision?: FilterDecision;
  scores?: FilterScores;
  averageScore?: number;
  coreIdea?: string;
  isDirectPostEligible?: boolean;
  author?: string;
  content: string;
  qualityScore?: number;
  isDuplicate?: boolean;
  existingLinkedInUrl?: string | null;
  reason?: string;
}

export class TelegramService {
  private botToken: string;
  private chatId: string;
  private pollingActive = false;
  private lastUpdateId = 0;

  constructor() {
    this.botToken = config.telegram.botToken;
    this.chatId = config.telegram.chatId;
  }

  public isConfigured(): boolean {
    return Boolean(config.telegram.botToken && config.telegram.chatId);
  }

  /**
   * Start long polling for Telegram updates (callback queries from inline buttons).
   * Runs seamlessly when no webhook URL is configured, enabling instant approvals.
   */
  public async startPolling(
    onAction?: (action: string, postId: string, callbackQueryId: string, chatId: number | string) => Promise<void>
  ): Promise<void> {
    if (this.pollingActive || !this.botToken) return;

    try {
      // Check if a webhook is already active
      const webhookRes = await axios.get(`https://api.telegram.org/bot${this.botToken}/getWebhookInfo`);
      if (webhookRes.data?.result?.url) {
        console.log(`[TelegramService] Remote webhook active (${webhookRes.data.result.url}). Long polling skipped.`);
        return;
      }
    } catch (e: any) {
      console.warn('[TelegramService] Warning checking webhook info:', e.message);
    }

    this.pollingActive = true;
    console.log('[TelegramService] 🤖 Telegram Long Polling active. Listening for inline button approvals in chat...');

    const poll = async () => {
      while (this.pollingActive) {
        try {
          const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=20`;
          const response = await axios.get(url, { timeout: 25000 });
          const updates = response.data?.result || [];

          for (const update of updates) {
            this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);

            if (update.callback_query) {
              const callbackQuery = update.callback_query;
              const data = callbackQuery.data || '';
              const [action, postId] = data.split(':');
              const chatId = callbackQuery.message?.chat?.id || this.chatId;

              console.log(`[TelegramService] 🔘 Button tapped in Telegram: action='${action}', postId='${postId}'`);

              // 1. Immediately acknowledge Telegram to unfreeze button spinner
              await this.answerCallbackQuery(callbackQuery.id, `Processing ${action}...`);

              // 2. Dispatch action to sqsProcessorService
              if (onAction) {
                await onAction(action, postId, callbackQuery.id, chatId);
              } else {
                const { sqsProcessorService } = await import('./sqs-processor.service.js');
                const result = await sqsProcessorService.handleSupervisionAction({
                  postId,
                  action: action as any,
                });

                if (result.success) {
                  if (action === 'post_now' || action === 'post_now_revised') {
                    await this.sendMessage(
                      `🚀 <b>Post Published Live to LinkedIn!</b>\n🔗 <a href="${result.publishedUrl || 'https://www.linkedin.com/feed/'}">View on LinkedIn</a>`,
                      String(chatId)
                    );
                  } else if (action === 'schedule' || action === 'schedule_revised') {
                    await this.sendMessage(
                      `📅 <b>Post Scheduled!</b>\nTarget Time: <code>${result.scheduledAt}</code>`,
                      String(chatId)
                    );
                  } else if (action === 'reject') {
                    await this.sendMessage(`❌ <b>Post rejected and cancelled.</b>`, String(chatId));
                  }
                } else {
                  await this.sendMessage(`⚠️ <b>Action failed:</b> ${result.error}`, String(chatId));
                }
              }
            }
          }
        } catch (err: any) {
          if (err.response?.status === 409) {
            console.warn('[TelegramService] Telegram polling conflict. Retrying in 10s...');
            await new Promise((r) => setTimeout(r, 10000));
          } else {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    };

    poll().catch((err) => {
      console.error('[TelegramService] Polling loop error:', err);
      this.pollingActive = false;
    });
  }

  public stopPolling(): void {
    this.pollingActive = false;
  }

  /**
   * Test connection to Telegram Bot API.
   */
  async testConnection(): Promise<{ success: boolean; botInfo?: any; error?: string }> {
    if (!this.botToken) {
      return { success: false, error: 'TELEGRAM_BOT_TOKEN is not set in .env' };
    }

    try {
      const meUrl = `https://api.telegram.org/bot${this.botToken}/getMe`;
      const meRes = await axios.get(meUrl);
      const botInfo = meRes.data?.result;

      if (this.chatId) {
        const sendUrl = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
        await axios.post(sendUrl, {
          chat_id: this.chatId,
          text: `🤖 <b>Content Engine Bot Connected!</b>\n\nBot: @${botInfo.username}\nChat ID: <code>${this.chatId}</code>\nReady to receive top posts and human supervision!`,
          parse_mode: 'HTML',
        });
      }

      return { success: true, botInfo };
    } catch (err: any) {
      return { success: false, error: err.response?.data?.description || err.message };
    }
  }

  /**
   * Send interactive review card for a filtered top post to Telegram.
   * Actions: Post Directly, Schedule, AI Improvise, or Reject.
   */
  async sendSupervisionRequest(params: TelegramNotificationParams): Promise<{ success: boolean; messageId?: string; simulated?: boolean }> {
    const text = this.formatMessageText(params);
    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '🚀 Post Directly', callback_data: `post_now:${params.postId}` },
          { text: '📅 Schedule', callback_data: `schedule:${params.postId}` },
        ],
        [
          { text: '✨ AI Improvise', callback_data: `improvise:${params.postId}` },
          { text: '❌ Reject', callback_data: `reject:${params.postId}` },
        ],
      ],
    };

    if (!this.isConfigured()) {
      console.log('\n[Telegram:Simulated] Interactive Notification Dispatched:');
      console.log('----------------------------------------------------');
      console.log(text.trim());
      console.log('\nInline Actions:');
      console.log('1. [🚀 Post Directly] -> POST /api/supervision/callback { "action": "post_now", "postId": "' + params.postId + '" }');
      console.log('2. [📅 Schedule]      -> POST /api/supervision/callback { "action": "schedule", "postId": "' + params.postId + '" }');
      console.log('3. [✨ AI Improvise]  -> POST /api/supervision/callback { "action": "improvise", "postId": "' + params.postId + '" }');
      console.log('4. [❌ Reject]        -> POST /api/supervision/callback { "action": "reject", "postId": "' + params.postId + '" }');
      console.log('----------------------------------------------------\n');

      return {
        success: true,
        messageId: `sim-tg-${Date.now()}`,
        simulated: true,
      };
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await axios.post(url, {
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard,
      });

      return {
        success: true,
        messageId: String(response.data?.result?.message_id),
      };
    } catch (err: any) {
      console.error('[TelegramService] Error sending Telegram message:', err.response?.data || err.message);
      return { success: false };
    }
  }

  /**
   * Send the revised / improvised post to Telegram with direct post or schedule options.
   */
  async sendImprovisedReview(params: {
    postId: string;
    originalContent: string;
    improvedContent: string;
    hook?: string;
    takeaways?: string[];
  }): Promise<{ success: boolean; simulated?: boolean }> {
    const text = `
✨ <b>[AI Post Improviser] Post Rewritten for LinkedIn</b>

<b>Original Hook:</b>
<i>${(params.hook || params.originalContent).substring(0, 140)}...</i>

<b>Revised Content:</b>
----------------------------------------
${params.improvedContent}
----------------------------------------
`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '🚀 Post Revised Now', callback_data: `post_now_revised:${params.postId}` },
          { text: '📅 Schedule Revised', callback_data: `schedule_revised:${params.postId}` },
        ],
        [
          { text: '🔄 Re-Improvise', callback_data: `improvise:${params.postId}` },
          { text: '❌ Reject', callback_data: `reject:${params.postId}` },
        ],
      ],
    };

    if (!this.isConfigured()) {
      console.log('\n[Telegram:Simulated] Revised Post Review Card:');
      console.log(text.trim());
      console.log('\nInline Actions:');
      console.log('1. [🚀 Post Revised Now] -> POST /api/supervision/callback { "action": "post_now_revised", "postId": "' + params.postId + '" }');
      console.log('2. [📅 Schedule Revised] -> POST /api/supervision/callback { "action": "schedule_revised", "postId": "' + params.postId + '" }');
      console.log('3. [🔄 Re-Improvise]     -> POST /api/supervision/callback { "action": "improvise", "postId": "' + params.postId + '" }');
      console.log('----------------------------------------------------\n');
      return { success: true, simulated: true };
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      await axios.post(url, {
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard,
      });

      return { success: true };
    } catch (err: any) {
      console.error('[TelegramService] Error sending revised review:', err.response?.data || err.message);
      return { success: false };
    }
  }

  /**
   * Answer a Telegram callback query (unfreezes user's button click spinner).
   */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    if (!this.botToken || !callbackQueryId) return;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/answerCallbackQuery`;
      await axios.post(url, {
        callback_query_id: callbackQueryId,
        text: text || 'Processing...',
        show_alert: false,
      });
    } catch (err: any) {
      console.warn('[TelegramService] answerCallbackQuery warning:', err.response?.data?.description || err.message);
    }
  }

  /**
   * Edit an existing message in-place (e.g. after user approves or rejects).
   */
  async editMessageText(chatId: string | number, messageId: number, newText: string, replyMarkup?: any): Promise<void> {
    if (!this.botToken) return;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/editMessageText`;
      await axios.post(url, {
        chat_id: chatId,
        message_id: messageId,
        text: newText,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
    } catch (err: any) {
      console.warn('[TelegramService] editMessageText warning:', err.response?.data?.description || err.message);
    }
  }

  /**
   * Send a general message or confirmation notification to the channel.
   */
  async sendMessage(text: string, chatIdOverride?: string): Promise<boolean> {
    const targetChat = chatIdOverride || this.chatId;
    if (!this.botToken || !targetChat) {
      console.log(`[Telegram:Simulated Message] ${text}`);
      return true;
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      await axios.post(url, {
        chat_id: targetChat,
        text,
        parse_mode: 'HTML',
      });
      return true;
    } catch (err: any) {
      console.error('[TelegramService] sendMessage error:', err.response?.data || err.message);
      return false;
    }
  }

  private formatMessageText(params: TelegramNotificationParams): string {
    const rankHeader = params.rank
      ? `🏆 <b>Top Post #${params.rank}${params.totalRanked ? ` of ${params.totalRanked}` : ''} for Today</b>\n\n`
      : `🚨 <b>[Content Engine] Post Review</b>\n\n`;

    const domainIcon = params.domain === 'AI' ? '🤖' : params.domain === 'SOFTWARE_ENGINEERING' ? '💻' : params.domain === 'BUSINESS' ? '💼' : '🌐';
    const domainLabel = params.domain ? `${domainIcon} <b>Domain:</b> ${params.domain}\n` : '';

    const cat = params.category || params.postType;
    let typeBadge = '';
    if (cat === 'KNOWLEDGE_VALUE') {
      typeBadge = '💎 <b>Category:</b> KNOWLEDGE / VALUE (Direct-Post Ready)\n';
    } else if (cat === 'CONTRARIAN_INSIGHT') {
      typeBadge = '💡 <b>Category:</b> CONTRARIAN INSIGHT (Rewrite / Adapt Recommended)\n';
    } else if (cat === 'VISION_MOTIVATION') {
      typeBadge = '🚀 <b>Category:</b> BUILDER VISION / MINDSET (Add Your Angle)\n';
    } else if (cat === 'PERSONAL_LIFE') {
      typeBadge = '🏖️ <b>Category:</b> PERSONAL STORY / LESSON (Adapt for LinkedIn)\n';
    } else if (cat === 'NEWS_TREND') {
      typeBadge = '📰 <b>Category:</b> NEWS / TRENDING REACTION\n';
    } else if (cat === 'FLEXING_MRR') {
      typeBadge = '💰 <b>Category:</b> MRR / REVENUE FLEX (Discard / Improvise Only)\n';
    } else if (cat === 'PROMO_AD') {
      typeBadge = '🚫 <b>Category:</b> PROMOTIONAL AD\n';
    } else if (cat === 'VIDEO_CLIP') {
      typeBadge = '🎥 <b>Category:</b> VIDEO CLIP RESHARE\n';
    } else if (cat === 'HUMOR_MEME') {
      typeBadge = '🎭 <b>Category:</b> HUMOR / MEME\n';
    } else if (cat === 'ENGAGEMENT_BAIT') {
      typeBadge = '🎣 <b>Category:</b> ENGAGEMENT BAIT\n';
    } else if (cat) {
      typeBadge = `📝 <b>Category:</b> ${cat}\n`;
    }

    const decisionBadge = params.decision
      ? `🎯 <b>Decision:</b> <code>${params.decision}</code>\n`
      : '';

    let scoresText = '';
    if (params.scores && (params.scores.value > 0 || params.scores.originality > 0 || params.scores.adaptability > 0)) {
      scoresText = `📊 <b>Scores:</b> Value: ${params.scores.value}/10 | Originality: ${params.scores.originality}/10 | Adaptability: ${params.scores.adaptability}/10 (Avg: ${params.averageScore || params.qualityScore || 0}/10)\n`;
    } else if (params.qualityScore) {
      scoresText = `📊 <b>Quality Score:</b> ${params.qualityScore}/10\n`;
    }

    const coreIdeaText = params.coreIdea
      ? `🧠 <b>Core Idea:</b> <i>${params.coreIdea}</i>\n`
      : '';

    const valueNotice = params.isDirectPostEligible
      ? '✅ <i>Value Post - Verified high quality, can be shared directly to LinkedIn!</i>\n'
      : '';

    const dupNotice = params.isDuplicate
      ? `⚠️ <b>DUPLICATE DETECTED</b>\n🔗 <a href="${params.existingLinkedInUrl || '#'}">View Existing LinkedIn Post</a>\n`
      : '';

    const reasonText = params.reason ? `ℹ️ <i>${params.reason}</i>\n` : '';

    return `${rankHeader}${domainLabel}${typeBadge}${decisionBadge}${scoresText}${coreIdeaText}👤 <b>Author:</b> ${params.author || 'Unknown'}\n${valueNotice}${dupNotice}${reasonText}
<b>Original Text:</b>
<blockquote>${params.content.substring(0, 450)}${params.content.length > 450 ? '...' : ''}</blockquote>
`;
  }
}

export const telegramService = new TelegramService();
