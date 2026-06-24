import { Router, type Request } from 'express';
import { requirePermission } from '../../shared/auth.middleware.js';
import { sendError } from '../../shared/http.js';
import { skillRepository } from './skill.repository.js';
import { createSkillFromContent, deleteSkillFile, normalizeSkillCommand } from './skill.service.js';

function parseBoolean(value: unknown, fallback: boolean) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function getCurrentUserId(req: Request) {
  return req.auth?.userId || req.auth?.user?.id || '';
}

export function createSkillRouter() {
  const router = Router();

  router.use(requirePermission('web.module.chat'));

  router.get('/', (req, res) => {
    const userId = getCurrentUserId(req);
    res.json(skillRepository.list(userId));
  });

  router.post('/upload', async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const fileName = String(req.body.fileName || '').trim();
      const content = String(req.body.content || '');

      if (!fileName) {
        sendError(res, 400, '缺少技能文件名');
        return;
      }

      const skill = await createSkillFromContent({ content, fileName, userId });
      res.status(201).json(skill);
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '技能上传失败');
    }
  });

  router.put('/:id', (req, res) => {
    const userId = getCurrentUserId(req);
    const skill = skillRepository.find(req.params.id);
    const name = String(req.body.name || '').trim();
    const command = String(req.body.command || '').trim();
    const category = String(req.body.category ?? skill?.category ?? 'brand_style').trim() || 'brand_style';
    const scenario = String(req.body.scenario ?? skill?.scenario ?? '').trim();

    if (!skill) {
      sendError(res, 404, '技能不存在');
      return;
    }

    if (skill.userId !== userId) {
      sendError(res, 403, '无权修改该技能');
      return;
    }

    if (!name) {
      sendError(res, 400, '技能名称不能为空');
      return;
    }

    if (!command) {
      sendError(res, 400, '技能调用名不能为空');
      return;
    }

    const normalizedCommand = normalizeSkillCommand(command, '');
    if (!normalizedCommand) {
      sendError(res, 400, '技能调用名仅支持英文、数字和连接符');
      return;
    }

    const updated = skillRepository.updateProfile({
      category: category.slice(0, 80),
      command: normalizedCommand,
      enabled: parseBoolean(req.body.enabled, skill.enabled),
      id: skill.id,
      isDefault: parseBoolean(req.body.isDefault, skill.isDefault),
      name: name.slice(0, 80),
      scenario: scenario.slice(0, 160),
      updatedAt: new Date().toISOString(),
    });

    res.json(updated);
  });

  router.delete('/:id', async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const skill = skillRepository.find(req.params.id);
      if (!skill) {
        sendError(res, 404, '技能不存在');
        return;
      }

      if (skill.userId !== userId) {
        sendError(res, 403, '无权删除该技能');
        return;
      }

      await deleteSkillFile(skill);
      res.status(204).end();
    } catch (error) {
      sendError(res, 400, error instanceof Error ? error.message : '技能删除失败');
    }
  });

  return router;
}
