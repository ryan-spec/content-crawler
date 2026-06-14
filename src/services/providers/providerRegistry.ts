import { config } from '../../config/config';
import { ContentProvider } from '../../types';
import { logger } from '../../utils/logger';
import { DanTriProvider } from './DanTriProvider';
import { RedditProvider } from './RedditProvider';
import { VozProvider } from './VozProvider';
import { VnExpressProvider } from './VnExpressProvider';

type ProviderFactory = () => ContentProvider;

const providerFactories: Record<string, ProviderFactory> = {
  reddit: () => new RedditProvider(),
  voz: () => new VozProvider(),
  vnexpress: () => new VnExpressProvider(),
  dantri: () => new DanTriProvider(),
};

export const getProviders = (source: string = 'all'): ContentProvider[] => {
  const requestedSources = source === 'all'
    ? config.sources
    : source.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);

  return requestedSources
    .filter(sourceName => {
      const enabled = config.sources.includes(sourceName);
      const known = Boolean(providerFactories[sourceName]);

      if (!known) {
        logger.warn(`[Providers] Unknown content source ignored: ${sourceName}`);
      } else if (!enabled) {
        logger.info(`[Providers] Source ${sourceName} is not enabled by SOURCES.`);
      }

      return known && enabled;
    })
    .map(sourceName => providerFactories[sourceName]());
};
