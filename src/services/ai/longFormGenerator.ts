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
- Write in a slow-paced, deeply personal, and highly emotional first-person tone (use "Tôi" or "Mình" for narration).
- Toàn bộ nội dung kể chuyện (trường "text") phải bằng tiếng Việt thuần túy. KHÔNG dùng từ tiếng Anh.
- QUY TẮC DỊCH THUẬT QUAN HỆ & GIỚI TÍNH:
  - "boyfriend" hoặc "bf" trong câu chuyện gốc PHẢI được dịch đúng là "bạn trai" hoặc "người yêu" (tuyệt đối KHÔNG được dịch thành "anh trai", "em trai", "bố").
  - "girlfriend" hoặc "gf" trong câu chuyện gốc PHẢI được dịch đúng là "bạn gái" hoặc "người yêu" (tuyệt đối KHÔNG được dịch thành "chị gái", "em gái").
- QUY TẮC DỊCH THUẬT SLANG, IDIOMS & CỤM TỪ NGỮ CẢNH:
  - Dịch tự nhiên các tiếng lóng (slang), ngôn ngữ mạng (internet phrases), thành ngữ sang tiếng Việt. KHÔNG được để nguyên từ tiếng Anh gốc và KHÔNG dịch thô sát từng từ.
  - Các trường hợp cụ thể:
    * "give a swirly" / "give me a swirly" -> "dí đầu vào bồn cầu", "ấn đầu xuống toilet xả nước", "ấn đầu vào bồn cầu".
    * "gaslighting" -> "thao túng tâm lý".
    * "red flag" -> "đầy dấu hiệu toxic", "cờ đỏ cảnh báo".
    * "creepy" -> "rợn người", "ghê ghê".
    * "loser" -> "thảm hại", "đúng kiểu thất bại".
    * "karma hit him" -> "quả báo tới nhanh".
    * "he snapped" -> "anh ta nổi điên", "anh ta bùng nổ".
    * "clingy" -> "bám người quá mức".
    * "walked all over me" -> "coi tôi như trò hề", "chà đạp lên tôi".
- Sử dụng xưng hô đối thoại tự nhiên: Khi đối thoại, tương tác PHẢI dùng các đại từ xưng hô tiếng Việt tự nhiên và đúng ngữ cảnh giới tính/đối tượng (ví dụ: "anh" - "em", "vợ" - "chồng", "mày" - "tao" khi giận dữ). Tuyệt đối không xưng hô "Tôi" hay "Mình" máy móc trong hội thoại.
- Biểu đạt hội thoại có cảm xúc (Dialogue System): Sử dụng các động từ biểu cảm hành động thay vì chỉ viết "anh ấy nói/cô ấy nói", ví dụ: quát, gắt lên, hét lên, thì thầm, nghẹn giọng, nói nhỏ, cười nhạt, thở dài, lẩm bẩm, buột miệng, đứng chết lặng,...
- Nhịp điệu cơ thể (Human Rhythm): Sử dụng dấu ba chấm "..." để tạo nhịp dừng tự nhiên, ngập ngừng, suy nghĩ dang dở, tăng sự kịch tính.
- Độ dài (Pacing): Segment này PHẢI dài từ 80 đến 150 từ tiếng Việt để đảm bảo nội dung chi tiết, sâu sắc và truyền tải trọn vẹn mạch truyện.
- KHÔNG BAO GỒM bất kỳ ý kiến cá nhân nào của khán giả, KHÔNG bao gồm phản ứng của internet. Focus 100% vào cốt truyện.
- Return ONLY the raw Vietnamese text for this segment. Do NOT wrap in markdown code blocks, do NOT write JSON, and do NOT include any introductory or concluding remarks. Just return the story text.`;

  const systemPrompt = `You are a master relationship drama and emotional narrator. Output ONLY the raw Vietnamese narration text for this segment, with no markdown formatting, no JSON, and no descriptions.`;

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
