import axios from 'axios';
import { config } from '../../config/config';
import { logger } from '../../utils/logger';

export const callLLM = async (
  prompt: string,
  systemPrompt?: string,
  temperature: number = 0.9,
  retries: number = 2
): Promise<string | null> => {
  if (!config.ai.apiKey && !config.ai.apiUrl.includes('localhost')) {
    logger.error('No AI API Key provided.');
    return null;
  }

  let attempt = 0;
  while (attempt <= retries) {
    try {
      const messages = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });

      const response = await axios.post(
        config.ai.apiUrl,
        {
          model: config.ai.model,
          messages,
          temperature,
          top_p: 0.95,
          presence_penalty: 0.4,
          frequency_penalty: 0.4 // Helps avoid repetition
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.ai.apiKey}`
          },
          timeout: 900000 // 15 minutes timeout for local CPU LLM inference
        }
      );

      return response.data.choices[0].message.content.trim();
    } catch (error: any) {
      attempt++;
      logger.error(`LLM Call failed (Attempt ${attempt}): ${error.message}`);
      if (attempt > retries) {
        return null;
      }
      // Wait before retry
      await new Promise(res => setTimeout(res, 2000));
    }
  }
  return null;
};
