import { callLLM } from './ollamaService';
import { ContentReviewResult, ProcessingMode, Story } from '../../types';
import { logger } from '../../utils/logger';

const VIETNAMESE_SOURCES = new Set(['vnexpress', 'dantri', 'voz', 'webtretho']);
const ENGLISH_SOURCES = new Set(['reddit', 'quora', 'hackernews']);

interface ReviewLLMResponse {
  qualityScore?: number;
  hookScore?: number;
  processingMode?: ProcessingMode;
  edited?: boolean;
  editReason?: string;
  finalNarrationText?: string;
}

export const isVietnameseSource = (source: string): boolean => {
  return VIETNAMESE_SOURCES.has(source.toLowerCase());
};

export const getProcessingModeForSource = (source: string): ProcessingMode => {
  const normalized = source.toLowerCase();
  if (VIETNAMESE_SOURCES.has(normalized)) return 'light_vietnamese_review';
  if (ENGLISH_SOURCES.has(normalized)) return 'translate_and_rewrite';
  return 'translate_and_rewrite';
};

export const reviewContent = async (story: Story): Promise<ContentReviewResult> => {
  const source = story.source.toLowerCase();
  const sourceMode = getProcessingModeForSource(source);
  const language = isVietnameseSource(source) || story.language === 'vi' ? 'vi' : 'en';

  if (sourceMode === 'translate_and_rewrite') {
    return {
      source: story.source,
      language,
      processingMode: 'translate_and_rewrite',
      edited: true,
      editReason: 'English source requires translation and rewrite in Segment Builder',
      finalNarrationText: story.content,
    };
  }

  const fallback: ContentReviewResult = {
    source: story.source,
    language: 'vi',
    processingMode: 'none',
    edited: false,
    editReason: 'Already suitable for narration',
    finalNarrationText: story.content,
  };

  const prompt = `You are a Vietnamese short-form story editor.

The input story is already written in Vietnamese.

Your job is NOT to rewrite it.

First determine whether the story is already suitable for narration.

If it is already good:
return it unchanged.

Only make edits when necessary.

Possible edits:

* improve a weak hook
* shorten an overly long opening
* remove redundant details
* improve narration pacing

Do not rewrite the entire story.

Do not over-polish.

Do not make it sound AI-generated.

Keep the original wording whenever possible.

Keep the original meaning, facts, and emotions.

Output Vietnamese only.

SCORING AND DECISION RULES:
- Give qualityScore from 1 to 10.
- Give hookScore from 1 to 10.
- If qualityScore >= 8 and hookScore >= 6: processingMode must be "none", edited false, finalNarrationText unchanged.
- If qualityScore >= 8 and hookScore < 6: processingMode must be "hook_only", edited true, rewrite only the first 1-2 sentences and keep the rest unchanged.
- If qualityScore < 8: processingMode must be "light_vietnamese_review", edited true only if necessary, minimally edit content.
- If story is too short, do not invent events.

Return ONLY valid JSON:
{
  "qualityScore": 8,
  "hookScore": 6,
  "processingMode": "none",
  "edited": false,
  "editReason": "Already suitable for narration",
  "finalNarrationText": "..."
}

TITLE:
${story.title}

STORY:
${story.content}`;

  const systemPrompt = 'You are a strict JSON producer. Output only valid JSON. Do not wrap the response in markdown.';
  const rawResponse = await callLLM(prompt, systemPrompt, 0.25, 1);
  if (!rawResponse) {
    logger.warn(`[ContentReviewStage] Empty review response for ${story.id}. Using original Vietnamese content.`);
    return fallback;
  }

  const parsed = parseReviewResponse(rawResponse);
  if (!parsed?.finalNarrationText) {
    logger.warn(`[ContentReviewStage] Could not parse review response for ${story.id}. Using original Vietnamese content.`);
    return fallback;
  }

  const qualityScore = clampScore(parsed.qualityScore);
  const hookScore = clampScore(parsed.hookScore);
  const processingMode = normalizeVietnameseMode(parsed.processingMode, qualityScore, hookScore);
  const edited = Boolean(parsed.edited) && processingMode !== 'none';

  return {
    source: story.source,
    language: 'vi',
    processingMode,
    edited,
    editReason: parsed.editReason || (edited ? 'Light Vietnamese review applied' : 'Already suitable for narration'),
    finalNarrationText: edited ? parsed.finalNarrationText.trim() : story.content,
    qualityScore,
    hookScore,
  };
};

const parseReviewResponse = (rawText: string): ReviewLLMResponse | null => {
  try {
    const firstBrace = rawText.indexOf('{');
    const lastBrace = rawText.lastIndexOf('}');
    const jsonText = firstBrace >= 0 && lastBrace > firstBrace
      ? rawText.slice(firstBrace, lastBrace + 1)
      : rawText;
    return JSON.parse(jsonText) as ReviewLLMResponse;
  } catch {
    return null;
  }
};

const clampScore = (score: unknown): number => {
  const value = typeof score === 'number' ? score : parseFloat(String(score || '0'));
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, Math.round(value)));
};

const normalizeVietnameseMode = (mode: unknown, qualityScore: number, hookScore: number): ProcessingMode => {
  if (qualityScore >= 8 && hookScore >= 6) return 'none';
  if (qualityScore >= 8 && hookScore < 6) return 'hook_only';
  if (mode === 'hook_only' || mode === 'light_vietnamese_review' || mode === 'none') return mode;
  return 'light_vietnamese_review';
};
