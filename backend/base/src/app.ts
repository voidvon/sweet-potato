import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { dataDir } from './db/database.js';
import { migrateDatabase } from './db/schema.js';
import { createBatchRequestSettingsRouter } from './modules/batch-request-settings/batch-request-settings.routes.js';
import { batchRequestSettingsMiddleware } from './modules/batch-request-settings/batch-request-settings.middleware.js';
import { createAppEventsRouter } from './modules/app-events/app-events.routes.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createBillingRouter } from './modules/billing/billing.routes.js';
import { createChatRouter } from './modules/chat/chat.routes.js';
import { createContentRouter } from './modules/content/content.routes.js';
import { createContentPlanningRouter } from './modules/content-planning/content-planning.routes.js';
import { createGenerationRouter } from './modules/generation/generation.routes.js';
import { createFileStorageSettingsRouter } from './modules/file-storage-settings/file-storage-settings.routes.js';
import { createFileManagementRouter } from './modules/file-management/file-management.routes.js';
import { createIpBlacklistRouter } from './modules/ip-blacklist/ip-blacklist.routes.js';
import { ipBlacklistMiddleware } from './modules/ip-blacklist/ip-blacklist.middleware.js';
import { createModelConfigRouter } from './modules/model-configs/model-config.routes.js';
import { createRateLimitSettingsRouter } from './modules/rate-limit-settings/rate-limit-settings.routes.js';
import { rateLimitSettingsMiddleware } from './modules/rate-limit-settings/rate-limit-settings.middleware.js';
import { createRouteResourceRouter } from './modules/route-resources/route-resource.routes.js';
import { createRoleRouter } from './modules/roles/role.routes.js';
import { createSiteConfigRouter } from './modules/site-config/site-config.routes.js';
import { createSiteAccessLogRouter } from './modules/site-access-logs/site-access-log.routes.js';
import { siteAccessLogMiddleware } from './modules/site-access-logs/site-access-log.middleware.js';
import { createTalkingVideoRouter } from './modules/talking-video/talking-video.routes.js';
import { createUserRouter } from './modules/users/user.routes.js';
import { createVideoRemakeRouter } from './modules/video-remake/video-remake.routes.js';
import { createVideoSourceRouter } from './modules/video-source/video-source.routes.js';
import { createVideoUnderstandingRouter } from './modules/video-understanding/video-understanding.routes.js';
import { createXingtuSearchDraftRouter } from './modules/xingtu-search-drafts/xingtu-search-draft.routes.js';
import { requireAuth } from './shared/auth.middleware.js';

const filesStaticMaxAgeMs = 30 * 24 * 60 * 60 * 1000;

export function createApp() {
  migrateDatabase();

  const app = express();
  app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
  app.use(ipBlacklistMiddleware);
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '20mb' }));
  app.use(siteAccessLogMiddleware);
  app.use(rateLimitSettingsMiddleware);
  app.use(batchRequestSettingsMiddleware);
  app.use('/files', express.static(path.join(dataDir, 'files'), {
    maxAge: filesStaticMaxAgeMs,
  }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'ai-marketing-desktop-server' });
  });

  app.use(requireAuth);

  app.use('/api/auth', createAuthRouter());
  app.use('/api/app', createAppEventsRouter());
  app.use('/api/users', createUserRouter());
  app.use('/api/roles', createRoleRouter());
  app.use('/api/route-resources', createRouteResourceRouter());
  app.use('/api/chat', createChatRouter());
  app.use('/api/generation', createGenerationRouter());
  app.use('/api/content', createContentRouter());
  app.use('/api/content-planning', createContentPlanningRouter());
  app.use('/api/video-remake', createVideoRemakeRouter());
  app.use('/api/video-source', createVideoSourceRouter());
  app.use('/api/video-understanding', createVideoUnderstandingRouter());
  app.use('/api/xingtu/search-drafts', createXingtuSearchDraftRouter());
  app.use('/api/billing', createBillingRouter());
  app.use('/api/site-config', createSiteConfigRouter());
  app.use('/api/access-logs', createSiteAccessLogRouter());
  app.use('/api/system-settings/batch-request', createBatchRequestSettingsRouter());
  app.use('/api/system-settings/file-storage', createFileStorageSettingsRouter());
  app.use('/api/file-management', createFileManagementRouter());
  app.use('/api/system-settings/rate-limits', createRateLimitSettingsRouter());
  app.use('/api/system-settings/ip-blacklist', createIpBlacklistRouter());
  app.use('/api/talking-video', createTalkingVideoRouter());
  app.use('/api', createModelConfigRouter());

  return app;
}
