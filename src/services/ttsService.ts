import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { FPTTTSResponse, FPTPollResponse } from '../types/fpt';

const FPT_API_URL = 'https://api.fpt.ai/hmi/tts/v5';

// Sleep utility
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export const generateAudio = async (text: string, id: string): Promise<boolean> => {
  if (!config.fpt.apiKey) {
    logger.error('No FPT API Key provided.');
    return false;
  }

  try {
    // 1. Send text to FPT API
    logger.info(`Sending text to FPT TTS for ID: ${id}`);
    const response = await axios.post<FPTTTSResponse>(
      FPT_API_URL,
      text,
      {
        headers: {
          'api-key': config.fpt.apiKey,
          'speed': config.fpt.speed,
          'voice': config.fpt.voice,
          'Content-Type': 'text/plain' // FPT expects raw text
        }
      }
    );

    if (response.data.error !== 0) {
      logger.error(`FPT TTS Error: ${response.data.message}`);
      return false;
    }

    const asyncUrl = response.data.async;
    logger.info(`Audio is generating. Polling URL: ${asyncUrl}`);

    // 2. Poll the URL until it is ready
    let audioUrl = '';
    let retries = 0;
    const maxRetries = 20; // 20 * 3 seconds = 60 seconds max

    while (retries < maxRetries) {
      await delay(3000); // Poll every 3 seconds

      // FPT simply returns the original URL but as a redirect to MP3 or returns JSON if not ready yet
      // Sometimes it returns a 200 OK with JSON until ready.
      // Another way is to check the header or content type.
      
      try {
        const pollResponse = await axios.get(asyncUrl, {
          headers: { 'api-key': config.fpt.apiKey },
          validateStatus: (status) => status < 400 // Accept 200 and 300 level redirects
        });

        // If the content type is audio, it's ready. If it's JSON, it might still be processing.
        if (pollResponse.headers['content-type'] === 'audio/mpeg') {
          // Download it directly
          audioUrl = asyncUrl;
          break;
        }

        const pollData = pollResponse.data as FPTPollResponse;
        if (pollData && pollData.error === 0 && pollData.message.startsWith('http')) {
          audioUrl = pollData.message; // FPT sometimes provides the URL in the message field
          break;
        }
      } catch (pollErr: any) {
        // If FPT throws an error during polling (or redirects and we follow), handle appropriately
        if (pollErr.response?.headers?.['content-type'] === 'audio/mpeg') {
           audioUrl = asyncUrl;
           break;
        }
        logger.warn(`Polling attempt ${retries + 1} failed. Retrying...`);
      }
      
      retries++;
    }

    if (!audioUrl) {
      logger.error(`Timeout waiting for FPT TTS audio for ID: ${id}`);
      return false;
    }

    // 3. Download the MP3
    logger.info(`Downloading audio from ${audioUrl}`);
    const audioPath = path.join(config.folders.audio, `${id}.mp3`);
    
    const downloadResponse = await axios.get(audioUrl, {
      responseType: 'arraybuffer'
    });

    await fs.writeFile(audioPath, downloadResponse.data);
    logger.info(`Audio saved to ${audioPath}`);

    return true;

  } catch (error: any) {
    logger.error(`Error generating audio for ID: ${id}`, error.response?.data || error.message);
    return false;
  }
};
