import fs from 'fs-extra';
import path from 'path';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { duplicateHandler } from '../utils/duplicateHandler';
import { RedditCrawler } from '../services/crawlers/RedditCrawler';
import { rewriteStory } from '../services/openaiService';
import { generateAudio } from '../services/ttsService';

export const processStories = async () => {
  logger.info('--- Starting Story Processing Job ---');

  // Currently only Reddit is implemented, but we can easily loop over multiple crawlers here
  const crawler = new RedditCrawler();
  let stories = [];

  try {
    stories = await crawler.fetchTopStories(config.maxStoriesPerRun);
    logger.info(`Fetched ${stories.length} stories from ${crawler.getSourceName()}`);
  } catch (error) {
    logger.error('Error fetching stories', error);
    return;
  }

  let processedCount = 0;

  for (const story of stories) {
    if (duplicateHandler.isProcessed(story.id)) {
      logger.info(`Skipping duplicate story: ${story.id}`);
      continue;
    }

    logger.info(`Processing story: ${story.id} - ${story.title}`);

    try {
      // 1. Save raw JSON
      const rawPath = path.join(config.folders.raw, `${story.id}.json`);
      await fs.writeJson(rawPath, story, { spaces: 2 });
      logger.info(`Raw story saved to ${rawPath}`);

      // 2. Rewrite script with OpenAI
      logger.info('Rewriting story to Shorts script...');
      const script = await rewriteStory(story.title, story.content);
      
      if (!script) {
        logger.error(`Skipping ${story.id} due to rewrite failure.`);
        continue; // gracefully continue
      }

      const scriptPath = path.join(config.folders.rewritten, `${story.id}.txt`);
      await fs.writeFile(scriptPath, script);
      logger.info(`Rewritten script saved to ${scriptPath}`);

      // 3. Generate Audio with FPT AI
      logger.info('Generating audio from script...');
      const audioSuccess = await generateAudio(script, story.id);
      
      if (!audioSuccess) {
        logger.error(`Skipping audio generation for ${story.id} due to TTS failure.`);
        continue; // gracefully continue
      }

      // 4. Mark as processed ONLY if full workflow succeeded
      duplicateHandler.markProcessed(story.id);
      processedCount++;
      logger.info(`Successfully finished processing story: ${story.id}`);

    } catch (error) {
      logger.error(`Unexpected error processing story ${story.id}`, error);
      // Graceful failure, continue to next story
    }
  }

  logger.info(`--- Finished Job. Processed ${processedCount} stories successfully. ---`);
};
