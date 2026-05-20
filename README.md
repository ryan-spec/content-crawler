# YouTube Shorts Automation

A Node.js automation pipeline for generating YouTube Shorts narrations from online stories. Currently implemented with a Reddit crawler, but designed for extensibility.

## Features
- Periodically crawls top stories from defined subreddits.
- Filters out NSFW, deleted/empty posts, and checks for length & score.
- Prevents duplicate processing.
- Rewrites stories using OpenAI into dramatic, cinematic scripts.
- Converts the rewritten script into Vietnamese speech using FPT AI TTS.
- Saves raw data, rewritten scripts, and audio to the local file system.

## Setup Instructions

1. Clone or copy the project.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your keys:
   ```bash
   cp .env.example .env
   ```
   Provide:
   - `OPENAI_API_KEY`: Your OpenAI API Key.
   - `FPT_API_KEY`: Your FPT AI API Key.
   - Configure `CRON_SCHEDULE`, `FPT_VOICE`, etc., if needed.

4. Run the project in development mode:
   ```bash
   npm run dev
   ```

5. Build for production:
   ```bash
   npm run build
   npm start
   ```

## Folder Structure
- `/data`: Output folder where all raw JSON, rewritten text, and generated audio are stored.
- `/logs`: Log files.
- `/src`: All source code (Clean Architecture: config, types, utils, services, jobs).
