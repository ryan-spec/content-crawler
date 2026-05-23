import { Story, StorySegment, SegmentType } from '../../types';
import { callLLM } from './ollamaService';
import { getPromptConfig } from './promptRouter';
import { logger } from '../../utils/logger';

interface StoryAnalysis {
  characters: string;
  relationships: string;
  emotional_arc: string;
  core_conflicts: string;
  twists: string;
  betrayal_moments: string;
  pacing_opportunities: string;
}

interface OutlineItem {
  id: string;
  type: SegmentType;
  focus: string;
}

interface StoryOutline {
  outline: OutlineItem[];
}

/**
 * Safely cleans and parses JSON from raw LLM text response.
 */
const parseJSONSafely = <T>(text: string): T | null => {
  try {
    let cleanText = text.trim();
    // Remove markdown code blocks if present
    const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      cleanText = jsonMatch[1].trim();
    } else {
      const firstBrace = cleanText.indexOf('{');
      const lastBrace = cleanText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
      }
    }

    // Replace common smart quote issues
    cleanText = cleanText
      .replace(/([{\[,]\s*)[““”]/g, '$1"')
      .replace(/[““”]\s*(:)/g, '"$1')
      .replace(/(:\s*)[““”]/g, '$1"')
      .replace(/[‘““”]\s*([,}\]])/g, '"$1')
      .replace(/,\s*([\]}])/g, '$1');

    return JSON.parse(cleanText) as T;
  } catch (error: any) {
    logger.error(`[Long Form Generator] Failed to parse JSON: ${error.message}`);
    return null;
  }
};

/**
 * Stage 1: Analyze Reddit story.
 */
const analyzeStory = async (story: Story): Promise<StoryAnalysis | null> => {
  const prompt = `Analyze this Reddit story and extract key dramatic and emotional narrative elements:

STORY TITLE: ${story.title}
SUBREDDIT: r/${story.subreddit || 'unknown'}
STORY CONTENT:
${story.content}

Return a valid JSON object matching the following structure exactly. Do NOT include markdown formatting other than raw JSON block, NO descriptions, and NO conversational text.

{
  "characters": "List and describe characters",
  "relationships": "Describe key relationship dynamics",
  "emotional_arc": "Trace the emotional progression from setup to resolution",
  "core_conflicts": "Identify the primary conflicts or betrayals",
  "twists": "Highlight critical turning points or realizations",
  "betrayal_moments": "Highlight key moments of emotional hurt or betrayal",
  "pacing_opportunities": "Suggest where to slow down for emotional impact or speed up for drama"
}`;

  const systemPrompt = "You are a strict story analysis engine. Output ONLY a valid JSON matching the schema, with NO markdown formatting other than raw JSON, NO descriptions, and NO conversational text.";

  logger.info(`[Long Form Generator] [Stage 1] Analyzing story drama structure...`);
  const response = await callLLM(prompt, systemPrompt, 0.7, 2);
  if (!response) return null;

  return parseJSONSafely<StoryAnalysis>(response);
};

/**
 * Stage 2: Generate story outline.
 */
const generateStoryOutline = async (story: Story, analysis: StoryAnalysis): Promise<StoryOutline | null> => {
  const prompt = `Based on the following story analysis, design a detailed 6 to 10 segment narrative outline in English for a 3-8 minute TikTok storytelling voiceover.
The segments must map logically to the supported types: 'hook' | 'setup' | 'tension' | 'conflict' | 'twist' | 'confrontation' | 'aftermath' | 'ending' | 'reflection'.
DO NOT include any comment or reaction segments. We only want pure storytelling.

STORY TITLE: ${story.title}
SUBREDDIT: r/${story.subreddit || 'unknown'}
STORY ANALYSIS:
${JSON.stringify(analysis, null, 2)}

Return a valid JSON object matching the following structure exactly:
{
  "outline": [
    {
      "id": "segment_id (e.g. hook, setup, tension_1, conflict_1, twist_1, confrontation_1, aftermath_1, ending, reflection)",
      "type": "one of the supported segment types",
      "focus": "concise description of what happens in this segment"
    }
  ]
}

Ensure the segment types are logically ordered to maximize retention and pacing.`;

  const systemPrompt = "You are a strict narrative outline engine. Output ONLY a valid JSON matching the outline schema, with NO extra conversational text.";

  logger.info(`[Long Form Generator] [Stage 2] Creating narrative outline...`);
  const response = await callLLM(prompt, systemPrompt, 0.7, 2);
  if (!response) return null;

  return parseJSONSafely<StoryOutline>(response);
};

