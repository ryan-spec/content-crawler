import path from 'path';
import fs from 'fs-extra';
import { config } from '../config/config';
import { logger } from './logger';

export interface StoryPaths {
  base: string;
  raw: string;
  processed: string;
  audio: string;
  subtitles: string;
  metadata: string;
  render: string;
}

/**
 * Dynamically resolves all sub-directories and file paths for a specific story.
 */
export const getStoryPaths = (storyId: string): StoryPaths => {
  // Use config.folders.data/stories if stories folder path is not explicitly set in config
  const baseStoriesDir = (config.folders as any).stories || path.join(config.folders.data, 'stories');
  const storyDir = path.join(baseStoriesDir, storyId);

  return {
    base: storyDir,
    raw: path.join(storyDir, 'raw'),
    processed: path.join(storyDir, 'processed'),
    audio: path.join(storyDir, 'audio'),
    subtitles: path.join(storyDir, 'subtitles'),
    metadata: path.join(storyDir, 'metadata'),
    render: path.join(storyDir, 'render'),
  };
};

/**
 * Automatically creates the entire folder structure for a story if it doesn't exist.
 */
export const setupStoryDirectories = async (storyId: string): Promise<StoryPaths> => {
  const paths = getStoryPaths(storyId);

  try {
    await fs.ensureDir(paths.base);
    await fs.ensureDir(paths.raw);
    await fs.ensureDir(paths.processed);
    await fs.ensureDir(paths.audio);
    await fs.ensureDir(paths.subtitles);
    await fs.ensureDir(paths.metadata);
    await fs.ensureDir(paths.render);
    
    logger.info(`[Story Dir Manager] Created architecture folders for story: ${storyId}`);
  } catch (error) {
    logger.error(`[Story Dir Manager] Failed to create directories for story: ${storyId}`, error);
    throw error;
  }

  return paths;
};
