import axios from 'axios';
import { config } from '../config/env.js';

export interface ImprovisedPostResult {
  originalContent: string;
  improvedContent: string;
  hook: string;
  takeaways: string[];
  suggestedHashtags: string[];
}

export class AiImproviserService {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model;
  }

  /**
   * Rewrite and optimize a tweet/post for LinkedIn.
   */
  async improvisePost(params: {
    content: string;
    author?: string;
    isDuplicate?: boolean;
    instructions?: string;
  }): Promise<ImprovisedPostResult> {
    if (!this.apiKey) {
      return this.heuristicFallback(params.content);
    }

    const prompt = `
You are an elite LinkedIn ghostwriter and content strategist for tech leaders and senior software engineers.
Transform the following raw tweet into a high-performing, authentic LinkedIn post:

Author: ${params.author || 'Tech Leader'}
Original Content:
"${params.content}"
Is Known Duplicate: ${params.isDuplicate ? 'YES (Rewrite completely from scratch with a fresh perspective, novel analogy, and unique voice)' : 'NO'}
Special Instructions: ${params.instructions || 'Optimize for high engagement, professional insights, and thoughtful discussion.'}

Formatting Rules:
1. Hook: Write a punchy 1-2 line opening that stops the scroll (no generic fluff like "Excited to share...").
2. Body: Expand the core insight with clear structure, short paragraphs (1-2 sentences max each), and bullet points where helpful.
3. Call to Action: End with an open-ended, non-cringe discussion question.
4. Voice: Pragmatic, direct, authoritative yet relatable engineer's perspective.
5. Hashtags: Provide 3-4 relevant hashtags.

Return ONLY a valid JSON object with the schema:
{
  "improvedContent": string,
  "hook": string,
  "takeaways": string[],
  "suggestedHashtags": string[]
}
`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      const response = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.7,
          },
        },
        { timeout: 20000 }
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Empty response from Gemini Improviser');
      }

      const parsed = JSON.parse(text);

      return {
        originalContent: params.content,
        improvedContent: parsed.improvedContent,
        hook: parsed.hook || '',
        takeaways: parsed.takeaways || [],
        suggestedHashtags: parsed.suggestedHashtags || [],
      };
    } catch (err: any) {
      console.warn('[AiImproviserService] Gemini improvisation failed, falling back:', err.message);
      return this.heuristicFallback(params.content);
    }
  }

  private heuristicFallback(content: string): ImprovisedPostResult {
    const lines = content.split('\n').filter(Boolean);
    const hook = lines[0] || 'A critical perspective on software engineering:';
    const body = lines.slice(1).join('\n\n') || content;

    const improved = `${hook}\n\n${body}\n\nKey takeaways:\n• Simplicity > Complexity\n• Business value > Code quantity\n\nWhat is your take on this?`;

    return {
      originalContent: content,
      improvedContent: improved,
      hook,
      takeaways: ['Focus on business value', 'Keep code footprint minimal'],
      suggestedHashtags: ['#SoftwareEngineering', '#TechLeadership', '#Programming'],
    };
  }
}

export const aiImproviserService = new AiImproviserService();
