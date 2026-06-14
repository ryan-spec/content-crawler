import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { chromium, Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { config } from '../../config/config';
import { ContentProvider, ContentProviderOptions, Post } from '../../types';
import { logger } from '../../utils/logger';

interface VozCategory {
  name: string;
  url: string;
}

interface VozTopicSummary {
  id: string;
  category: string;
  title: string;
  author: string;
  createdAt: string;
  topicUrl: string;
  replyCount: number;
  viewCount: number;
}

const VOZ_BASE_URL = 'https://voz.vn';
const CLOUDFLARE_CHALLENGE_ERROR = 'Cloudflare challenge';
const DEFAULT_BROWSER_HEADERS = {
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
};
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const VOZ_CATEGORIES: VozCategory[] = [
  {
    name: 'Chuyen tro linh tinh',
    url: `${VOZ_BASE_URL}/f/chuyen-tro-linh-tinh%E2%84%A2.17/`,
  },
  {
    name: 'Tam su',
    url: `${VOZ_BASE_URL}/f/from-f17-with-love.69/`,
  },
  {
    name: 'Cong nghe',
    url: `${VOZ_BASE_URL}/f/android.32/`,
  },
  {
    name: 'Kinh doanh',
    url: `${VOZ_BASE_URL}/f/make-money-online.93/`,
  },
];

export class VozProvider implements ContentProvider {
  private browser?: Browser;
  private context?: BrowserContext;

  public getSourceName(): string {
    return 'voz';
  }

  public async getPosts(options: ContentProviderOptions = {}): Promise<Post[]> {
    return this.withBrowserSession(async () => {
      const limit = options.limit || 10;
      const perCategoryLimit = Math.max(Math.ceil(limit / VOZ_CATEGORIES.length), 1);
      const posts: Post[] = [];

      for (const category of VOZ_CATEGORIES) {
        try {
          logger.info(`[Voz] Fetching latest topics from ${category.name}`);
          const html = await this.fetchHtml(category.url);
          const topics = this.extractTopics(html, category).slice(0, perCategoryLimit);

          for (const topic of topics) {
            try {
              const detail = await this.getPostDetailFromSummary(topic);
              posts.push(detail);
            } catch (error) {
              this.logFetchError(`[Voz] Failed to fetch topic detail ${topic.topicUrl}`, error);
            }
          }
        } catch (error: any) {
          this.logFetchError(`[Voz] Failed to fetch category ${category.name}`, error);
          if (this.isCloudflareError(error)) {
            throw error;
          }
        }
      }

      const filteredPosts = options.filterFn ? posts.filter(options.filterFn) : posts;
      return filteredPosts.slice(0, limit);
    });
  }

  public async getPostDetail(id: string): Promise<Post> {
    return this.withBrowserSession(async () => {
      const topicUrl = id.startsWith('http') ? id : `${VOZ_BASE_URL}/t/${id}/`;
      const html = await this.fetchHtml(topicUrl);
      const fallbackCategory = this.findCategoryByUrl(topicUrl)?.name || 'Voz';
      const summary = this.extractTopicSummaryFromDetail(html, topicUrl, fallbackCategory);

      return this.createPostFromSummary(summary, html);
    });
  }

  private async getPostDetailFromSummary(summary: VozTopicSummary): Promise<Post> {
    const html = await this.fetchHtml(summary.topicUrl);
    return this.createPostFromSummary(summary, html);
  }

  private createPostFromSummary(summary: VozTopicSummary, html: string): Post {
    const content = this.extractFirstPostContent(html);
    const hash = this.createStoryHash(this.getSourceName(), summary.title, summary.topicUrl);

    return {
      id: `voz_${summary.id}`,
      source: this.getSourceName(),
      category: summary.category,
      subreddit: summary.category,
      title: summary.title,
      content,
      summary: content,
      author: summary.author,
      language: 'vi',
      score: summary.replyCount + Math.floor(summary.viewCount / 100),
      url: summary.topicUrl,
      topicUrl: summary.topicUrl,
      createdAt: summary.createdAt,
      created_utc: this.toUnixSeconds(summary.createdAt),
      replyCount: summary.replyCount,
      viewCount: summary.viewCount,
      hash,
      contentHash: hash,
    };
  }

  private async fetchHtml(url: string): Promise<string> {
    if (config.voz.crawlMode === 'browser') {
      return this.fetchHtmlWithBrowser(url);
    }

    try {
      const response = await axios.get<string>(url, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...DEFAULT_BROWSER_HEADERS,
        },
        timeout: 15000,
      });

      const html = response.data;
      if (this.isCloudflareChallenge(html)) {
        throw new Error(CLOUDFLARE_CHALLENGE_ERROR);
      }
      return html;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const body = typeof error.response?.data === 'string' ? error.response.data : '';
        if ((error.response?.status === 403 || error.response?.status === 503) && this.isCloudflareChallenge(body)) {
          return this.fetchHtmlAfterCloudflare(url);
        }
      }
      if (this.isCloudflareError(error)) {
        return this.fetchHtmlAfterCloudflare(url);
      }
      throw error;
    }
  }

  private async fetchHtmlAfterCloudflare(url: string): Promise<string> {
    if (!config.voz.browserFallback) {
      throw new Error(CLOUDFLARE_CHALLENGE_ERROR);
    }

    logger.warn('[Voz] Cloudflare challenge detected. Retrying with Playwright browser session.');
    return this.fetchHtmlWithBrowser(url);
  }

  private async fetchHtmlWithBrowser(url: string): Promise<string> {
    const context = await this.ensureBrowserContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);

      let html = await page.content();
      if (this.isCloudflareChallenge(html)) {
        logger.warn(`[Voz] Waiting up to ${Math.round(config.voz.challengeWaitMs / 1000)}s for Cloudflare challenge to clear.`);
        html = await this.waitForChallengeToClear(page, html);
      }

      if (this.isCloudflareChallenge(html)) {
        logger.warn(`[Voz] Cloudflare challenge still active. Set VOZ_BROWSER_HEADLESS=false and save a browser storage state at ${config.voz.storageStatePath}.`);
        throw new Error(CLOUDFLARE_CHALLENGE_ERROR);
      }

      await this.saveStorageState(context);
      return html;
    } catch (error) {
      if (this.isTargetClosedError(error)) {
        await this.closeBrowserSession(false);
        throw new Error('Voz browser was closed before the page could be read');
      }
      throw error;
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async withBrowserSession<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } finally {
      await this.closeBrowserSession(true);
    }
  }

  private async ensureBrowserContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    fs.mkdirSync(config.voz.userDataDir, { recursive: true });

    const contextOptions: BrowserContextOptions = {
      userAgent: DEFAULT_USER_AGENT,
      locale: 'vi-VN',
      extraHTTPHeaders: DEFAULT_BROWSER_HEADERS,
    };

    if (fs.existsSync(config.voz.storageStatePath) && !fs.existsSync(config.voz.userDataDir)) {
      contextOptions.storageState = config.voz.storageStatePath;
      logger.info(`[Voz] Loaded browser storage state from ${config.voz.storageStatePath}`);
    }

    this.context = await chromium.launchPersistentContext(config.voz.userDataDir, {
      ...contextOptions,
      headless: config.voz.browserHeadless,
    });
    logger.info(`[Voz] Using browser profile at ${config.voz.userDataDir}`);
    return this.context;
  }

  private async closeBrowserSession(saveState: boolean): Promise<void> {
    if (saveState && this.context) {
      await this.saveStorageState(this.context).catch(error => this.logFetchError('[Voz] Failed to save browser storage state', error));
    }

    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = undefined;
    this.browser = undefined;
  }

  private async waitForChallengeToClear(page: Page, initialHtml: string): Promise<string> {
    let html = initialHtml;
    const deadline = Date.now() + config.voz.challengeWaitMs;

    while (this.isCloudflareChallenge(html) && Date.now() < deadline) {
      await page.waitForTimeout(2000);
      html = await page.content();
    }

    return html;
  }

  private async saveStorageState(context: BrowserContext): Promise<void> {
    fs.mkdirSync(path.dirname(config.voz.storageStatePath), { recursive: true });
    await context.storageState({ path: config.voz.storageStatePath });
  }

  private isCloudflareChallenge(html: string): boolean {
    return /<title>\s*Just a moment\.{0,3}\s*<\/title>|cf-browser-verification|cf_chl|__cf_chl_|cdn-cgi\/challenge-platform|challenge-platform|Verify you are human|Checking if the site connection is secure/i.test(html);
  }

  private isCloudflareError(error: unknown): boolean {
    return error instanceof Error && error.message.includes(CLOUDFLARE_CHALLENGE_ERROR);
  }

  private isTargetClosedError(error: unknown): boolean {
    return error instanceof Error && /Target page, context or browser has been closed|Browser has been closed/i.test(error.message);
  }

  private logFetchError(context: string, error: unknown): void {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const body = typeof error.response?.data === 'string' ? error.response.data : '';
      if (status === 403 && this.isCloudflareChallenge(body)) {
        logger.warn(`${context}: Voz Cloudflare challenge detected. Manual browser/session cookie required.`);
        return;
      }

      logger.error(`${context}: HTTP ${status || 'unknown'} ${error.response?.statusText || ''}`.trim());
      return;
    }

    if (this.isCloudflareError(error)) {
      logger.warn(`${context}: Voz Cloudflare challenge detected.`);
      return;
    }

    logger.error(context, error);
  }

  private extractTopics(html: string, category: VozCategory): VozTopicSummary[] {
    const topics: VozTopicSummary[] = [];
    const blocks = html.match(/<div[^>]+class="[^"]*structItem[^"]*structItem--thread[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*structItem[^"]*structItem--thread|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/gi) || [];

    for (const block of blocks) {
      if (/structItem-status--sticky|data-xf-init="tooltip"[^>]*>Sticky/i.test(block)) {
        continue;
      }

      const titleLink = this.matchFirst(block, /<a[^>]+href="([^"]+)"[^>]*data-tp-primary="on"[^>]*>([\s\S]*?)<\/a>/i)
        || this.matchFirst(block, /<a[^>]+data-tp-primary="on"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!titleLink) continue;

      const topicUrl = this.absoluteUrl(titleLink[1]);
      const title = this.cleanText(titleLink[2]);
      const id = this.extractTopicId(topicUrl);
      const author = this.cleanText(this.matchFirst(block, /data-xf-init="member-tooltip"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || 'unknown');
      const createdAt = this.cleanText(this.matchFirst(block, /<time[^>]+datetime="([^"]+)"/i)?.[1] || this.matchFirst(block, /<li[^>]*>\s*<a[^>]*>([^<]+)<\/a>\s*<\/li>/i)?.[1] || '');
      const replyCount = this.parseCount(this.matchAfterLabel(block, 'Replies'));
      const viewCount = this.parseCount(this.matchAfterLabel(block, 'Views'));

      topics.push({
        id,
        category: category.name,
        title,
        author,
        createdAt,
        topicUrl,
        replyCount,
        viewCount,
      });
    }

    return topics;
  }

  private extractTopicSummaryFromDetail(html: string, topicUrl: string, fallbackCategory: string): VozTopicSummary {
    const title = this.cleanText(this.matchFirst(html, /<h1[^>]*class="[^"]*p-title-value[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      || this.matchFirst(html, /<meta property="og:title" content="([^"]+)"/i)?.[1]
      || 'Untitled Voz topic');
    const author = this.cleanText(this.matchFirst(html, /<a[^>]+class="[^"]*username[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || 'unknown');
    const createdAt = this.cleanText(this.matchFirst(html, /<time[^>]+datetime="([^"]+)"/i)?.[1] || '');
    const replyCount = this.parseCount(this.matchFirst(html, /Replies:\s*([0-9.,KM]+)\b/i)?.[1] || '0');
    const viewCount = this.parseCount(this.matchFirst(html, /Views:\s*([0-9.,KM]+)\b/i)?.[1] || '0');
    const category = this.cleanText(this.matchFirst(html, /<span[^>]+itemprop="name"[^>]*>([^<]+)<\/span>/gi)?.[1] || fallbackCategory);

    return {
      id: this.extractTopicId(topicUrl),
      category,
      title,
      author,
      createdAt,
      topicUrl,
      replyCount,
      viewCount,
    };
  }

  private extractFirstPostContent(html: string): string {
    const message = this.matchFirst(html, /<article[^>]+class="[^"]*message-body[^"]*"[\s\S]*?<div[^>]+class="[^"]*bbWrapper[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/article>/i)?.[1]
      || this.matchFirst(html, /<div[^>]+class="[^"]*bbWrapper[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
      || '';

    return this.cleanText(message);
  }

  private matchFirst(input: string, pattern: RegExp): RegExpMatchArray | null {
    return input.match(pattern);
  }

  private matchAfterLabel(input: string, label: string): string {
    const pattern = new RegExp(`${label}\\s*<\\/dt>\\s*<dd[^>]*>([\\s\\S]*?)<\\/dd>`, 'i');
    return this.cleanText(this.matchFirst(input, pattern)?.[1] || '0');
  }

  private cleanText(value: string): string {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  private absoluteUrl(url: string): string {
    if (url.startsWith('http')) return url;
    return `${VOZ_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private extractTopicId(url: string): string {
    return this.matchFirst(url, /\/t\/([^/]+)\//i)?.[1] || crypto.createHash('sha1').update(url).digest('hex');
  }

  private parseCount(value: string): number {
    const compact = value.replace(/,/g, '').trim().toUpperCase();
    const multiplier = compact.endsWith('K') ? 1000 : compact.endsWith('M') ? 1000000 : 1;
    const numeric = parseFloat(compact.replace(/[KM]/g, ''));
    return Number.isFinite(numeric) ? Math.round(numeric * multiplier) : 0;
  }

  private createStoryHash(source: string, title: string, url: string): string {
    return crypto.createHash('sha256').update(`${source}${title}${url}`).digest('hex');
  }

  private toUnixSeconds(createdAt: string): number {
    const time = Date.parse(createdAt);
    return Number.isFinite(time) ? Math.floor(time / 1000) : Math.floor(Date.now() / 1000);
  }

  private findCategoryByUrl(topicUrl: string): VozCategory | undefined {
    return VOZ_CATEGORIES.find(category => topicUrl.startsWith(category.url));
  }
}
