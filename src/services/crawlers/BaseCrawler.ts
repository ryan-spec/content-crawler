import { Story } from '../../types';

export abstract class BaseCrawler {
  protected sourceName: string;

  constructor(sourceName: string) {
    this.sourceName = sourceName;
  }

  /**
   * Abstract method to fetch top stories from the source.
   * Implementations should handle their specific API calls and map to the generic Story interface.
   */
  abstract fetchTopStories(limit?: number): Promise<Story[]>;
  
  public getSourceName(): string {
    return this.sourceName;
  }
}
