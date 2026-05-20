import { logger } from '../../utils/logger';

/**
 * Estimates the duration of a spoken Vietnamese text segment in seconds based on word count and speech speed.
 * normal speed (0) = ~2.7 words/second
 * slow speed (-1) = ~2.2 words/second
 * fast speed (1) = ~3.2 words/second
 */
export const estimateSegmentDuration = (text: string, speed: string = '0'): number => {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return 0;

  let wordsPerSecond = 2.7; // Default speed "0"
  if (speed === '-1') {
    wordsPerSecond = 2.2;
  } else if (speed === '1') {
    wordsPerSecond = 3.2;
  }

  // Calculate base duration and ensure a minimum of 2.0 seconds so audio is not cut off
  const duration = words.length / wordsPerSecond;
  return Math.max(2.0, Math.round(duration * 10) / 10);
};

/**
 * Formats a raw number of seconds into standard SRT timestamp format (HH:MM:SS,mmm)
 */
const formatSRTTime = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  const hrsStr = String(hrs).padStart(2, '0');
  const minsStr = String(mins).padStart(2, '0');
  const secsStr = String(secs).padStart(2, '0');
  const msStr = String(ms).padStart(3, '0');

  return `${hrsStr}:${minsStr}:${secsStr},${msStr}`;
};

/**
 * Generates standard synced SRT subtitle file contents for a segment.
 * Automatically splits text into snappy TikTok-style captions of 3-4 words.
 */
export const generateSRT = (text: string, duration: number): string => {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return '';

  // Snappy sub-lines (TikTok style captions of 3 words)
  const wordsPerSub = 3;
  const subs: string[] = [];

  for (let i = 0; i < words.length; i += wordsPerSub) {
    subs.push(words.slice(i, i + wordsPerSub).join(' '));
  }

  const numSubs = subs.length;
  const timePerSub = duration / numSubs;

  let srtContent = '';

  for (let i = 0; i < numSubs; i++) {
    const startSec = i * timePerSub;
    const endSec = (i + 1) * timePerSub;

    const startStr = formatSRTTime(startSec);
    const endStr = formatSRTTime(endSec);

    srtContent += `${i + 1}\n${startStr} --> ${endStr}\n${subs[i]}\n\n`;
  }

  return srtContent.trim();
};
