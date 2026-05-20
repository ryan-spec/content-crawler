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

  async fetchTopStories(limit: number = 10): Promise<Story[]> {
    const allStories: Story[] = [];

    for (const subreddit of REDDIT_SUBREDDITS) {
      try {
        const url = `https://www.reddit.com/r/${subreddit}/top.json?t=day&limit=20`;
        logger.info(`Fetching Reddit stories from r/${subreddit}`);
        
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'NodeJS:ContentCrawler:v1.0.0 (by /u/AutomationBot)'
          }
        });

        const posts = response.data?.data?.children || [];

        for (const post of posts) {
          const data = post.data;

          // Filters: no NSFW, > 3000 score, content > 500 chars, avoid deleted/empty
          if (data.over_18) continue;
          if (data.score < 3000) continue;
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
    return allStories.sort(() => 0.5 - Math.random()).slice(0, limit);
  }
}