/**
 * Stage 3: Generate each segment independently.
 */
const generateSegmentText = async (
  story: Story,
  analysis: StoryAnalysis,
  outline: StoryOutline,
  currentIdx: number,
  previousSegmentsText: string,
  subredditStyleInstructions: string
): Promise<string | null> => {
  const currentItem = outline.outline[currentIdx];

  const prompt = `You are a professional storyteller. Generate the narrative text in Vietnamese for the current segment based on the original story, the dramatic analysis, and the full outline.

STORY TITLE: ${story.title}
SUBREDDIT: r/${story.subreddit || 'unknown'}
STORY CONTENT:
${story.content}

STORY DRAMATIC ANALYSIS:
${JSON.stringify(analysis, null, 2)}

FULL OUTLINE:
${JSON.stringify(outline, null, 2)}

PREVIOUSLY GENERATED NARRATION (MAINTAIN PERFECT CONTINUITY WITH THIS TEXT):
${previousSegmentsText ? previousSegmentsText : "(This is the first segment. Hook the audience immediately.)"}

---
CURRENT SEGMENT TO GENERATE:
Segment ID: ${currentItem.id}
Segment Type: ${currentItem.type}
Focus of this Segment: ${currentItem.focus}

---
CRITICAL TRANSLATION & NARRATION RULES (QUY TẮC BẮT BUỘC):
- REALISM RULES (VERY IMPORTANT):
  * The story MUST feel like a real Reddit confession/storytelling post.
  * DO NOT write like a novel, poetry, philosophical writing, Netflix drama, or fanfiction.
  * The narration should feel like someone casually but emotionally telling a real experience online.
  * PRIORITIZE SCENE-BASED STORYTELLING: Write immersive, cinematic, and conversational scenes instead of bullet point recaps or fact dumping. Show realistic scenes, awkward interactions, believable dialogue, uncomfortable silence, small human details, emotional realism.
  * AVOID: dramatic metaphors, excessive inner monologue, philosophical sadness, repetitive trauma narration, unrealistic coincidences, soap opera twists, celebrity family reveals, giant plot twists every segment.
  * The story should revolve around ONE main emotional conflict only. Do NOT keep introducing new dramatic reveals.
  * GOOD REDDIT DRAMA: family tension, awkward dinners, passive aggressive parents, uncomfortable phone calls, discovering old letters/photos/messages, silent resentment, emotional neglect, betrayal, realistic arguments.
  * BAD DRAMA: everyone is secretly famous, unrealistic DNA reveals, constant screaming, multiple giant twists, overly evil characters, anime-style emotional writing.
- FOCUS & RATIO:
  * Focus on EVENTS and INTERACTIONS first. Emotion should come naturally from scenes.
  * Use this ratio: 70% real events/actions, 20% dialogue/interactions, 10% emotional reflection. (NOT 80% emotional narration).
  * EVERY SEGMENT MUST CONTAIN AT LEAST: one real action OR one realistic interaction OR one concrete event.
  * Examples of GOOD storytelling: sitting in the car outside the hospital, hearing dishes in the kitchen, checking old Facebook photos, awkward silence during dinner, reading old text messages, someone changing the topic, a parent avoiding eye contact.
- CHARACTER WRITING RULES:
  * Characters must behave consistently. Avoid dramatic villain speeches, sudden personality changes, overly theatrical reactions.
  * Most real people: avoid direct confrontation, downplay emotions, speak indirectly, say less than they actually feel.
- DIALOGUE RULES:
  * Dialogue must sound natural Vietnamese. Avoid robotic emotional lines, overly formal speech, translated-English structure, repetitive dramatic wording.
  * Use: short interruptions, unfinished sentences, awkward pauses, casual spoken Vietnamese.
- IMPORTANT VIETNAMESE PRONOUN RULES:
  * Use proper Vietnamese pronouns based on age and relationship.
  * father -> "ông ấy", "bố tôi" | older middle-aged man -> "ông ấy" | boyfriend/husband/young adult male -> "anh ấy" | mother -> "bà ấy", "mẹ tôi" | older woman -> "bà ấy".
  * DO NOT incorrectly call fathers or elderly men "anh ấy". Maintain pronoun consistency throughout the story.
  * "boyfriend" / "bf" MUST be translated as "bạn trai" / "người yêu" (NEVER "anh trai", "em trai", "bố").
  * "girlfriend" / "gf" MUST be translated as "bạn gái" / "người yêu" (NEVER "chị gái", "em gái").
- PACING RULES:
  * Do NOT make every segment equally dramatic.
  * Some scenes should feel: quiet, awkward, casual, emotionally restrained, uncomfortable.
  * Build tension slowly and naturally. The story should feel messy, human, imperfect, believable.
- HOOK RULES (If Segment Type is 'hook'):
  * The hook MUST be 1-2 short lines.
  * Create tension immediately (conflict-first).
  * Do NOT summarize the entire story. Avoid over-explaining.
  * Must sound like high-retention TikTok storytelling (e.g. "Con gái lớn của tôi... ghét chính em ruột mình.", "Mọi thứ bùng nổ... chỉ vì một chuyến du lịch.").
- TRANSLATION & FORMATTING:
  * Translate slang and internet phrases naturally into Vietnamese (e.g. "gaslighting" -> "thao túng tâm lý", "red flag" -> "dấu hiệu độc hại", "creepy" -> "rợn người", "loser" -> "thảm hại", "karma hit him" -> "quả báo", "đổ lỗi cho chính mình" -> "tự chịu trách nhiệm" / "đó là hậu quả do nó tự chọn").
  * AITA TRANSLATION: NEVER translate "AITA" or "Am I The Asshole" to "kẻ lừa đảo". Use natural phrases like "Tôi có quá đáng không?", "Tôi có sai không?", "Tôi có tệ quá không?".
  * Use "..." for natural human rhythm, pauses, and incomplete thoughts.
  * Length: This segment MUST be between 80 to 150 Vietnamese words.
  * NO internet reactions or audience commentary. Focus 100% on the story.
  * Return ONLY the raw Vietnamese text for this segment. Do NOT wrap in markdown code blocks, do NOT write JSON, and do NOT include any introductory or concluding remarks. Just return the story text.`;

  const systemPrompt = `You are a raw, realistic Reddit storyteller. Output ONLY the raw Vietnamese narration text for this segment, with no markdown formatting, no JSON, and no descriptions.`;

  logger.info(`[Long Form Generator] [Stage 3] Generating segment ${currentIdx + 1}/${outline.outline.length}: ${currentItem.id} (${currentItem.type})`);
  const response = await callLLM(prompt, systemPrompt, 0.8, 1);
  return response;
};

