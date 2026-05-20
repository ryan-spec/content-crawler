export interface FPTTTSResponse {
  error: number;
  message: string;
  async: string;
}

export interface FPTPollResponse {
  error: number;
  message: string;
  async?: string; // FPT TTS result link will be here when ready, usually message will change to the URL.
}
