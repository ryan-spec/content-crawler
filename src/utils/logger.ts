import fs from 'fs-extra';
import path from 'path';
import { config } from '../config/config';

// Ensure log directory exists
fs.ensureDirSync(config.folders.logs);

const logFile = path.join(config.folders.logs, 'app.log');
const errorFile = path.join(config.folders.logs, 'error.log');

export const logger = {
  info: (message: string, meta?: any) => {
    const logStr = `[INFO] ${new Date().toISOString()} - ${message} ${meta ? JSON.stringify(meta) : ''}`;
    console.log(logStr);
    fs.appendFileSync(logFile, logStr + '\n');
  },
  error: (message: string, error?: any) => {
    const errorMsg = error instanceof Error ? error.stack : JSON.stringify(error);
    const logStr = `[ERROR] ${new Date().toISOString()} - ${message} ${errorMsg ? errorMsg : ''}`;
    console.error(logStr);
    fs.appendFileSync(errorFile, logStr + '\n');
    fs.appendFileSync(logFile, logStr + '\n');
  },
  warn: (message: string, meta?: any) => {
    const logStr = `[WARN] ${new Date().toISOString()} - ${message} ${meta ? JSON.stringify(meta) : ''}`;
    console.warn(logStr);
    fs.appendFileSync(logFile, logStr + '\n');
  }
};
