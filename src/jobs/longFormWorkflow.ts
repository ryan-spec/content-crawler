import path from 'path';
import fs from 'fs-extra';
import { Story, FinalOutput, StorySegment, TimelineItem } from '../types';
import { detectCategory } from '../services/analysis/categoryDetector';
import { calculateViralScore, isViralEnough } from '../services/analysis/viralScorer';
import { generateLongFormStorySegments } from '../services/ai/longFormGenerator';
import { setupStoryDirectories } from '../utils/storyDirManager';
import { estimateSegmentDuration, generateSRT } from '../services/generation/subtitleService';
import { generateAudio, getVoiceConfigForSegmentType } from '../services/ttsService';
import { logger } from '../utils/logger';
import { duplicateHandler } from '../utils/duplicateHandler';

export const processSingleLongFormStory = async (story: Story): Promise<boolean> => {
  logger.info(`[Long Form Workflow] Starting Long-Form Pipeline for story: ${story.id} - "${story.title}"`);

  try {
    // 1. Duplicate detection
    const contentHash = duplicateHandler.getStoryContentHash(story);
    if (duplicateHandler.isContentHashProcessed(contentHash)) {
      logger.info(`[Long Form Workflow] Skipped ${story.id}: Duplicate content hash already processed.`);
      return false;
    }

    if (duplicateHandler.isTooSimilar(story.title, 0.6)) {
      logger.info(`[Long Form Workflow] Skipped ${story.id}: Too similar to an already processed story.`);
      return false;
    }

    // 2. Category detection
    logger.info(`[Long Form Workflow] Detecting category for ${story.id}...`);
    const categoryResult = await detectCategory(story.title, story.content, story.subreddit);
    if (!categoryResult) {
      logger.warn(`[Long Form Workflow] Category detection failed for ${story.id}. Skipping story.`);
      return false;
    }

    // 3. Viral Scorer
    const viralScore = calculateViralScore(story, categoryResult);
    if (!isViralEnough(viralScore)) {
      logger.info(`[Long Form Workflow] Skipped ${story.id}: Low viral score (${viralScore}).`);
      return false;
    }

    // 4. Initialize segment-based folders: data/stories/long/{story_id}
    logger.info(`[Long Form Workflow] Provisioning stories directory architecture for story: ${story.id}...`);
    const storyPaths = await setupStoryDirectories(story.id, 'long');

    // 5. Save Raw Reddit Data to raw/story.json
    const rawStoryPath = path.join(storyPaths.raw, 'story.json');
    await fs.writeJson(rawStoryPath, story, { spaces: 2 });
    logger.info(`[Long Form Workflow] Raw Reddit story saved to ${rawStoryPath}`);

    // 6. Generate Vietnamese Long-Form Story Segments
    logger.info(`[Long Form Workflow] Generating long-form story segments via LLM for story: ${story.id}...`);
    const rawSegments = await generateLongFormStorySegments(story);
    if (!rawSegments || rawSegments.length === 0) {
      logger.error(`[Long Form Workflow] Failed to generate valid segments for story: ${story.id}. Skipping.`);
      return false;
    }

    // Map segments, assign TTS voice/speed and write to processed/segments.json
    const processedSegments: StorySegment[] = rawSegments.map((seg) => {
      const ttsConfig = getVoiceConfigForSegmentType(seg.type);
      return {
        ...seg,
        voice: ttsConfig.voice,
        speed: ttsConfig.speed
      };
    });

    const segmentsJsonPath = path.join(storyPaths.processed, 'segments.json');
    await fs.writeJson(segmentsJsonPath, { segments: processedSegments }, { spaces: 2 });
    logger.info(`[Long Form Workflow] Processed segments saved to ${segmentsJsonPath}`);

    // 7. Generate separate Audio & synced Subtitle files per segment
    logger.info(`[Long Form Workflow] Generating audio and synced subtitles for ${processedSegments.length} segments...`);
    const timelineItems: TimelineItem[] = [];

    for (let i = 0; i < processedSegments.length; i++) {
      const segment = processedSegments[i];
      const indexStr = String(i + 1).padStart(2, '0');

      const audioFilename = `${indexStr}_${segment.id}.mp3`;
      const srtFilename = `${indexStr}_${segment.id}.srt`;

      const audioPath = path.join(storyPaths.audio, audioFilename);
      const srtPath = path.join(storyPaths.subtitles, srtFilename);

      // Generate separate TTS audio for this segment
      logger.info(`[Long Form Workflow] Generating segment TTS [${i + 1}/${processedSegments.length}]: ${segment.id}`);
      const ttsSuccess = await generateAudio(segment.text, audioPath, segment.voice, segment.speed);
      if (!ttsSuccess) {
        logger.warn(`[Long Form Workflow] TTS generation failed for segment ${segment.id}, writing placeholders/continuing.`);
      }

      // Sync SRT subtitles and estimate duration
      const estimatedDuration = estimateSegmentDuration(segment.text, segment.speed);
      const srtContent = generateSRT(segment.text, estimatedDuration);
      await fs.writeFile(srtPath, srtContent, 'utf-8');

      timelineItems.push({
        segment_id: segment.id,
        type: segment.type,
        text: segment.text,
        audio: audioFilename,
        subtitle: srtFilename,
        estimated_duration: estimatedDuration,
        voice: segment.voice,
        speed: segment.speed
      });

      // Pause briefly between segments to respect FPT AI API guidelines and reduce server pressure
      await new Promise(res => setTimeout(res, 1000));
    }

    // 8. Save Compiled metadata/timeline.json
    const timelineJsonPath = path.join(storyPaths.metadata, 'timeline.json');
    await fs.writeJson(timelineJsonPath, timelineItems, { spaces: 2 });
    logger.info(`[Long Form Workflow] Compilation timeline saved to ${timelineJsonPath}`);

    // 9. Generate and save master FinalOutput json to traditional metadata location for external trackers
    const finalOutput: FinalOutput = {
      story_id: story.id,
      subreddit: story.subreddit || 'unknown',
      category: categoryResult.category,
      viral_score: viralScore,
      emotional_arc: categoryResult.emotional_arc,
      raw_story: story,
      segments: processedSegments,
      timeline: timelineItems,
      story_folder: storyPaths.base,
      youtube_title: story.title,
      thumbnail_text: 'LONG DRAMA'
    };

    const storyMetadataPath = path.join(storyPaths.metadata, 'story_metadata.json');
    await fs.writeJson(storyMetadataPath, finalOutput, { spaces: 2 });
    logger.info(`[Long Form Workflow] Unified story metadata catalogued at ${storyMetadataPath}`);

    // 10. Register success and mark as processed in Jaccard similarity cache
    duplicateHandler.markProcessed(story.id, story.title, story.source, contentHash);
    logger.info(`[Long Form Workflow] SUCCESSFULLY completed long-form segment-based pipeline for ${story.id}!\n`);

    return true;
  } catch (error) {
    logger.error(`[Long Form Workflow] Critical error processing story ${story.id}:`, error);
    return false;
  }
};
