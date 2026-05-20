import fs from 'fs-extra';
import { config } from '../config/config';
import { logger } from './logger';

export const setupDirectories = async () => {
  try {
    await fs.ensureDir(config.folders.data);
    await fs.ensureDir(config.folders.raw);
    await fs.ensureDir(config.folders.rewritten);
    await fs.ensureDir(config.folders.audio);
    await fs.ensureDir(config.folders.logs);
    logger.info('Required directories are set up.');
  } catch (error) {
    logger.error('Failed to setup directories', error);
  }
};
