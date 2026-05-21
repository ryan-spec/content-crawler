import { RedditCrawler } from '../services/crawlers/RedditCrawler';
import { processSingleStory } from './workflow';
import { processSingleLongFormStory } from './longFormWorkflow';
import { isLongFormCandidate } from '../services/analysis/longFormFilter';
import { config } from '../config/config';
import { logger } from '../utils/logger';

let isRunning = false;

export const runAutomationCycle = async () => {
  if (isRunning) {
    logger.warn('[Queue Manager] An automation cycle is already in progress. Skipping this Short-Form trigger.');
    return;
  }

  isRunning = true;
  try {
    logger.info('--- Starting V2 Short-Form Story Processing Cycle ---');
    const crawler = new RedditCrawler();

    // Fetch candidate stories (this now also fetches comments internally)
    const stories = await crawler.fetchTopStories(config.maxStoriesPerRun);
    logger.info(`Fetched ${stories.length} candidate stories for Short-Form processing.`);

    let successCount = 0;

    // Process sequentially to not overload local Ollama instance
    // Since local LLM takes 100% GPU/CPU, running them concurrently usually slows down or crashes Ollama
    for (const story of stories) {
      const success = await processSingleStory(story);
      if (success) {
        successCount++;
      }
    }

    logger.info(`--- Finished Short-Form Cycle. Processed ${successCount}/${stories.length} stories successfully. ---`);
  } catch (error: any) {
    logger.error('[Queue Manager] Critical error in Short-Form automation cycle:', error.message);
  } finally {
    isRunning = false;
  }
};

export const runLongFormAutomationCycle = async () => {
  if (isRunning) {
    logger.warn('[Queue Manager] An automation cycle is already in progress. Skipping this Long-Form trigger.');
    return;
  }

  isRunning = true;
  try {
    logger.info('--- Starting V2 Long-Form Story Processing Cycle ---');
    const crawler = new RedditCrawler();

    // Fetch candidate stories (filtered with isLongFormCandidate and skipping comments fetch)
    const stories = await crawler.fetchTopStories(
      config.maxLongFormStoriesPerRun,
      isLongFormCandidate,
      false // fetchComments = false for long-form stories
    );
    logger.info(`Fetched ${stories.length} candidate stories for Long-Form processing.`);

    let successCount = 0;

    // Process sequentially to not overload local Ollama instance
    for (const story of stories) {
      const success = await processSingleLongFormStory(story);
      if (success) {
        successCount++;
      }
    }

    logger.info(`--- Finished Long-Form Cycle. Processed ${successCount}/${stories.length} stories successfully. ---`);
  } catch (error: any) {
    logger.error('[Queue Manager] Critical error in Long-Form automation cycle:', error.message);
  } finally {
    isRunning = false;
  }
};
