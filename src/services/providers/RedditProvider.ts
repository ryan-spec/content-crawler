import { ContentProvider, ContentProviderOptions, Post } from '../../types';
import { RedditCrawler } from '../crawlers/RedditCrawler';

export class RedditProvider implements ContentProvider {
  private crawler = new RedditCrawler();

  public getSourceName(): string {
    return this.crawler.getSourceName();
  }

  public async getPosts(options: ContentProviderOptions = {}): Promise<Post[]> {
    return this.crawler.fetchTopStories(
      options.limit,
      options.filterFn,
      options.fetchComments,
      options.cycleLabel
    );
  }

  public async getPostDetail(id: string): Promise<Post> {
    const posts = await this.getPosts({ limit: 50, fetchComments: true });
    const normalizedId = id.startsWith('reddit_') ? id : `reddit_${id}`;
    const post = posts.find(item => item.id === normalizedId);

    if (!post) {
      throw new Error(`Reddit post not found: ${id}`);
    }

    return post;
  }
}
