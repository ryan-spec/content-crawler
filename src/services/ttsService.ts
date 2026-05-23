import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { FPTTTSResponse, FPTPollResponse } from '../types/fpt';
import { SegmentType } from '../types';

const FPT_API_URL = 'https://api.fpt.ai/hmi/tts/v5';

// Sleep utility
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

let lastCommentVoiceIndex = -1;
const COMMENT_VOICES = ['leminh', 'thuminh', 'giahuy', 'linhsan'];

/**
 * Returns the best voice and speed configuration for a given segment type.
 * Automatically switches voice based on default voice in config to create male/female contrast!
 */
export const getVoiceConfigForSegmentType = (type: SegmentType): { voice: string; speed: string } => {
  const defaultVoice = config.fpt.voice || 'banmai';
  const baseSpeedNum = parseInt(config.fpt.speed || '0', 10);
  const storySpeed = isNaN(baseSpeedNum) ? '1' : (baseSpeedNum + 1).toString();
  const commentSpeed = isNaN(baseSpeedNum) ? '2' : (baseSpeedNum + 2).toString();

  switch (type) {
    case 'hook':
    case 'reveal':
      return { voice: defaultVoice, speed: storySpeed }; // Energetic opening
    case 'story':
      return { voice: defaultVoice, speed: storySpeed }; // Standard storytelling
    case 'transition':
      return { voice: defaultVoice, speed: storySpeed };
    case 'comment':
      let nextIndex;
      do {
        nextIndex = Math.floor(Math.random() * COMMENT_VOICES.length);
      } while (nextIndex === lastCommentVoiceIndex && COMMENT_VOICES.length > 1);
      lastCommentVoiceIndex = nextIndex;
      return { voice: COMMENT_VOICES[nextIndex], speed: commentSpeed }; // Commenters get rotating voices and faster speed
    case 'ending':
    case 'question':
      return { voice: defaultVoice, speed: '-1' }; // Slower speed for emotional ending pacing
    default:
      return { voice: defaultVoice, speed: storySpeed };
  }
};

/**
 * Generates an audio file from text using FPT AI TTS.
 * Supports custom voice and speed specifications.
 */
export const generateAudio = async (
  text: string,
  outputPath: string,
  voice?: string,
  speed?: string
): Promise<boolean> => {
  if (!config.fpt.apiKey) {
    logger.error('No FPT API Key provided.');
    return false;
  }

  const selectedVoice = voice || config.fpt.voice || 'banmai';
  const selectedSpeed = speed || config.fpt.speed || '0';

  try {
    logger.info(`Sending TTS request for text: "${text.substring(0, 40)}..." [Voice: ${selectedVoice}, Speed: ${selectedSpeed}]`);
    
    // 1. Send text to FPT API
    const response = await axios.post<FPTTTSResponse>(
      FPT_API_URL,
      text,
      {
        headers: {
          'api-key': config.fpt.apiKey,
          'speed': selectedSpeed,
          'voice': selectedVoice,
          'Content-Type': 'text/plain' // FPT expects raw text
        }
      }
    );

    if (response.data.error !== 0) {
      logger.error(`FPT TTS Error: ${response.data.message}`);
      return false;
    }

    const asyncUrl = response.data.async;
    logger.info(`FPT Audio is generating... Polling URL: ${asyncUrl}`);

    // 2. Poll the URL until it is ready
    let audioUrl = '';
    let retries = 0;
    const maxRetries = 60; // 60 * 3 seconds = 180 seconds max

    while (retries < maxRetries) {
      await delay(3000); // Poll every 3 seconds

      try {
        const pollResponse = await axios.get(asyncUrl, {
          headers: { 'api-key': config.fpt.apiKey },
          validateStatus: (status) => status < 400
        });

        // If the content type is audio, it's ready.
        if (pollResponse.headers['content-type'] === 'audio/mpeg') {
          audioUrl = asyncUrl;
          break;
        }

        const pollData = pollResponse.data as FPTPollResponse;
        if (pollData && pollData.error === 0 && pollData.message.startsWith('http')) {
          audioUrl = pollData.message;
          break;
        }
      } catch (pollErr: any) {
        if (pollErr.response?.headers?.['content-type'] === 'audio/mpeg') {
           audioUrl = asyncUrl;
           break;
        }
        logger.warn(`Polling attempt ${retries + 1} failed. Retrying...`);
      }
      
      retries++;
    }

    if (!audioUrl) {
      logger.error(`Timeout waiting for FPT TTS audio.`);
      return false;
    }

    // 3. Download the MP3
    logger.info(`Downloading audio from ${audioUrl} into ${outputPath}`);
    const downloadResponse = await axios.get(audioUrl, {
      responseType: 'arraybuffer'
    });

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, downloadResponse.data);
    logger.info(`Audio saved successfully to ${outputPath}`);

    return true;

  } catch (error: any) {
    logger.error(`Error generating audio:`, error.response?.data || error.message);
    return false;
  }
};
