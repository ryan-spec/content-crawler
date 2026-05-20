import { RedditCrawler } from '../services/crawlers/RedditCrawler';
import { processSingleStory } from './workflow';
import { config } from '../config/config';
import { logger } from '../utils/logger';

let isRunning = false;

export const runAutomationCycle = async () => {
  if (isRunning) {
    logger.warn('[Queue Manager] An automation cycle is already in progress. Skipping this trigger.');
    return;
  }

  isRunning = true;
  try {
    logger.info('--- Starting V2 Story Processing Cycle ---');
    const crawler = new RedditCrawler();

    // Fetch candidate stories (this now also fetches comments internally)
    const stories = await crawler.fetchTopStories(config.maxStoriesPerRun);
    logger.info(`Fetched ${stories.length} candidate stories for processing.`);

    let successCount = 0;

    // Process sequentially to not overload local Ollama instance
    // Since local LLM takes 100% GPU/CPU, running them concurrently usually slows down or crashes Ollama
    for (const story of stories) {
      const success = await processSingleStory(story);
      if (success) {
        successCount++;
      }
    }

    logger.info(`--- Finished Cycle. Processed ${successCount}/${stories.length} stories successfully. ---`);
  } catch (error: any) {
    logger.error('[Queue Manager] Critical error in automation cycle:', error.message);
  } finally {
    isRunning = false;
  }
};
