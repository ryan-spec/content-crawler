import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const config = {
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
  cronSchedule: process.env.CRON_SCHEDULE || '*/30 * * * *',
  cronScheduleShort: process.env.CRON_SCHEDULE_SHORT || process.env.CRON_SCHEDULE || '*/30 * * * *',
  cronScheduleLong: process.env.CRON_SCHEDULE_LONG || '*/45 * * * *',
  enableShortForm: process.env.ENABLE_SHORT_FORM ? process.env.ENABLE_SHORT_FORM === 'true' : true,
  enableLongForm: process.env.ENABLE_LONG_FORM ? process.env.ENABLE_LONG_FORM === 'true' : true,
  maxStoriesPerRun: parseInt(process.env.MAX_STORIES_PER_RUN || '3', 10),
  maxLongFormStoriesPerRun: parseInt(process.env.MAX_LONG_FORM_STORIES_PER_RUN || '1', 10),
  
  // Folders relative to project root
  folders: {
    data: path.resolve(process.cwd(), 'data'),
    stories: path.resolve(process.cwd(), 'data', 'stories'),
    logs: path.resolve(process.cwd(), 'logs'),
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
};
