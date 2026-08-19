import { logToFile } from '../../../shared/logger.js';

export const videoGenerationLogFile = 'vedio-generation.log';

export function logVideoGenerationFlow(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) {
  logToFile(videoGenerationLogFile, level, message, context);
}
