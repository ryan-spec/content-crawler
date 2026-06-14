import axios from 'axios';
import crypto from 'crypto';
import { BaseCrawler } from './BaseCrawler';
import { Story } from '../../types';
import { logger } from '../../utils/logger';
import { config } from '../../config/config';

const REDDIT_SUBREDDITS = [
  'AmItheAsshole',
  'confession',
  'relationship_advice',
  'tifu',
  'TrueOffMyChest',
  'cheating_stories',
  'JUSTNOMIL',
  'raisedbynarcissists',
  'nosleep'
];

export class RedditCrawler extends BaseCrawler {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private lastRequestAt = 0;

  constructor() {
    super('reddit');
  }

  private hasRedditCredentials(): boolean {
    return Boolean(
      config.reddit.clientId &&
      config.reddit.clientSecret &&
      config.reddit.username &&
      config.reddit.password
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async waitForRedditRequestSlot(): Promise<void> {
    const delayMs = Math.max(config.reddit.requestDelayMs || 0, 0);
    if (delayMs === 0) return;

    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < delayMs) {
      await this.sleep(delayMs - elapsed);
    }

    this.lastRequestAt = Date.now();
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt) {
      return this.accessToken;
    }

    if (!this.hasRedditCredentials()) {
      throw new Error('Missing Reddit API credentials. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD in .env.');
    }

    const basicAuth = Buffer.from(`${config.reddit.clientId}:${config.reddit.clientSecret}`).toString('base64');
    const params = new URLSearchParams({
      grant_type: 'password',
      username: config.reddit.username,
      password: config.reddit.password,
    });

    await this.waitForRedditRequestSlot();
    const response = await axios.post('https://www.reddit.com/api/v1/access_token', params, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': config.reddit.userAgent,
      },
      timeout: 10000,
    });

    const accessToken = response.data.access_token;
    if (!accessToken) {
      throw new Error('Reddit did not return an access token. Check REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD.');
    }

    this.accessToken = accessToken;
    this.tokenExpiresAt = now + Math.max((response.data.expires_in || 3600) - 60, 60) * 1000;

    return accessToken;
  }

  private async redditGet<T = any>(url: string): Promise<T> {
    const token = await this.getAccessToken();
    await this.waitForRedditRequestSlot();
    const response = await axios.get<T>(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': config.reddit.userAgent,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private logFetchError(context: string, error: unknown): void {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      logger.error(`${context}: HTTP ${status || 'unknown'}${statusText ? ` ${statusText}` : ''}`);
      return;
    }

    logger.error(context, error);
  }

  private createStoryHash(source: string, title: string, url: string): string {
    return crypto.createHash('sha256').update(`${source}${title}${url}`).digest('hex');
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

  async fetchTopStories(
    limit: number = 10,
    filterFn?: (story: Story) => boolean,
    fetchComments: boolean = true,
    cycleLabel: string = 'Reddit'
  ): Promise<Story[]> {
    const allStories: Story[] = [];

    if (!this.hasRedditCredentials()) {
      throw new Error('OAuth credentials are missing');
    }

    const listings = [
      { name: 'hot', path: 'hot' },
      { name: 'top', path: 'top?t=month' },
      { name: 'new', path: 'new' },
    ];

    for (const subreddit of REDDIT_SUBREDDITS) {
      for (const listing of listings) {
        try {
          const separator = listing.path.includes('?') ? '&' : '?';
          const oauthUrl = `https://oauth.reddit.com/r/${subreddit}/${listing.path}${separator}limit=50`;
          logger.info(`Fetching Reddit ${listing.name} stories from r/${subreddit}`);

          const response = await this.redditGet<any>(oauthUrl);
          const posts = response?.data?.children || [];

          for (const post of posts) {
            const data = post.data;

            // Filters: no NSFW, > 500 score, content > 500 chars, avoid deleted/empty
            if (data.over_18) continue;
            if (data.score < 500) continue;
            if (!data.selftext || data.selftext.length < 500) continue;
            if (data.selftext === '[deleted]' || data.selftext === '[removed]') continue;

            const url = `https://www.reddit.com${data.permalink}`;
            const hash = this.createStoryHash(this.sourceName, data.title, url);

            if (allStories.some(story => story.id === `reddit_${data.id}` || story.hash === hash)) {
              continue;
            }

            allStories.push({
              id: `reddit_${data.id}`,
              source: this.sourceName,
              category: subreddit,
              subreddit: subreddit,
              title: data.title,
              content: data.selftext,
              score: data.score,
              author: data.author,
              created_utc: data.created_utc,
              createdAt: data.created_utc ? new Date(data.created_utc * 1000).toISOString() : undefined,
              url,
              hash,
              contentHash: hash,
            });
          }
        } catch (error) {
          this.logFetchError(`[${cycleLabel}] Error fetching ${listing.name} stories from r/${subreddit}`, error);
        }
      }
    }

    // Filter first if filterFn is provided
    let candidateStories = allStories;
    if (filterFn) {
      candidateStories = allStories.filter(filterFn);
      logger.info(`Filtered candidates: ${candidateStories.length} out of ${allStories.length} stories matched criteria.`);
    }

    // Shuffle and limit
    const selectedStories = candidateStories.sort(() => 0.5 - Math.random()).slice(0, limit);

    // Fetch comments for the selected stories if requested
    if (fetchComments) {
      for (const story of selectedStories) {
        try {
          const oauthCommentsUrl = story.url
            .replace('https://www.reddit.com', 'https://oauth.reddit.com')
            .replace(/\/$/, '') + '?sort=top&limit=50';
          logger.info(`Fetching comments for story ${story.id}`);

          const response = await this.redditGet<any[]>(oauthCommentsUrl);
          const commentsData = response[1]?.data?.children || [];
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
          this.logFetchError(`[${cycleLabel}] Failed to fetch comments for story ${story.id}`, error);
        }
        
        await this.sleep(config.reddit.requestDelayMs);
      }
    }

    return selectedStories;
  }
}
