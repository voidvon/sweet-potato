import { createServer } from 'node:http';
import { createApp } from './app.js';
import { batchGenerationRunService } from './modules/batch-generation/batch-generation-run.service.js';
import { env, volcengineRealPersonConfig, contentPublicBaseUrl } from './config/env.js';
import { attachChatWebSocketServer } from './modules/chat/chat-stream.service.js';
import { contentService } from './modules/content/content.service.js';
import { contentPlanningService } from './modules/content-planning/content-planning.service.js';
import { recoverInterruptedImageGenerations } from './modules/generation/generation-recovery.service.js';
import { logger } from './shared/logger.js';
import { siteAccessLogService } from './modules/site-access-logs/site-access-log.service.js';

const app = createApp();
const server = createServer(app);

attachChatWebSocketServer(server);
recoverInterruptedImageGenerations();

server.listen(env.port, () => {
  console.log(`AI marketing desktop server listening on http://localhost:${env.port}`);
  // console.log('-----------volcengineRealPersonConfig:', volcengineRealPersonConfig);
  // console.log('-----------contentPublicBaseUrl:', contentPublicBaseUrl);
  logger.info('server started', { port: env.port });
  batchGenerationRunService.resumeInterruptedRuns();
  contentService.resumeRunningVideoGenerations();
  contentPlanningService.resumeInterruptedGenerationsOnStartup();
  contentService.resumePendingGeneratedVideoMirrors();
  contentService.startVirtualPortraitMirrorSyncScheduler();
  contentService.startTemporaryAssetCleanupScheduler();
  siteAccessLogService.startCleanupScheduler();
});
