import { callLLM } from './ollamaService';
import { getPromptConfig } from './promptRouter';
import { Story, StorySegment, ProcessedStory } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Validates a generated script segment.
 */
const validateSegment = (segment: StorySegment): boolean => {
  const text = segment.text.trim();
  if (text.length < 10) {
    logger.warn(`Segment validation warning: segment ${segment.id} is too short (${text.length} chars).`);
    return false;
  }

  // Detect english words in narration
  const englishWords = [' the ', ' and ', ' you ', ' that ', ' this ', ' was ', ' with ', ' are '];
  let englishCount = 0;
  for (const w of englishWords) {
    if (text.toLowerCase().includes(w)) englishCount++;
  }
  if (englishCount >= 2) {
    logger.warn(`Segment validation warning: Too many English words in segment ${segment.id}`);
    return false;
  }

  // Detect robotic words
  const roboticWords = ['bàng hoàng', 'kinh hoàng', 'gây sốc', 'tóm lại', 'tóm tắt', 'có một người'];
  for (const w of roboticWords) {
    if (text.toLowerCase().includes(w)) {
      logger.warn(`Segment validation warning: Robotic word "${w}" detected in segment ${segment.id}`);
      return false;
    }
  }

  return true;
};

/**
 * Safely sanitizes JSON control characters (like raw newlines, carriage returns, tabs)
 * inside string literals to prevent "Bad control character in string literal" errors.
 */
const sanitizeJSONControlCharacters = (jsonStr: string): string => {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (char === '"' && !escaped) {
      inString = !inString;
      result += char;
    } else if (inString) {
      if (char === '\\') {
        escaped = !escaped;
        result += char;
      } else {
        escaped = false;
        if (char === '\n') {
          result += '\\n';
        } else if (char === '\r') {
          result += '\\r';
        } else if (char === '\t') {
          result += '\\t';
        } else {
          result += char;
        }
      }
    } else {
      escaped = false;
      result += char;
    }
  }
  return result;
};

/**
 * Pre-cleans raw LLM JSON text to handle curly/smart quotes and syntax errors.
 */
const preCleanJSON = (text: string): string => {
  let cleaned = text.trim();

  // Normalize curly/smart double quotes at structural boundaries
  cleaned = cleaned
    .replace(/([{\[,]\s*)[““”]/g, '$1"')
    .replace(/[““”]\s*(:)/g, '"$1')
    .replace(/(:\s*)[““”]/g, '$1"')
    .replace(/[‘““”]\s*([,}\]])/g, '"$1');

  // Fix unescaped double quotes inside quoted string values (e.g. "text": "'Dialogue'" Action...")
  cleaned = cleaned.replace(/(:\s*)"'([\s\S]*?)'"([\s\S]*?)"\s*([,}\]])/g, '$1"\'$2\'$3"$4');

  // Fix common LLM quote mismatch typos like starts with "' and ends with !"' or '"'
  cleaned = cleaned.replace(/(:\s*)"'([\s\S]*?)['"“”‘’]+\s*([,}\]])/g, '$1"\'$2\'"$3');

  // Replace common syntax errors (like trailing commas in arrays/objects before closing brackets)
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

  // Sanitize raw control characters in string literals
  cleaned = sanitizeJSONControlCharacters(cleaned);

  return cleaned;
};

/**
 * Attempts to extract and parse JSON safely from raw LLM output.
 * Handles markdown formatting (e.g. ```json ... ```) and leading/trailing text.
 */
const parseLLMJSON = (rawText: string): ProcessedStory | null => {
  try {
    let cleanText = rawText.trim();

    // Remove markdown code blocks if present
    const jsonMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      cleanText = jsonMatch[1].trim();
    } else {
      // Find the first open curly brace and last close curly brace
      const firstBrace = cleanText.indexOf('{');
      const lastBrace = cleanText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
      }
    }

    // Apply pre-cleaning for quotes, syntax errors, and bad control characters
    cleanText = preCleanJSON(cleanText);

    const parsed = JSON.parse(cleanText) as ProcessedStory;
    if (parsed && Array.isArray(parsed.segments)) {
      return parsed;
    }
    return null;
  } catch (error: any) {
    logger.error('Failed to parse segments JSON from raw LLM text', error.message);
    return null;
  }
};

