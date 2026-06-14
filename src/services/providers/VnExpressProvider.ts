import axios from 'axios';
import crypto from 'crypto';
import { ContentProvider, ContentProviderOptions, Post } from '../../types';
import { logger } from '../../utils/logger';

export class VnExpressProvider implements ContentProvider {
  public getSourceName(): string {
    return 'vnexpress';
  }

  public async getPosts(options: ContentProviderOptions = {}): Promise<Post[]> {
    const limit = options.limit || 10;
    let posts: Post[] = [];

    try {
      logger.info('[VnExpress] Fetching latest stories via RSS');
      posts = await this.fetchFromRss();
    } catch (rssError: any) {
      logger.warn(`[VnExpress] RSS fetching failed, falling back to HTML crawling: ${rssError.message}`);
      try {
        posts = await this.fetchFromHtml();
      } catch (htmlError: any) {
        logger.error('[VnExpress] Both RSS and HTML crawling failed:', htmlError.message);
        throw htmlError;
      }
    }

    // Limit returned posts
    const selected = posts.slice(0, limit);

    // Fetch detailed content for each selected post
    const detailedPosts: Post[] = [];
    for (const post of selected) {
      try {
        const detailed = await this.getPostDetail(post.url);
        detailedPosts.push(detailed);
      } catch (detailError: any) {
        logger.error(`[VnExpress] Failed to fetch article detail for ${post.url}:`, detailError.message);
        detailedPosts.push(post);
      }
    }

    const filteredPosts = options.filterFn ? detailedPosts.filter(options.filterFn) : detailedPosts;
    return filteredPosts.slice(0, limit);
  }

  public async getPostDetail(idOrUrl: string): Promise<Post> {
    const url = idOrUrl.startsWith('http') ? idOrUrl : `https://vnexpress.net/${idOrUrl}`;
    const response = await axios.get<string>(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
      timeout: 10000,
    });

    const html = response.data;
    
    // Parse title
    const titleMatch = html.match(/<h1 class="title-detail">([\s\S]*?)<\/h1>/i) || html.match(/<meta property="og:title" content="([^"]+)"/i);
    const title = titleMatch ? this.cleanText(titleMatch[1]) : 'Untitled';

    // Parse datePublished
    const dateMatch = html.match(/itemprop="datePublished"\s+content="([^"]+)"/i) || 
                      html.match(/content="([^"]+)"\s+itemprop="datePublished"/i) || 
                      html.match(/name="pubdate"\s+content="([^"]+)"/i);
    const createdAt = dateMatch ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();

    // Parse full content
    const content = this.extractContentFromHtml(html);

    // Parse author
    let author = 'VnExpress';
    const authorMatch = html.match(/<p[^>]+class="Normal"[^>]*style="text-align:\s*right;?"[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong><\/p>/i);
    if (authorMatch) {
      author = authorMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    const id = this.extractArticleId(url);
    const hash = this.createStoryHash('vnexpress', title, url);

    return {
      id: `vnexpress_${id}`,
      source: 'vnexpress',
      category: 'tam-su',
      title,
      content,
      summary: content,
      url,
      createdAt,
      language: 'vi',
      hash,
      contentHash: hash,
      score: 0,
      author
    };
  }

  private async fetchFromRss(): Promise<Post[]> {
    const response = await axios.get<string>('https://vnexpress.net/rss/tam-su.rss', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
      timeout: 10000,
    });

    const xml = response.data;
    const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
    const posts: Post[] = [];

    for (const item of items) {
      const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const linkMatch = item.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
      const pubDateMatch = item.match(/<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/i);
      const descMatch = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i);

      if (!titleMatch || !linkMatch) continue;

      const title = this.cleanText(titleMatch[1]);
      const url = this.cleanText(linkMatch[1]);
      const createdAt = pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString();

      let summary = '';
      if (descMatch) {
        summary = descMatch[1]
          .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '')
          .replace(/<br\s*\/?>|<\/br>/gi, '')
          .replace(/<img[^>]*>/gi, '')
          .trim();
        summary = this.cleanText(summary);
      }

      const id = this.extractArticleId(url);
      const hash = this.createStoryHash('vnexpress', title, url);

      posts.push({
        id: `vnexpress_${id}`,
        source: 'vnexpress',
        category: 'tam-su',
        title,
        content: summary,
        summary,
        url,
        createdAt,
        language: 'vi',
        hash,
        contentHash: hash,
        score: 0,
        author: 'VnExpress'
      });
    }

    return posts;
  }

  private async fetchFromHtml(): Promise<Post[]> {
    const response = await axios.get<string>('https://vnexpress.net/tam-su', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
      timeout: 10000,
    });

    const html = response.data;
    const articles = html.match(/<article[^>]+class="[^"]*item-news[^"]*"[^>]*>([\s\S]*?)<\/article>/gi) || [];
    const posts: Post[] = [];

    for (const article of articles) {
      const titleNewsMatch = article.match(/<h3 class="title-news">[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!titleNewsMatch) continue;

      const url = titleNewsMatch[1].trim();
      const title = this.cleanText(titleNewsMatch[2]);
      
      let summary = '';
      const descMatch = article.match(/<p class="description">([\s\S]*?)<\/p>/i);
      if (descMatch) {
        summary = descMatch[1].replace(/<[^>]+>/g, '').trim();
        summary = this.cleanText(summary);
      }

      const id = this.extractArticleId(url);
      const hash = this.createStoryHash('vnexpress', title, url);

      posts.push({
        id: `vnexpress_${id}`,
        source: 'vnexpress',
        category: 'tam-su',
        title,
        content: summary,
        summary,
        url,
        createdAt: new Date().toISOString(),
        language: 'vi',
        hash,
        contentHash: hash,
        score: 0,
        author: 'VnExpress'
      });
    }

    return posts;
  }

  private extractContentFromHtml(html: string): string {
    const fckDetailMatch = html.match(/<article[^>]+class="[^"]*fck_detail[^"]*"[^>]*>([\s\S]*?)<\/article>/i);
    const contentHtml = fckDetailMatch ? fckDetailMatch[1] : html;
    
    const paragraphs = contentHtml.match(/<p[^>]+class="Normal"[^>]*>([\s\S]*?)<\/p>/gi) || [];
    const textParts = paragraphs.map(p => {
      let clean = p.replace(/<[^>]+>/g, ' ');
      clean = clean
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#039;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      return clean.replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
    
    return textParts.join('\n\n');
  }

  private extractArticleId(url: string): string {
    const match = url.match(/-([0-9]+)\.html/i);
    return match ? match[1] : crypto.createHash('sha1').update(url).digest('hex');
  }

  private createStoryHash(source: string, title: string, url: string): string {
    return crypto.createHash('sha256').update(`${source}${title}${url}`).digest('hex');
  }

  private cleanText(value: string): string {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/script>/gi, ' ')
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
