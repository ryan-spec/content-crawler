import { CategoryResult } from './categoryDetector';
import { Story } from '../../types';

export const calculateViralScore = (story: Story, categoryData: CategoryResult | null): number => {
  let score = 50; // Base score

  // Score based on upvotes (up to 20 points)
  if (story.score > 10000) score += 20;
  else if (story.score > 5000) score += 15;
  else if (story.score > 2000) score += 10;
  else if (story.score > 500) score += 5;

  // Score based on comments volume (proxy for engagement) (up to 15 points)
  const commentCount = story.comments ? story.comments.length : 0;
  if (commentCount > 100) score += 15;
  else if (commentCount > 50) score += 10;
  else if (commentCount > 10) score += 5;

  if (categoryData) {
    // High conflict gets a boost
    if (categoryData.conflict_level === 'high') score += 10;
    if (categoryData.conflict_level === 'medium') score += 5;

    // Betrayal / Cheating is extremely viral
    if (categoryData.betrayal_keywords_found) score += 15;

    if (['relationship_drama', 'revenge_story', 'cheating_betrayal'].includes(categoryData.category)) {
      score += 10;
    }
  }

  // Cap at 100
  return Math.min(score, 100);
};

// Configurable threshold
export const isViralEnough = (viralScore: number): boolean => {
  return viralScore >= 60;
};
