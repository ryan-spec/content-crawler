import cron from 'node-cron';
import { config, validateConfig } from './config/config';
import { setupDirectories } from './utils/fileSystem';
import { logger } from './utils/logger';
import { processStories } from './jobs/processStories';

const start = async () => {
  try {
    // 1. Init folders
    await setupDirectories();

    // 2. Validate configuration
    validateConfig();

    logger.info('YouTube Shorts Automation Service Started');
    logger.info(`Cron Schedule: ${config.cronSchedule}`);
    logger.info(`Max Stories per run: ${config.maxStoriesPerRun}`);

    // Optional: Run once on startup to verify everything works
    logger.info('Triggering initial run on startup...');
    await processStories();

    // 3. Schedule Job
    cron.schedule(config.cronSchedule, async () => {
      logger.info('Cron triggered!');
      await processStories();
    });

  } catch (error) {
    logger.error('Failed to start application', error);
    process.exit(1);
  }
};

start();
