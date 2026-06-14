import axios from 'axios';
import crypto from 'crypto';
import { config } from '../../config/config';
import { ContentProvider, ContentProviderOptions, Post } from '../../types';
import { logger } from '../../utils/logger';
import { duplicateHandler } from '../../utils/duplicateHandler';

const DANTRI_SOURCE_URL = 'https://dantri.com.vn/tam-su.htm';
const DANTRI_RSS_URLS = [
  'https://dantri.com.vn/rss/tinh-yeu-gioi-tinh.rss',
  'https://dantri.com.vn/rss/tam-su.rss',
  'https://dantri.com.vn/tam-su.rss',
];

const INCLUDE_KEYWORDS = [
  'tâm sự', 'tinh yêu', 'hôn nhân', 'vợ', 'chồng', 'gia đình', 'con cái',
  'mẹ chồng', 'bố mẹ', 'người yêu', 'chia tay', 'cưới', 'ly hôn', 'ngoại tình',
  'bài học', 'cuộc sống', 'cảm xúc', 'nỗi lòng', 'thú nhận', 'kể lại',
];

const EXCLUDE_KEYWORDS = [
  'chính trị', 'bầu cử', 'quốc hội', 'tội phạm', 'giết', 'cướp', 'ma túy',
  'tai nạn', 'bắt giữ', 'khởi tố', 'quảng cáo', 'tài trợ', 'sponsored',
];

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
};

export class DanTriProvider implements ContentProvider {
  public getSourceName(): string {
    return 'dantri';
  }

  public async getPosts(options: ContentProviderOptions = {}): Promise<Post[]> {
    const limit = Math.min(config.maxStoriesPerSource || options.limit || 3, 3);

    try {
      let posts = await this.fetchFromRss();
      if (posts.length === 0) {
        logger.warn('[DanTri] RSS returned no usable stories, falling back to HTML crawling.');
        posts = await this.fetchFromHtml();
      }

      const validPosts = posts
        .filter(post => this.isAllowedStory(post))
        .filter(post => !duplicateHandler.isContentHashProcessed(post.contentHash || post.hash || this.createStoryHash(post.title, post.url)))
        .slice(0, limit);

      const detailedPosts: Post[] = [];
      for (const post of validPosts) {
        try {
          const detailed = await this.getPostDetail(post.url);
          if (this.isAllowedStory(detailed)) {
            detailedPosts.push(detailed);
          }
        } catch (error: any) {
          logger.warn(`[DanTri] Failed to fetch article detail for ${post.url}: ${error.message}`);
          detailedPosts.push(post);
        }
      }

      const filteredPosts = options.filterFn ? detailedPosts.filter(options.filterFn) : detailedPosts;
      return filteredPosts.slice(0, limit);
    } catch (error: any) {
      logger.warn(`[DanTri] Failed to fetch stories: ${error.message}`);
      return [];
    }
  }

