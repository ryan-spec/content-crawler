import axios from 'axios';
import { BaseCrawler } from './BaseCrawler';
import { Story } from '../../types';
import { logger } from '../../utils/logger';

const REDDIT_SUBREDDITS = [
  'AmItheAsshole',
  'confession',
  'relationship_advice',
  'tifu',
  'TrueOffMyChest'
];

export class RedditCrawler extends BaseCrawler {
  constructor() {
    super('reddit');
  }

  /**
   * Cleans and validates Reddit comment text:
   * 1. Excludes deleted/removed comments.
   * 2. Strips markdown links, image markup, gif embeds, and raw URLs.
   * 3. Retains only comments containing actual readable alphanumeric text.
   * 4. Truncates overly long comments to keep prompt sizes small.
   */
  private cleanAndValidateComment(body: string): string | null {
    if (!body) return null;

    let clean = body.trim();

    // 1. Skip deleted/removed
    if (
      clean === '[deleted]' ||
      clean === '[removed]' ||
      clean.toLowerCase().includes('[deleted by user]')
    ) {
      return null;
    }

    // 2. Reject comments containing markdown images/gifs (e.g., ![gif](giphy|xxx) or ![alt](url))
    if (/!\[[^\]]*\]\([^)]+\)/.test(clean)) {
      return null;
    }

    // 3. Reject comments containing markdown links (e.g., [anchor text](url))
    if (/\[[^\]]*\]\([^)]+\)/.test(clean)) {
      return null;
    }

    // 4. Reject comments containing raw URLs (http, https, www.)
    if (/https?:\/\/[^\s]+/gi.test(clean) || /www\.[a-z0-9.-]+\.[a-z]{2,}/gi.test(clean)) {
      return null;
    }

    // 5. Reject custom reddit media/embed text patterns or raw giphy references
    if (/giphy\|/i.test(clean) || /!\[gif\]\(giphy\|/i.test(clean)) {
      return null;
    }

    // 6. Reject if it has HTML tags
    if (/<[^>]*>/g.test(clean)) {
      return null;
    }

    // 7. Clean up excessive whitespace/newlines
    clean = clean.replace(/\s+/g, ' ').trim();

    // 8. Ignore comments that are too short after cleaning
    if (clean.length < 15) return null;

    // 9. Ensure there are actual letters in the comment (not just symbols/emojis/punctuation)
    if (!/[a-zA-Z]/g.test(clean)) return null;

    // 10. Limit length to keep it snappy and fast for LLM processing (max 45 words)
    const words = clean.split(/\s+/);
    if (words.length > 45) {
      clean = words.slice(0, 45).join(' ') + '...';
    }

    return clean;
  }

  async fetchTopStories(limit: number = 10): Promise<Story[]> {
    const allStories: Story[] = [];

    for (const subreddit of REDDIT_SUBREDDITS) {
      try {
        const url = `https://www.reddit.com/r/${subreddit}/top.json?t=month&limit=50`;
        logger.info(`Fetching Reddit stories from r/${subreddit}`);
        
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'NodeJS:ContentCrawler:v1.0.0 (by /u/AutomationBot)'
          }
        });

        const posts = response.data?.data?.children || [];

        for (const post of posts) {
          const data = post.data;

          // Filters: no NSFW, > 500 score, content > 500 chars, avoid deleted/empty
          if (data.over_18) continue;
          if (data.score < 500) continue;
          if (!data.selftext || data.selftext.length < 500) continue;
          if (data.selftext === '[deleted]' || data.selftext === '[removed]') continue;

          allStories.push({
            id: `reddit_${data.id}`,
            source: this.sourceName,
            subreddit: subreddit,
            title: data.title,
            content: data.selftext,
            score: data.score,
            author: data.author,
            created_utc: data.created_utc,
            url: `https://www.reddit.com${data.permalink}`
          });
        }
      } catch (error) {
        logger.error(`Error fetching stories from r/${subreddit}`, error);
      }
    }

    // Shuffle and limit
    const selectedStories = allStories.sort(() => 0.5 - Math.random()).slice(0, limit);

    // Fetch comments for the selected stories
    for (const story of selectedStories) {
      try {
        const commentsUrl = `${story.url.replace(/\/$/, '')}.json?sort=top&limit=50`;
        logger.info(`Fetching comments for story ${story.id}`);
        const response = await axios.get(commentsUrl, {
          headers: {
            'User-Agent': 'NodeJS:ContentCrawler:v1.0.0 (by /u/AutomationBot)'
          }
        });

        const commentsData = response.data[1]?.data?.children || [];
        const extractedComments = [];
        let opReplyCount = 0;

        for (const c of commentsData) {
          if (c.kind !== 't1') continue; // Only process actual comments
          const comment = c.data;
          
          const cleanedBody = this.cleanAndValidateComment(comment.body);
          if (!cleanedBody) continue; // Skip comment if it lacks clean text or is invalid
          
          if (comment.author === story.author && opReplyCount < 3) {
            extractedComments.push({
              author: comment.author,
              score: comment.score,
              body: cleanedBody,
              is_op_reply: true
            });
            opReplyCount++;
          } else if (extractedComments.length < 5) {
            extractedComments.push({
              author: comment.author,
              score: comment.score,
              body: cleanedBody,
              is_op_reply: false
            });
          }

          if (extractedComments.length >= 8) break; // Max 8 comments per story
        }
        
        // Sort by score
        story.comments = extractedComments.sort((a, b) => b.score - a.score);

      } catch (error) {
        logger.error(`Failed to fetch comments for story ${story.id}`, error);
      }
      
      // Delay to respect Reddit rate limits
      await new Promise(res => setTimeout(res, 1000));
    }

    return selectedStories;
  }
}
