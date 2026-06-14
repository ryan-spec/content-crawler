import cron from 'node-cron';
import { config } from './config/config';
import { logger } from './utils/logger';
import { setupDirectories } from './utils/fileSystem';
import { runAutomationCycle, runLongFormAutomationCycle } from './jobs/queueManager';

const start = async () => {
  try {
    // 1. Init folders
    await setupDirectories();

    logger.info('YouTube Shorts V2 & Long-Form TikTok Storytelling Automation Service Started');
    logger.info(`Short-Form Enabled: ${config.enableShortForm} (Cron: ${config.cronScheduleShort}, Max: ${config.maxStoriesPerRun})`);
    logger.info(`Long-Form Enabled: ${config.enableLongForm} (Cron: ${config.cronScheduleLong}, Max: ${config.maxLongFormStoriesPerRun})`);
    logger.info(`Content Sources Enabled: ${config.sources.join(', ')} (Filter: ${config.sourceFilter})`);

    // 2. Trigger initial runs on startup (if enabled)
    if (config.enableShortForm) {
      logger.info('Triggering initial Short-Form run on startup...');
      runAutomationCycle(config.sourceFilter).catch(err => logger.error('Initial Short-Form Job Error:', err));
    }
    if (config.enableLongForm) {
      // Delay starting the long-form run slightly to avoid startup collision
      setTimeout(() => {
        logger.info('Triggering initial Long-Form run on startup...');
        runLongFormAutomationCycle(config.sourceFilter).catch(err => logger.error('Initial Long-Form Job Error:', err));
      }, 5000);
    }

    // 3. Schedule Jobs
    if (config.enableShortForm) {
      cron.schedule(config.cronScheduleShort, () => {
        logger.info('Short-Form Cron triggered!');
        runAutomationCycle(config.sourceFilter).catch(err => logger.error('Short-Form Job Error:', err));
      });
    }

    if (config.enableLongForm) {
      cron.schedule(config.cronScheduleLong, () => {
        logger.info('Long-Form Cron triggered!');
        runLongFormAutomationCycle(config.sourceFilter).catch(err => logger.error('Long-Form Job Error:', err));
      });
    }

  } catch (error) {
    logger.error('Failed to start application', error);
    process.exit(1);
  }
};

start();
