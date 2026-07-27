import { Router } from 'express';
import { getErrorMessage, sendError } from '../../shared/http.js';
import { requirePermission } from '../../shared/auth.middleware.js';
import { listAudioModelProviders } from '../audio-models/audio-model.registry.js';
import { listImageModelProviders } from '../image-models/image-model.registry.js';
import { listVideoModelProviders } from '../video-models/video-model.registry.js';
import { defaultModelConfig } from './model-config.defaults.js';
import { llmModelPricingRepository } from './llm-model-pricing.repository.js';
import {
  assertLlmModelPricing,
  listLlmModelPricing,
  normalizeLlmModelPricing,
} from './llm-model-pricing.service.js';
import { modelConfigRepository } from './model-config.repository.js';
import {
  isModelType,
  normalizeModelConfig,
  persistModelConfig,
  serializeModelConfig,
} from './model-config.service.js';

export function createModelConfigRouter() {
  const router = Router();

  router.use(requirePermission('admin.route.system.models.view'));

  router.get('/ai-model-config', (_req, res) => {
    const configs = modelConfigRepository.list('llm').map(serializeModelConfig);
    res.json(configs.find((item) => item.isDefault) || configs[0] || defaultModelConfig);
  });

  router.put('/ai-model-config', (req, res) => {
    try {
      const existing = modelConfigRepository.list('llm').find((item) => Boolean(item.isDefault));
      const config = normalizeModelConfig(
        {
          ...req.body,
          type: 'llm',
          name: req.body.name || existing?.name || '默认 LLM 模型',
          isDefault: true,
        },
        existing,
      );
      persistModelConfig(config, existing ? 'update' : 'insert');
      res.json(serializeModelConfig(config));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '模型配置保存失败'));
    }
  });

  router.get('/model-configs', (req, res) => {
    const type = req.query.type ? String(req.query.type) : undefined;

    if (type && !isModelType(type)) {
      sendError(res, 400, '模型类型不支持');
      return;
    }

    const modelType = type && isModelType(type) ? type : undefined;
    res.json(modelConfigRepository.list(modelType).map(serializeModelConfig));
  });

  router.get('/model-configs/audio-providers', (_req, res) => {
    res.json(listAudioModelProviders());
  });

  router.get('/model-configs/image-providers', (_req, res) => {
    res.json(listImageModelProviders());
  });

  router.get('/model-configs/video-providers', (_req, res) => {
    res.json(listVideoModelProviders());
  });

  router.get('/model-configs/llm-model-pricing', (_req, res) => {
    res.json(listLlmModelPricing());
  });

  router.post('/model-configs/llm-model-pricing', (req, res) => {
    try {
      const record = normalizeLlmModelPricing(req.body);
      assertLlmModelPricing(record);
      llmModelPricingRepository.save(record, 'insert');
      res.status(201).json(record);
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, 'LLM 官方价格目录保存失败'));
    }
  });

  router.put('/model-configs/llm-model-pricing/:id', (req, res) => {
    const current = llmModelPricingRepository.findById(req.params.id);
    if (!current) {
      sendError(res, 404, 'LLM 官方价格目录不存在');
      return;
    }

    try {
      const record = normalizeLlmModelPricing({ ...req.body, id: req.params.id }, current);
      assertLlmModelPricing(record);
      llmModelPricingRepository.save(record, 'update');
      res.json(record);
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, 'LLM 官方价格目录保存失败'));
    }
  });

  router.delete('/model-configs/llm-model-pricing/:id', (req, res) => {
    const current = llmModelPricingRepository.findById(req.params.id);
    if (!current) {
      sendError(res, 404, 'LLM 官方价格目录不存在');
      return;
    }

    llmModelPricingRepository.delete(req.params.id);
    res.status(204).send();
  });

  router.post('/model-configs', (req, res) => {
    try {
      const config = normalizeModelConfig(req.body);
      persistModelConfig(config, 'insert');
      res.status(201).json(serializeModelConfig(config));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '模型配置保存失败'));
    }
  });

  router.put('/model-configs/order', (req, res) => {
    const type = String(req.body?.type || '');
    const orderedIds = Array.isArray(req.body?.orderedIds)
      ? req.body.orderedIds.map((id: unknown) => String(id))
      : [];

    if (!isModelType(type)) {
      sendError(res, 400, '模型类型不支持');
      return;
    }

    const currentIds = modelConfigRepository.list(type).map((item) => item.id);
    const uniqueIds = new Set(orderedIds);
    if (
      orderedIds.length !== currentIds.length
      || uniqueIds.size !== orderedIds.length
      || currentIds.some((id) => !uniqueIds.has(id))
    ) {
      sendError(res, 400, '排序列表与当前模型配置不一致，请刷新后重试');
      return;
    }

    modelConfigRepository.reorder(type, orderedIds);
    res.json(modelConfigRepository.list(type).map(serializeModelConfig));
  });

  router.put('/model-configs/:id', (req, res) => {
    const current = modelConfigRepository.find(req.params.id);
    if (!current) {
      sendError(res, 404, '模型配置不存在');
      return;
    }

    try {
      const config = normalizeModelConfig(req.body, current);
      persistModelConfig(config, 'update');
      res.json(serializeModelConfig(config));
    } catch (error) {
      sendError(res, 400, getErrorMessage(error, '模型配置保存失败'));
    }
  });

  router.put('/model-configs/:id/default', (req, res) => {
    const current = modelConfigRepository.find(req.params.id);
    if (!current) {
      sendError(res, 404, '模型配置不存在');
      return;
    }

    const next = { ...current, isDefault: true };
    persistModelConfig(next, 'update');
    res.json(serializeModelConfig(next));
  });

  router.delete('/model-configs/:id', (req, res) => {
    const current = modelConfigRepository.find(req.params.id);
    if (!current) {
      sendError(res, 404, '模型配置不存在');
      return;
    }

    modelConfigRepository.delete(req.params.id);
    res.status(204).send();
  });

  return router;
}
