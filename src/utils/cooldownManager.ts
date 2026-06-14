import fs from 'fs-extra';
import path from 'path';
import { config } from '../config/config';
import { logger } from './logger';

interface SourceState {
  cooldownUntil?: string;
  cooldownReason?: string;
  lastRequestMinute?: string;
  lastCategoryIndex?: number;
}

export class CooldownManager {
  private filePath = path.resolve(process.cwd(), 'data', 'cooldowns.json');
  private state: Record<string, SourceState> = {};

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.state = fs.readJsonSync(this.filePath);
      }
    } catch (error) {
      logger.error('Failed to load cooldowns.json', error);
      this.state = {};
    }
  }

  private save() {
    try {
      fs.ensureDirSync(path.dirname(this.filePath));
      fs.writeJsonSync(this.filePath, this.state, { spaces: 2 });
    } catch (error) {
      logger.error('Failed to save cooldowns.json', error);
    }
  }

  public isCooldownActive(source: string): boolean {
    const s = this.state[source];
    if (!s || !s.cooldownUntil) return false;
    const now = new Date();
    const until = new Date(s.cooldownUntil);
    return now < until;
  }

  public getCooldownUntil(source: string): string | undefined {
    return this.state[source]?.cooldownUntil;
  }

  public getCooldownReason(source: string): string {
    return this.state[source]?.cooldownReason || 'cooldown';
  }

  public setCooldown(source: string, reason: string, durationHours: number) {
    const now = new Date();
    const until = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
    if (!this.state[source]) {
      this.state[source] = {};
    }
    this.state[source].cooldownUntil = until.toISOString();
    this.state[source].cooldownReason = reason;
    this.save();
    logger.warn(`[Cooldown Manager] Set cooldown for ${source} for ${durationHours} hours because of: ${reason}`);
  }

  public checkAndRegisterMinuteRequest(source: string): boolean {
    const now = new Date();
    const minuteStr = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;
    
    if (!this.state[source]) {
      this.state[source] = {};
    }

    if (this.state[source].lastRequestMinute === minuteStr) {
      return false; // Repeated request within the same minute
    }

    this.state[source].lastRequestMinute = minuteStr;
    this.save();
    return true;
  }

  public getNextCategoryIndex(source: string, totalCategories: number): number {
    if (totalCategories <= 1) return 0;
    if (!this.state[source]) {
      this.state[source] = {};
    }
    let idx = this.state[source].lastCategoryIndex ?? -1;
    idx = (idx + 1) % totalCategories;
    this.state[source].lastCategoryIndex = idx;
    this.save();
    return idx;
  }
}

export const cooldownManager = new CooldownManager();
