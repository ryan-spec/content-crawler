import fs from 'fs-extra';
import { config } from '../config/config';
import { logger } from './logger';

export class DuplicateHandler {
  private processedData: { id: string, title: string }[] = [];

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(config.processedFile)) {
        const data = fs.readJsonSync(config.processedFile);
        if (Array.isArray(data)) {
          // Handle migration from old format [string, string] to new format
          this.processedData = data.map(item => {
            if (typeof item === 'string') return { id: item, title: '' };
            return item;
          });
        }
      }
    } catch (error) {
      logger.error('Failed to load processed.json', error);
      this.processedData = [];
    }
  }

  private save() {
    try {
      fs.writeJsonSync(config.processedFile, this.processedData, { spaces: 2 });
    } catch (error) {
      logger.error('Failed to save processed.json', error);
    }
  }

  public isProcessed(id: string): boolean {
    return this.processedData.some(item => item.id === id);
  }

  // Simple Jaccard similarity for title comparison
  private getSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    const set1 = new Set(str1.toLowerCase().split(/\s+/));
    const set2 = new Set(str2.toLowerCase().split(/\s+/));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
  }

  public isTooSimilar(title: string, threshold = 0.6): boolean {
    for (const item of this.processedData) {
      if (this.getSimilarity(item.title, title) > threshold) {
        return true;
      }
    }
    return false;
  }

  public markProcessed(id: string, title: string) {
    if (!this.isProcessed(id)) {
      this.processedData.push({ id, title });
      this.save();
    }
  }
}

export const duplicateHandler = new DuplicateHandler();
