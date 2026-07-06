import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { dataDir } from './db/database.js';
import { migrateDatabase } from './db/schema.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createBillingRouter } from './modules/billing/billing.routes.js';
import { createChatRouter } from './modules/chat/chat.routes.js';
import { createContentRouter } from './modules/content/content.routes.js';
import { createModelConfigRouter } from './modules/model-configs/model-config.routes.js';
import { createRouteResourceRouter } from './modules/route-resources/route-resource.routes.js';
import { createRoleRouter } from './modules/roles/role.routes.js';
import { createSkillRouter } from './modules/skills/skill.routes.js';
import { createUserRouter } from './modules/users/user.routes.js';
import { createVideoRemakeRouter } from './modules/video-remake/video-remake.routes.js';
import { createXingtuSearchDraftRouter } from './modules/xingtu-search-drafts/xingtu-search-draft.routes.js';
import { requireAuth } from './shared/auth.middleware.js';

export function createApp() {
  migrateDatabase();

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '20mb' }));
  app.use('/files/skills', express.static(path.join(dataDir, 'skill-files')));
  app.use('/files', express.static(path.join(dataDir, 'files')));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'ai-marketing-desktop-server' });
  });

  app.use(requireAuth);

  app.use('/api/auth', createAuthRouter());
  app.use('/api/users', createUserRouter());
  app.use('/api/roles', createRoleRouter());
  app.use('/api/route-resources', createRouteResourceRouter());
  app.use('/api/chat', createChatRouter());
  app.use('/api/content', createContentRouter());
  app.use('/api/video-remake', createVideoRemakeRouter());
  app.use('/api/skills', createSkillRouter());
  app.use('/api/xingtu/search-drafts', createXingtuSearchDraftRouter());
  app.use('/api/billing', createBillingRouter());
  app.use('/api', createModelConfigRouter());

  return app;
}
