import cron from 'node-cron';
import { config } from './config/config';
import { logger } from './utils/logger';
import { setupDirectories } from './utils/fileSystem';
import { runAutomationCycle } from './jobs/queueManager';

const start = async () => {
  try {
    // 1. Init folders
    await setupDirectories();

    logger.info('YouTube Shorts V2 Automation Service Started');
    logger.info(`Cron Schedule: ${config.cronSchedule}`);
    logger.info(`Max Stories per run: ${config.maxStoriesPerRun}`);

    // Optional: Run once on startup to verify everything works
    logger.info('Triggering initial run on startup...');
    runAutomationCycle().catch(err => logger.error('Initial Job Error:', err));

    // 3. Schedule Job
    cron.schedule(config.cronSchedule, () => {
      logger.info('Cron triggered!');
      runAutomationCycle().catch(err => logger.error('Job Error:', err));
    });

  } catch (error) {
    logger.error('Failed to start application', error);
    process.exit(1);
  }
};

start();
