export interface Story {
  id: string;
  source: string; // e.g., 'reddit'
  subreddit?: string;
  title: string;
  content: string;
  score: number;
  author: string;
  created_utc: number;
  url: string;
}
