import fs from 'fs-extra';
import { config } from '../config/config';
import { logger } from './logger';

export class DuplicateHandler {
  private processedIds: Set<string> = new Set();

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(config.processedFile)) {
        const data = fs.readJsonSync(config.processedFile);
        if (Array.isArray(data)) {
          this.processedIds = new Set(data);
        }
      }
    } catch (error) {
      logger.error('Failed to load processed.json', error);
      this.processedIds = new Set();
    }
  }

  private save() {
    try {
      fs.writeJsonSync(config.processedFile, Array.from(this.processedIds), { spaces: 2 });
    } catch (error) {
      logger.error('Failed to save processed.json', error);
    }
  }

  public isProcessed(id: string): boolean {
    return this.processedIds.has(id);
  }

  public markProcessed(id: string) {
    this.processedIds.add(id);
    this.save();
  }
}

export const duplicateHandler = new DuplicateHandler();
