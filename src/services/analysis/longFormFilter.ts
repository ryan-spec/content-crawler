import { Story } from '../../types';
import { logger } from '../../utils/logger';

const HIGH_PRIORITY_SUBREDDITS = [
  'relationship_advice',
  'trueoffmychest',
  'cheating_stories',
  'justnomil',
  'raisedbynarcissists'
];

const MEDIUM_PRIORITY_SUBREDDITS = [
  'amitheasshole'
];

const OPTIONAL_SUBREDDITS = [
  'nosleep',
  'confession',
  'tifu'
];

/**
 * Checks whether a Reddit story is suitable for a 3-8 minute long-form narration.
 * Evaluates subreddit priority, length, and emotional conflict indicators.
 */
export const isLongFormCandidate = (story: Story): boolean => {
  const subreddit = (story.subreddit || '').toLowerCase();
  const wordCount = story.content.trim().split(/\s+/).length;

  logger.info(`[Long Form Filter] Evaluating candidate ${story.id} from r/${story.subreddit} (${wordCount} words)`);

  // Word count check - must have at least 400 words to support a 3-8 min narration
  if (wordCount < 400) {
    logger.info(`[Long Form Filter] Rejected: Too short (${wordCount} words, minimum 400)`);
    return false;
  }

  // 1. High Priority Subreddits: Automatically approved if word count >= 400
  if (HIGH_PRIORITY_SUBREDDITS.includes(subreddit)) {
    logger.info(`[Long Form Filter] APPROVED: High-priority subreddit r/${story.subreddit} with sufficient length`);
    return true;
  }

  // 2. Medium Priority Subreddits: Requires higher threshold (>= 500 words)
  if (MEDIUM_PRIORITY_SUBREDDITS.includes(subreddit)) {
    if (wordCount >= 500) {
      logger.info(`[Long Form Filter] APPROVED: Medium-priority r/${story.subreddit} with sufficient length (${wordCount} words)`);
      return true;
    }
    logger.info(`[Long Form Filter] Rejected: Medium-priority r/${story.subreddit} but not long enough (${wordCount} words)`);
    return false;
  }

  // 3. Optional Subreddits: Requires high threshold (>= 600 words) for horror / heavy situations
  if (OPTIONAL_SUBREDDITS.includes(subreddit)) {
    if (wordCount >= 600) {
      logger.info(`[Long Form Filter] APPROVED: Optional r/${story.subreddit} with high length (${wordCount} words)`);
      return true;
    }
    logger.info(`[Long Form Filter] Rejected: Optional r/${story.subreddit} but not long enough (${wordCount} words)`);
    return false;
  }

  // 4. Other Subreddits: Requires >= 600 words and clear emotional conflict keywords
  const hasConflictKeywords = /cheat|betray|divorce|liar|secret|manipulate|narcissist|abuse|revenge|confess|humiliate/i.test(story.content + ' ' + story.title);
  if (wordCount >= 600 && hasConflictKeywords) {
    logger.info(`[Long Form Filter] APPROVED: Other candidate with length (${wordCount} words) and conflict cues`);
    return true;
  }

  logger.info(`[Long Form Filter] Rejected: Does not satisfy long-form criteria.`);
  return false;
};