  public async getPostDetail(idOrUrl: string): Promise<Post> {
    const url = idOrUrl.startsWith('http') ? idOrUrl : `https://dantri.com.vn/${idOrUrl}`;
    const response = await axios.get<string>(url, {
      headers: DEFAULT_HEADERS,
      timeout: 12000,
    });

    const html = response.data;
    const title = this.cleanText(
      this.matchFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      || this.matchFirst(html, /<meta property="og:title" content="([^"]+)"/i)?.[1]
      || 'Untitled DanTri story'
    );
    const summary = this.cleanText(
      this.matchFirst(html, /<h2[^>]+class="[^"]*singular-sapo[^"]*"[^>]*>([\s\S]*?)<\/h2>/i)?.[1]
      || this.matchFirst(html, /<meta name="description" content="([^"]+)"/i)?.[1]
      || ''
    );
    const content = this.extractContentFromHtml(html);
    const createdAt = this.extractCreatedAt(html);
    const author = this.extractAuthor(html);
    const id = this.extractArticleId(url);
    const hash = this.createStoryHash(title, url);

    return {
      id: `dantri_${id}`,
      source: 'dantri',
      category: 'tam-su',
      subreddit: 'tam-su',
      title,
      content: content || summary,
      summary,
      url,
      author,
      createdAt,
      language: 'vi',
      score: 0,
      hash,
      contentHash: hash,
    };
  }

  private async fetchFromRss(): Promise<Post[]> {
    for (const rssUrl of DANTRI_RSS_URLS) {
      try {
        const response = await axios.get<string>(rssUrl, {
          headers: DEFAULT_HEADERS,
          timeout: 10000,
        });
        const posts = this.parseRssItems(response.data);
        if (posts.length > 0) {
          logger.info(`[DanTri] Fetched ${posts.length} stories via RSS: ${rssUrl}`);
          return posts;
        }
      } catch (error: any) {
        logger.warn(`[DanTri] RSS fetch failed for ${rssUrl}: ${error.message}`);
      }
    }

    return [];
  }

  private async fetchFromHtml(): Promise<Post[]> {
    const response = await axios.get<string>(DANTRI_SOURCE_URL, {
      headers: DEFAULT_HEADERS,
      timeout: 12000,
    });

    const articles = response.data.match(/<article[\s\S]*?<\/article>/gi) || [];
    const posts: Post[] = [];

    for (const article of articles) {
      const linkMatch = this.matchFirst(article, /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) continue;

      const url = this.absoluteUrl(linkMatch[1]);
      const title = this.cleanText(linkMatch[2]);
      if (!title || !url.includes('dantri.com.vn')) continue;

      const summary = this.cleanText(
        this.matchFirst(article, /<div[^>]+class="[^"]*article-excerpt[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
        || this.matchFirst(article, /<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]
        || ''
      );
      const hash = this.createStoryHash(title, url);

      posts.push({
        id: `dantri_${this.extractArticleId(url)}`,
        source: 'dantri',
        category: 'tam-su',
        subreddit: 'tam-su',
        title,
        content: summary,
        summary,
        url,
        author: 'Dân trí',
        createdAt: new Date().toISOString(),
        language: 'vi',
        score: 0,
        hash,
        contentHash: hash,
      });
    }

    return this.uniqueByUrl(posts);
  }

  private parseRssItems(xml: string): Post[] {
    const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
    const posts: Post[] = [];

    for (const item of items) {
      const title = this.cleanText(this.matchFirst(item, /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || '');
      const url = this.cleanText(this.matchFirst(item, /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i)?.[1] || '');
      if (!title || !url) continue;

      const summary = this.cleanText(this.matchFirst(item, /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)?.[1] || '');
      const pubDate = this.cleanText(this.matchFirst(item, /<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/i)?.[1] || '');
      const hash = this.createStoryHash(title, url);

      posts.push({
        id: `dantri_${this.extractArticleId(url)}`,
        source: 'dantri',
        category: 'tam-su',
        subreddit: 'tam-su',
        title,
        content: summary,
        summary,
        url,
        author: 'Dân trí',
        createdAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        language: 'vi',
        score: 0,
        hash,
        contentHash: hash,
      });
    }

    return this.uniqueByUrl(posts);
  }

  private isAllowedStory(post: Post): boolean {
    const text = `${post.title}\n${post.summary || ''}\n${post.content || ''}`.toLowerCase();
    const hasIncludedTopic = INCLUDE_KEYWORDS.some(keyword => text.includes(keyword));
    const hasExcludedTopic = EXCLUDE_KEYWORDS.some(keyword => text.includes(keyword));
    const hasUsableLength = (post.content || post.summary || '').length >= 80;

    return hasIncludedTopic && !hasExcludedTopic && hasUsableLength;
  }

  private extractContentFromHtml(html: string): string {
    const body = this.matchFirst(html, /<div[^>]+class="[^"]*singular-content[^"]*"[^>]*>([\s\S]*?)(?:<div[^>]+class="[^"]*author[^"]*"|<\/article>|<script)/i)?.[1]
      || this.matchFirst(html, /<article[^>]*>([\s\S]*?)<\/article>/i)?.[1]
      || html;
    const paragraphs = body.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];

    return paragraphs
      .map(paragraph => this.cleanText(paragraph))
      .filter(text => text && !/Theo dõi Dân trí|Đọc thêm|Tin liên quan|Ảnh:/i.test(text))
      .join('\n\n');
  }

  private extractCreatedAt(html: string): string {
    const rawDate = this.matchFirst(html, /<time[^>]+datetime="([^"]+)"/i)?.[1]
      || this.matchFirst(html, /<meta property="article:published_time" content="([^"]+)"/i)?.[1]
      || '';
    const date = rawDate ? new Date(rawDate) : new Date();
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
  }

  private extractAuthor(html: string): string {
    return this.cleanText(
      this.matchFirst(html, /<div[^>]+class="[^"]*author-name[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
      || this.matchFirst(html, /<strong[^>]*class="[^"]*author[^"]*"[^>]*>([\s\S]*?)<\/strong>/i)?.[1]
      || 'Dân trí'
    );
  }

  private absoluteUrl(url: string): string {
    if (url.startsWith('http')) return url;
    return `https://dantri.com.vn${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private extractArticleId(url: string): string {
    return this.matchFirst(url, /-([0-9]+)\.htm[l]?/i)?.[1] || crypto.createHash('sha1').update(url).digest('hex');
  }

  private createStoryHash(title: string, url: string): string {
    return crypto.createHash('sha256').update(`dantri${title}${url}`).digest('hex');
  }

  private uniqueByUrl(posts: Post[]): Post[] {
    const seen = new Set<string>();
    return posts.filter(post => {
      if (seen.has(post.url)) return false;
      seen.add(post.url);
      return true;
    });
  }

  private matchFirst(input: string, pattern: RegExp): RegExpMatchArray | null {
    return input.match(pattern);
  }

  private cleanText(value: string): string {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
