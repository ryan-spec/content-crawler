import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const config = {
  sources: (process.env.SOURCES || 'reddit,vnexpress,dantri')
    .split(',')
    .map(source => source.trim().toLowerCase())
    .filter(Boolean),
  sourceFilter: (process.env.SOURCE || 'all').trim().toLowerCase(),
  ai: {
    apiUrl: process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
  },
  fpt: {
    apiKey: process.env.FPT_API_KEY || '',
    voice: process.env.FPT_VOICE || 'banmai',
    speed: process.env.FPT_SPEED || '0',
  },
  reddit: {
    clientId: process.env.REDDIT_CLIENT_ID || '',
    clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
    username: process.env.REDDIT_USERNAME || '',
    password: process.env.REDDIT_PASSWORD || '',
    userAgent: process.env.REDDIT_USER_AGENT || 'MyLocalCrawler/1.0.0',
    requestDelayMs: parseInt(process.env.REDDIT_REQUEST_DELAY_MS || '1500', 10),
  },
  voz: {
    crawlMode: (process.env.VOZ_CRAWL_MODE || 'http').trim().toLowerCase(),
    browserFallback: process.env.VOZ_BROWSER_FALLBACK ? process.env.VOZ_BROWSER_FALLBACK === 'true' : true,
    browserHeadless: process.env.VOZ_BROWSER_HEADLESS ? process.env.VOZ_BROWSER_HEADLESS !== 'false' : true,
    challengeWaitMs: parseInt(process.env.VOZ_CHALLENGE_WAIT_MS || (process.env.VOZ_BROWSER_HEADLESS === 'false' ? '120000' : '8000'), 10),
    storageStatePath: process.env.VOZ_STORAGE_STATE || path.resolve(process.cwd(), 'data', 'voz-storage-state.json'),
    userDataDir: process.env.VOZ_USER_DATA_DIR || path.resolve(process.cwd(), 'data', 'voz-browser-profile'),
  },
  cronSchedule: process.env.CRON_SCHEDULE || '*/30 * * * *',
  cronScheduleShort: process.env.SHORT_FORM_CRON || process.env.CRON_SCHEDULE_SHORT || process.env.CRON_SCHEDULE || '0 * * * *',
  cronScheduleLong: process.env.CRON_SCHEDULE_LONG || '*/45 * * * *',
  enableShortForm: process.env.ENABLE_SHORT_FORM ? process.env.ENABLE_SHORT_FORM === 'true' : true,
  enableLongForm: process.env.ENABLE_LONG_FORM ? process.env.ENABLE_LONG_FORM === 'true' : true,
  maxStoriesPerRun: parseInt(process.env.SHORT_FORM_MAX_PER_RUN || process.env.MAX_STORIES_PER_RUN || '1', 10),
  maxLongFormStoriesPerRun: parseInt(process.env.MAX_LONG_FORM_STORIES_PER_RUN || '1', 10),
  queueMinBuffer: parseInt(process.env.QUEUE_MIN_BUFFER || '3', 10),
  queueMaxBuffer: parseInt(process.env.QUEUE_MAX_BUFFER || '10', 10),
  maxStoriesPerSource: parseInt(process.env.MAX_STORIES_PER_SOURCE || '3', 10),
  
  // Folders relative to project root
  folders: {
    data: path.resolve(process.cwd(), 'data'),
    stories: path.resolve(process.cwd(), 'data', 'stories'),
    logs: path.resolve(process.cwd(), 'logs'),
    queue: path.resolve(process.cwd(), 'data', 'queue'),
  },
  
  // Data file
  processedFile: path.resolve(process.cwd(), 'processed.json'),
};

// Simple validation
export const validateConfig = () => {
  if (!config.ai.apiKey && !config.ai.apiUrl.includes('localhost')) {
    console.warn('WARNING: AI_API_KEY is not set. Rewriting may fail if not using local AI.');
  }
  if (!config.fpt.apiKey) {
    console.warn('WARNING: FPT_API_KEY is not set. TTS generation will fail.');
  }
  if (config.sources.includes('reddit') && (!config.reddit.clientId || !config.reddit.clientSecret || !config.reddit.username || !config.reddit.password)) {
    logger.warn('[Reddit] Skipped: OAuth credentials are missing');
  }
  if (config.sources.length === 0) {
    console.warn('WARNING: SOURCES is empty. No content sources will be crawled.');
  }
};

const logger = {
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
};