/**
 * Main Entry Point: Upgrades Reddit automation pipeline to support LONG-FORM TikTok storytelling (3-8 minutes).
 */
export const generateLongFormStorySegments = async (story: Story): Promise<StorySegment[] | null> => {
  const promptConfig = getPromptConfig(story.subreddit);

  // 1. Stage 1: Analyze dramatic structure
  const analysis = await analyzeStory(story);
  if (!analysis) {
    logger.error(`[Long Form Generator] Story analysis failed. Skipping long-form generation.`);
    return null;
  }

  // 2. Stage 2: Create outline
  const outline = await generateStoryOutline(story, analysis);
  if (!outline || !Array.isArray(outline.outline) || outline.outline.length === 0) {
    logger.error(`[Long Form Generator] Outline generation failed. Skipping long-form generation.`);
    return null;
  }

  logger.info(`[Long Form Generator] Generated outline with ${outline.outline.length} segments.`);

  // 3. Stage 3: Sequential Segment Generation
  const segments: StorySegment[] = [];
  let cumulativeText = '';

  for (let i = 0; i < outline.outline.length; i++) {
    const item = outline.outline[i];
    let segmentText = await generateSegmentText(story, analysis, outline, i, cumulativeText, promptConfig.styleInstructions);

    if (!segmentText) {
      logger.warn(`[Long Form Generator] Failed to generate segment ${item.id}. Trying one quick retry...`);
      segmentText = await generateSegmentText(story, analysis, outline, i, cumulativeText, promptConfig.styleInstructions);
    }

    // Direct fallback if LLM failed twice to avoid completely dropping the story
    const finalCleanText = segmentText ? segmentText.trim() : `[Mất kết nối lúc kể chuyện... Tiếp tục hành trình này...]`;
    
    // Update cumulative history
    cumulativeText += `\n[Segment ${item.id} (${item.type})]\n${finalCleanText}\n`;

    segments.push({
      id: item.id,
      type: item.type,
      text: finalCleanText
    });
  }

  logger.info(`[Long Form Generator] SUCCESSFULLY generated all ${segments.length} long-form segments!`);
  return segments;
};
