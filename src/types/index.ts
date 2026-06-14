export interface RedditComment {
  author: string;
  score: number;
  body: string;
  is_op_reply?: boolean;
}

export interface Story {
  id: string;
  source: string; // e.g., 'reddit'
  category?: string;
  subreddit?: string;
  language?: 'vi' | 'en';
  title: string;
  content: string;
  summary?: string;
  score: number;
  author: string;
  created_utc?: number;
  createdAt?: string;
  url: string;
  topicUrl?: string;
  replyCount?: number;
  viewCount?: number;
  hash?: string;
  contentHash?: string;
  comments?: RedditComment[];
  processingMode?: ProcessingMode;
  edited?: boolean;
  editReason?: string;
}

export type Post = Story;

export type ProcessingMode = 'none' | 'hook_only' | 'light_vietnamese_review' | 'translate_and_rewrite';

export interface ContentReviewResult {
  source: string;
  language: 'vi' | 'en';
  processingMode: ProcessingMode;
  edited: boolean;
  editReason?: string;
  finalNarrationText: string;
  qualityScore?: number;
  hookScore?: number;
}

export interface ContentProviderOptions {
  limit?: number;
  source?: string;
  filterFn?: (story: Story) => boolean;
  fetchComments?: boolean;
  cycleLabel?: string;
}

export interface ContentProvider {
  getPosts(options?: ContentProviderOptions): Promise<Post[]>;
  getPostDetail(id: string): Promise<Post>;
  getSourceName(): string;
}

export type SegmentType = 'hook' | 'setup' | 'tension' | 'conflict' | 'twist' | 'confrontation' | 'comment' | 'aftermath' | 'ending' | 'reflection' | 'story' | 'transition' | 'question' | 'reveal';

export interface StorySegment {
  id: string;
  type: SegmentType;
  text: string;
  voice?: string;
  speed?: string;
}

export interface ProcessedStory {
  segments: StorySegment[];
}

export interface TimelineItem {
  segment_id: string;
  type: SegmentType;
  text: string;
  audio: string; // relative filename or path, e.g. "01_hook.mp3"
  subtitle: string; // relative filename or path, e.g. "01_hook.srt"
  estimated_duration: number; // in seconds
  voice?: string;
  speed?: string;
}

export interface FinalOutput {
  story_id: string;
  subreddit: string;
  category: string;
  viral_score: number;
  emotional_arc: string[];
  raw_story: Story;
  segments: StorySegment[];
  timeline: TimelineItem[];
  story_folder: string;
  youtube_title: string;
  thumbnail_text: string;
}
