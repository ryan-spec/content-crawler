import { callLLM } from '../ai/ollamaService';
import { logger } from '../../utils/logger';

export interface CategoryResult {
  category: string;
  emotional_tone: string;
  emotional_arc: string[];
  conflict_level: 'low' | 'medium' | 'high';
  betrayal_keywords_found: boolean;
}

export const detectCategory = async (title: string, content: string, subreddit?: string): Promise<CategoryResult | null> => {
  if (subreddit) {
    const sub = subreddit.toLowerCase();
    if (sub === 'relationship_advice') {
      logger.info(`[Fast Path] Detected category from subreddit: ${sub}`);
      return {
        category: 'relationship_drama',
        emotional_tone: 'dramatic',
        emotional_arc: ['conflict', 'betrayal', 'resolution'],
        conflict_level: 'high',
        betrayal_keywords_found: true
      };
    }
    if (sub === 'amitheasshole') {
      logger.info(`[Fast Path] Detected category from subreddit: ${sub}`);
      return {
        category: 'social_judgment',
        emotional_tone: 'defensive',
        emotional_arc: ['context', 'conflict', 'judgment'],
        conflict_level: 'high',
        betrayal_keywords_found: false
      };
    }
    if (['confession', 'trueoffmychest', 'offmychest'].includes(sub)) {
      logger.info(`[Fast Path] Detected category from subreddit: ${sub}`);
      return {
        category: 'confession',
        emotional_tone: 'guilty',
        emotional_arc: ['secret', 'release', 'regret'],
        conflict_level: 'medium',
        betrayal_keywords_found: false
      };
    }
    if (sub === 'tifu') {
      logger.info(`[Fast Path] Detected category from subreddit: ${sub}`);
      return {
        category: 'embarrassing_story',
        emotional_tone: 'humorous',
        emotional_arc: ['mistake', 'consequence', 'embarrassment'],
        conflict_level: 'medium',
        betrayal_keywords_found: false
      };
    }
  }

  // Fallback: LLM-based detection for unknown subreddits
  const prompt = `Analyze this Reddit story and return a JSON object with these fields:
- category: one of [relationship_drama, cheating_betrayal, confession, revenge_story, embarrassing_story, horror_story, social_judgment, family_drama, workplace_drama]
- emotional_tone: brief description
- emotional_arc: array of 3 stages
- conflict_level: "low" | "medium" | "high"
- betrayal_keywords_found: boolean

Title: "${title}"
Story: "${content.substring(0, 500)}"

Output ONLY valid JSON, no markdown.`;

  const resultText = await callLLM(prompt, 'You are a strict JSON data extractor. Output ONLY valid JSON.', 0.2);

  if (!resultText) return null;

  try {
    const jsonStr = resultText.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const result = JSON.parse(jsonStr) as CategoryResult;
    return result;
  } catch (error) {
    logger.error('Failed to parse category JSON', error);
    return null;
  }
};
