import { processSingleStory } from './workflow';
import { processSingleLongFormStory } from './longFormWorkflow';
import { isLongFormCandidate } from '../services/analysis/longFormFilter';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { getProviders } from '../services/providers/providerRegistry';
import { Story } from '../types';
import { duplicateHandler } from '../utils/duplicateHandler';
import crypto from 'crypto';

let isRunning = false;

const removeDuplicateContent = (stories: Story[], cycleLabel: string, seenInRun: Set<string>): Story[] => {
  const uniqueStories: Story[] = [];

  for (const story of stories) {
    const hash = crypto.createHash('sha256').update(`${story.source}${story.title}${story.url}`).digest('hex');
    story.hash = hash;
    story.contentHash = hash;

    if (seenInRun.has(hash) || duplicateHandler.isContentHashProcessed(hash)) {
      logger.info(`[Queue Manager] Skipped ${story.id} in ${cycleLabel}: Duplicate story.`);
      continue;
    }

    seenInRun.add(hash);
    uniqueStories.push(story);
  }

  return uniqueStories;
};

export const fetchStoriesFromProviders = async (
  limit: number,
  source: string,
  cycleLabel: string,
  filterFn?: (story: Story) => boolean,
  fetchComments: boolean = true
): Promise<Story[]> => {
  const requestedSources = source === 'all'
    ? config.sources
    : source.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);

  const enabledSources = requestedSources.filter(s => config.sources.includes(s));
  logger.info(`[Queue Manager] Enabled sources: ${enabledSources.join(', ')}`);

  const stories: Story[] = [];
  const stats: Record<string, string> = {};
  const seenInRun = new Set<string>();

  for (const sourceName of enabledSources) {
    const providers = getProviders(sourceName);
    if (providers.length === 0) {
      stats[sourceName] = 'skipped because source not enabled or configured';
      continue;
    }

    const provider = providers[0];
    try {
      const providerStories = await provider.getPosts({
        limit,
        source: sourceName,
        filterFn,
        fetchComments,
        cycleLabel,
      });

      const uniqueProviderStories = removeDuplicateContent(providerStories, cycleLabel, seenInRun);
      stories.push(...uniqueProviderStories);
      stats[sourceName] = `${uniqueProviderStories.length} stories`;
    } catch (error: any) {
      const msg = error.message || 'unknown error';
      if (msg.includes('Cloudflare challenge')) {
        stats[sourceName] = 'skipped because Cloudflare challenge';
      } else if (msg.includes('OAuth credentials are missing')) {
        stats[sourceName] = 'skipped because OAuth credentials are missing';
      } else {
        stats[sourceName] = `skipped because ${msg}`;
      }
      logger.error(`[Queue Manager] Failed to fetch ${sourceName} stories for ${cycleLabel}:`, error.message);
    }
  }

  const summaryLines = [
    'Fetched:',
    ...enabledSources.map(src => `${src}: ${stats[src] || '0 stories'}`),
    `total: ${stories.length} stories`
  ];
  console.log(summaryLines.join('\n'));

  return stories;
};

export const runAutomationCycle = async (source: string = 'all') => {
  if (isRunning) {
    logger.warn('[Queue Manager] An automation cycle is already in progress. Skipping this Short-Form trigger.');
    return;
  }

  isRunning = true;
  try {
    logger.info('--- Starting V2 Short-Form Story Processing Cycle ---');

    const stories = await fetchStoriesFromProviders(
      config.maxStoriesPerRun,
      source,
      'Short-Form',
      undefined,
      true
    );
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

export const runLongFormAutomationCycle = async (source: string = 'all') => {
  if (isRunning) {
    logger.warn('[Queue Manager] An automation cycle is already in progress. Skipping this Long-Form trigger.');
    return;
  }

  isRunning = true;
  try {
    logger.info('--- Starting V2 Long-Form Story Processing Cycle ---');

    const stories = await fetchStoriesFromProviders(
      config.maxLongFormStoriesPerRun,
      source,
      'Long-Form',
      isLongFormCandidate,
      false
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