/**
 * Generates structured storytelling segments for a Reddit story.
 */
export const generateStorySegments = async (story: Story, useComments: boolean): Promise<StorySegment[] | null> => {
  const promptConfig = getPromptConfig(story.subreddit);

  let commentsSection = '';
  if (useComments && story.comments && story.comments.length > 0) {
    commentsSection = `\nCOMMUNITY COMMENTS (USE THESE TO GENERATE INTERNET REACTIONS/TRANSITION/COMMENT SEGMENTS):\n`;
    story.comments.forEach((c, idx) => {
      commentsSection += `Comment ${idx + 1} (Score: ${c.score}): "${c.body}" - by /u/${c.author}\n`;
    });
  } else {
    commentsSection = `\n(Do not generate any comment or reaction segments. Focus 100% on the core story script itself.)\n`;
  }

  const prompt = `You are a high-retention TikTok narration writer. Rewrite this Reddit story into segment-based story scenes in Vietnamese.
  
STORY TITLE: ${story.title}
SUBREDDIT: r/${story.subreddit || 'unknown'}
STORY CONTENT:
${story.content}
${commentsSection}

STYLE REQUIREMENTS:
${promptConfig.styleInstructions}

QUY TẮC BẮT BUỘC:
- Toàn bộ nội dung kể chuyện (trường "text") phải bằng tiếng Việt thuần túy. KHÔNG dùng từ tiếng Anh.
- Sử dụng xưng hô linh hoạt và tự nhiên: Khi dẫn chuyện (narrator) thì dùng ngôi thứ nhất ("Tôi" hoặc "Mình"). Tuy nhiên, trong các câu thoại, tương tác, hoặc khi nhắc đến nhân vật khác, PHẢI dùng các đại từ xưng hô tiếng Việt tự nhiên và đúng ngữ cảnh giới tính/độ tuổi/mối quan hệ của câu chuyện gốc (ví dụ: "anh" - "em", "vợ" - "chồng", "tao" - "mày"). Tuyệt đối không lạm dụng "Tôi" hay "Mình" máy móc trong các câu thoại trực tiếp hoặc gián tiếp dẫn đến hiểu sai nghĩa câu chuyện gốc (ví dụ: Boyfriend hỏi Girlfriend "Em có nghĩ anh béo không?" chứ không được viết là "Em có nghĩ mình béo không?").
- Dùng dấu ba chấm "..." để tạo các nhịp dừng tự nhiên và tăng độ tò mò.
- Câu nói tự nhiên như văn nói, KHÔNG viết như báo chí hay báo cáo.
- Tránh các từ sáo rỗng/robot: "bàng hoàng", "kinh hoàng", "gây sốc", "tóm lại", "tóm tắt".
- Kịch bản được phân rã thành các scene/segment ngắn có nhịp độ dồn dập (pacing).
- Mỗi segment có "text" khoảng 15-40 từ để giữ nhịp ngắn, dễ đọc và tạo phụ đề snappy.

COMMENT RULES (ONLY if community comments are provided above):
- KHÔNG tạo phân đoạn dẫn nhập bình luận (\`comment_intro\` / \`transition\`). Bỏ hoàn toàn loại segment này.
- Kịch bản cốt truyện chính phải được kể HOÀN TOÀN LIÊN TỤC từ đầu đến cuối (Hook -> các segment Story liên tục).
- TUYỆT ĐỐI KHÔNG xen kẽ bình luận (Comment) vào giữa các phân đoạn câu chuyện chính.
- Toàn bộ các bình luận (Comment) phải được xếp LIÊN TIẾP và đặt ở phần CUỐI của kịch bản (ngay sau phân đoạn cốt truyện chính cuối cùng và ngay trước phân đoạn Ending).
- Dịch các comment tự nhiên sang tiếng Việt, có thể lược bớt để ngắn gọn nhưng GIỮ NGUYÊN cảm xúc thô mộc, chân thực của internet (ví dụ phản ứng giận dữ, bênh vực, khuyên nhủ). KHÔNG viết tóm tắt robot.
- Xưng hô trong comment phải tự nhiên và phù hợp với giới tính/vai vế của người viết/người đọc (ví dụ: dùng "chủ thớt", "bạn", "OP" hoặc gọi thân mật "em", "chị", "chủ post", "ông này", "bà này" tùy ngữ cảnh câu chuyện).

OUTPUT STRUCTURE:
Bạn PHẢI trả về duy nhất một đối tượng JSON khớp chính xác với cấu trúc dưới đây.
Cấu trúc thứ tự BẮT BUỘC: Hook -> Story_1 -> Story_2 -> ... -> Ending -> Comment_1 -> Comment_2 
KHÔNG thêm bất kỳ văn bản giải thích nào ngoài JSON. KHÔNG kèm theo lời giới thiệu hay ghi chú.

\`\`\`json
{
  "segments": [
    {
      "id": "hook",
      "type": "hook",
      "text": "Tôi thật sự chết lặng khi phát hiện ra bí mật mà chồng tôi giấu kín suốt 5 năm qua..."
    },
    {
      "id": "story_1",
      "type": "story",
      "text": "Mọi chuyện bắt đầu từ lúc..."
    },
    {
      "id": "story_2",
      "type": "story",
      "text": "Anh ấy nói rằng mọi chuyện chỉ là hiểu lầm..."
    },
    {
      "id": "ending",
      "type": "ending",
      "text": "Có lẽ tôi chưa từng thật sự biết anh ấy là ai..."
    },
    {
      "id": "comment_1",
      "type": "comment",
      "text": "Anh ấy đang thao túng tâm lý bạn đấy, chạy ngay đi!"
    },
    {
      "id": "comment_2",
      "type": "comment",
      "text": "Thương chủ thớt quá, mong bạn sớm vượt qua giai đoạn khó khăn này..."
    },
  ]
}
\`\`\`

Các giá trị hợp lệ cho trường "type": 'hook' | 'story' | 'comment' | 'ending' | 'question' | 'reveal'`;

  const systemPrompt = `${promptConfig.systemPrompt}\nYou are a strict Vietnamese JSON producer. Output ONLY a valid JSON matching the schema, with NO markdown formatting other than raw JSON block, NO descriptions, and NO conversational text.`;

  logger.info(`[Segment Generator] Sending segment request to LLM for story: ${story.id}...`);

  let attempts = 0;
  const MAX_RETRIES = 3;
  while (attempts < MAX_RETRIES) {
    try {
      const rawResponse = await callLLM(prompt, systemPrompt, 0.75, 1);

      if (!rawResponse) {
        logger.warn(`[Segment Generator] Empty response received from LLM. Attempt ${attempts + 1}/${MAX_RETRIES}`);
        attempts++;
        continue;
      }

      const parsed = parseLLMJSON(rawResponse);
      if (parsed && parsed.segments && parsed.segments.length > 0) {
        // Validate each segment
        let allValid = true;
        for (const segment of parsed.segments) {
          if (!validateSegment(segment)) {
            allValid = false;
            break;
          }
        }

        if (allValid) {
          logger.info(`[Segment Generator] Successfully generated ${parsed.segments.length} valid segments for story: ${story.id}`);
          return parsed.segments;
        } else {
          logger.warn(`[Segment Generator] Generated segments failed validation. Retrying...`);
        }
      } else {
        logger.warn(`[Segment Generator] Failed to parse segments from raw output: \n${rawResponse}`);
      }

    } catch (err: any) {
      logger.error(`[Segment Generator] Attempt ${attempts + 1} failed:`, err.message);
    }

    attempts++;
    // Wait slightly before retry
    await new Promise(res => setTimeout(res, 2000));
  }

  logger.error(`[Segment Generator] Failed to generate valid segments for story: ${story.id} after ${MAX_RETRIES} attempts.`);
  return null;
};
