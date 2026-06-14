import path from 'path';
import fs from 'fs-extra';
import { Story, FinalOutput, StorySegment, TimelineItem } from '../types';
import { detectCategory } from '../services/analysis/categoryDetector';
import { calculateViralScore, isViralEnough } from '../services/analysis/viralScorer';
import { shouldUseComments } from '../services/analysis/commentDecision';
import { generateStorySegments } from '../services/ai/segmentGenerator';
import { setupStoryDirectories } from '../utils/storyDirManager';
import { estimateSegmentDuration, generateSRT } from '../services/generation/subtitleService';
import { generateAudio, getVoiceConfigForSegmentType } from '../services/ttsService';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { duplicateHandler } from '../utils/duplicateHandler';

export const processSingleStory = async (story: Story): Promise<boolean> => {
  logger.info(`[Workflow] Starting Segment-Based Pipeline for story: ${story.id} - "${story.title}"`);

  try {
    // 1. Duplicate detection
    const contentHash = duplicateHandler.getStoryContentHash(story);
    if (duplicateHandler.isContentHashProcessed(contentHash)) {
      logger.info(`[Workflow] Skipped ${story.id}: Duplicate content hash already processed.`);
      return false;
    }

    if (duplicateHandler.isTooSimilar(story.title, 0.6)) {
      logger.info(`[Workflow] Skipped ${story.id}: Too similar to an already processed story.`);
      return false;
    }

    // 2. Category detection
    logger.info(`[Workflow] Detecting category for ${story.id}...`);
    const categoryResult = await detectCategory(story.title, story.content, story.subreddit);
    if (!categoryResult) {
      logger.warn(`[Workflow] Category detection failed for ${story.id}. Skipping story.`);
      return false;
    }

    // 3. Viral Scorer
    const viralScore = calculateViralScore(story, categoryResult);
    if (!isViralEnough(viralScore)) {
      logger.info(`[Workflow] Skipped ${story.id}: Low viral score (${viralScore}).`);
      return false;
    }

    // 4. Initialize segment-based folders: data/stories/short/{story_id}
    logger.info(`[Workflow] Provisioning stories directory architecture for story: ${story.id}...`);
    const storyPaths = await setupStoryDirectories(story.id, 'short');

    // 5. Save Raw Reddit Data to raw/story.json
    const rawStoryPath = path.join(storyPaths.raw, 'story.json');
    await fs.writeJson(rawStoryPath, story, { spaces: 2 });
    logger.info(`[Workflow] Raw Reddit story saved to ${rawStoryPath}`);

    // 6. Comment decision system
    const useComments = shouldUseComments(story);
    logger.info(`[Workflow] Story ${story.id} - Should use community comments? ${useComments}`);

    // 7. Generate Vietnamese Story Segments
    logger.info(`[Workflow] Generating story segments via LLM for story: ${story.id}...`);
    const rawSegments = await generateStorySegments(story, useComments);
    if (!rawSegments || rawSegments.length === 0) {
      logger.error(`[Workflow] Failed to generate valid segments for story: ${story.id}. Skipping.`);
      return false;
    }

    // Map segments, assign TTS voice/speed and write to processed/segments.json
    const processedSegments: StorySegment[] = rawSegments.map((seg, idx) => {
      const ttsConfig = getVoiceConfigForSegmentType(seg.type);
      return {
        ...seg,
        // Unique index-based id for clear file mapping if desired, but keep original id structure
        voice: ttsConfig.voice,
        speed: ttsConfig.speed
      };
    });

    const segmentsJsonPath = path.join(storyPaths.processed, 'segments.json');
    await fs.writeJson(segmentsJsonPath, { segments: processedSegments }, { spaces: 2 });
    logger.info(`[Workflow] Processed segments saved to ${segmentsJsonPath}`);

    // 8. Generate separate Audio & synced Subtitle files per segment
    logger.info(`[Workflow] Generating audio and synced subtitles for ${processedSegments.length} segments...`);
    const timelineItems: TimelineItem[] = [];

    for (let i = 0; i < processedSegments.length; i++) {
      const segment = processedSegments[i];
      const indexStr = String(i + 1).padStart(2, '0');

      const audioFilename = `${indexStr}_${segment.id}.mp3`;
      const srtFilename = `${indexStr}_${segment.id}.srt`;

      const audioPath = path.join(storyPaths.audio, audioFilename);
      const srtPath = path.join(storyPaths.subtitles, srtFilename);

      // Generate separate TTS audio for this segment
      logger.info(`[Workflow] Generating segment TTS [${i + 1}/${processedSegments.length}]: ${segment.id}`);
      const ttsSuccess = await generateAudio(segment.text, audioPath, segment.voice, segment.speed);
      if (!ttsSuccess) {
        logger.warn(`[Workflow] TTS generation failed for segment ${segment.id}, writing placeholders/continuing.`);
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

    // 9. Save Compiled metadata/timeline.json
    const timelineJsonPath = path.join(storyPaths.metadata, 'timeline.json');
    await fs.writeJson(timelineJsonPath, timelineItems, { spaces: 2 });
    logger.info(`[Workflow] Compilation timeline saved to ${timelineJsonPath}`);

    // 10. Generate and save master FinalOutput json to traditional metadata location for external trackers
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
      thumbnail_text: 'DRAMA'
    };

    const storyMetadataPath = path.join(storyPaths.metadata, 'story_metadata.json');
    await fs.writeJson(storyMetadataPath, finalOutput, { spaces: 2 });
    logger.info(`[Workflow] Unified story metadata catalogued at ${storyMetadataPath}`);

    // 11. Register success and mark as processed in Jaccard similarity cache
    duplicateHandler.markProcessed(story.id, story.title, story.source, contentHash);
    logger.info(`[Workflow] SUCCESSFULLY completed segment-based pipeline for ${story.id}!\n`);

    return true;
  } catch (error) {
    logger.error(`[Workflow] Critical error processing story ${story.id}:`, error);
    return false;
  }
};
