import { Story } from '../../types';
import { logger } from '../../utils/logger';

/**
 * List of subreddits that strongly benefit from community comments as reactions/escalation
 */
const COMMENT_RICH_SUBREDDITS = [
  'amitheasshole',
  'relationship_advice',
  'maliciouscompliance',
  'tifu',
  'trueoffmychest',
  'offmychest',
  'confession'
];

/**
 * Dynamically decides whether community comments should be integrated into the storytelling flow.
 * Uses comments if:
 * 1. The subreddit is known for engaging/controversial reactions.
 * 2. There are active comments crawled (at least 1 comment).
 * 3. The top comments are highly upvoted or add meaningful reactions (score-based validation).
 */
export const shouldUseComments = (story: Story): boolean => {
  if (!story.comments || story.comments.length === 0) {
    logger.info(`[Comment Decision] Skip comments for story ${story.id}: No comments crawled.`);
    return false;
  }

  const subreddit = (story.subreddit || '').toLowerCase();
  
  // Rule 1: Subreddit type check
  const isCommentRichSub = COMMENT_RICH_SUBREDDITS.includes(subreddit);
  if (!isCommentRichSub) {
    logger.info(`[Comment Decision] Skip comments for story ${story.id}: Subreddit r/${story.subreddit} is not in comment-rich list.`);
    return false;
  }

  // Rule 2: Top comment quality check
  // Look at the top comment's score compared to story score or absolute value
  const topComment = story.comments[0];
  const relativeScore = topComment.score / story.score;

  logger.info(`[Comment Decision] Story Score: ${story.score}, Top Comment Score: ${topComment.score} (Ratio: ${relativeScore.toFixed(3)})`);

  // If top comment has a high absolute score (>= 200) or represents a notable fraction of story engagement (>= 5%)
  if (topComment.score >= 200 || relativeScore >= 0.05) {
    logger.info(`[Comment Decision] APPROVED comments for story ${story.id}: High-quality comment found!`);
    return true;
  }

  logger.info(`[Comment Decision] Skip comments for story ${story.id}: Comments do not meet score/ratio quality threshold.`);
  return false;
};
