import axios from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';

export const rewriteStory = async (title: string, content: string): Promise<string | null> => {
  if (!config.ai.apiKey && !config.ai.apiUrl.includes('localhost')) {
    logger.error('No AI API Key provided and not using local URL.');
    return null;
  }

  const prompt = `Rewrite this Reddit story into a viral YouTube Shorts narration.
Requirements:
- dramatic
- suspenseful
- short sentences
- cinematic pacing
- emotional
- easy Vietnamese
- 30 to 45 seconds speaking time (approx 100-150 words)
- strong hook in first sentence
- cliffhanger ending
Output:
- narration only
- no markdown
- no explanation

Story Title: ${title}
Story Content:
${content}`;

  try {
    const response = await axios.post(
      config.ai.apiUrl,
      {
        model: config.ai.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.ai.apiKey}`
        }
      }
    );

    const rewritten = response.data.choices[0].message.content.trim();
    return rewritten;
  } catch (error: any) {
    logger.error('Error rewriting story with OpenAI', error.response?.data || error.message);
    return null;
  }
};
