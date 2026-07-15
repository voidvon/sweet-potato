import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createContentPlanningAgentProvider,
  DeterministicContentPlanningAgentProvider,
  extractPartialJsonStringField,
  normalizePlanningTimelineSegments,
  projectPlanningAuditStream,
  type PlanningRuntimeContext,
} from '../src/modules/content-planning/content-planning-agent-runtime.js';
import {
  createContentPlanningAnalysisProvider,
  DeterministicContentPlanningAnalysisProvider,
  normalizeContentPlanningTimeRange,
} from '../src/modules/content-planning/content-planning-analysis-runtime.js';
import { contentPlanningBillingConfig } from '../src/config/env.js';
import { contentRepository } from '../src/modules/content/content.repository.js';
import { contentPlanningRepository } from '../src/modules/content-planning/content-planning.repository.js';
import { ContentPlanningService } from '../src/modules/content-planning/content-planning.service.js';
import type {
  ContentPlanningAnalysisBilling,
  ContentPlanningGenerationBilling,
} from '../src/modules/content-planning/content-planning.service.js';
import type { CreditReservation } from '../src/modules/billing/billing.types.js';

const noOpAnalysisBilling: ContentPlanningAnalysisBilling = {
  reserve: () => null,
  complete: () => undefined,
  fail: () => undefined,
};

const noOpGenerationBilling: ContentPlanningGenerationBilling = {
  reserve: () => null,
  recover: () => null,
  complete: () => undefined,
  fail: () => undefined,
};

class RecordingAnalysisBilling implements ContentPlanningAnalysisBilling {
  reserveCalls = 0;
  completeCalls = 0;
  failCalls = 0;

  reserve(input: Parameters<ContentPlanningAnalysisBilling['reserve']>[0]) {
    this.reserveCalls += 1;
    return {
      id: `reservation-${input.sessionId}`,
      userId: input.userId,
      sourceType: 'content_planning_analysis',
      sourceId: `${input.sessionId}:analysis:test`,
      reservedCredits: 2,
      status: 'reserved',
      snapshot: { imageCount: input.imageCount, hasReferenceVideo: input.hasReferenceVideo },
      createdAt: new Date().toISOString(),
      settledAt: null,
    } satisfies CreditReservation;
  }

  complete() {
    this.completeCalls += 1;
  }

  fail() {
    this.failCalls += 1;
  }
}

class RecordingGenerationBilling implements ContentPlanningGenerationBilling {
  reserveCalls = 0;
  recoverCalls = 0;
  completeCalls = 0;
  failCalls = 0;

  reserve(input: Parameters<ContentPlanningGenerationBilling['reserve']>[0]) {
    this.reserveCalls += 1;
    return {
      id: `generation-reservation-${input.sessionId}`,
      userId: input.userId,
      sourceType: 'content_planning_generation',
      sourceId: `${input.sessionId}:generation:test`,
      reservedCredits: 3,
      status: 'reserved',
      snapshot: { candidateCount: input.candidateCount, deepThink: input.deepThink },
      createdAt: new Date().toISOString(),
      settledAt: null,
    } satisfies CreditReservation;
  }

  recover() {
    this.recoverCalls += 1;
    return null;
  }

  complete() {
    this.completeCalls += 1;
  }

  fail() {
    this.failCalls += 1;
  }
}

const contentPlanningService = new ContentPlanningService(
  new DeterministicContentPlanningAgentProvider(),
  new DeterministicContentPlanningAnalysisProvider(),
  noOpAnalysisBilling,
  noOpGenerationBilling,
);

test('production planning provider is not the deterministic test provider', () => {
  assert.equal(createContentPlanningAgentProvider() instanceof DeterministicContentPlanningAgentProvider, false);
  assert.equal(createContentPlanningAnalysisProvider() instanceof DeterministicContentPlanningAnalysisProvider, false);
});

test('planning client config exposes the configured fixed charges', () => {
  assert.deepEqual(contentPlanningService.getClientConfig(), {
    analysisCredits: contentPlanningBillingConfig.analysisCredits,
    generationCredits: contentPlanningBillingConfig.generationCredits,
  });
});

test('reference breakdown time ranges are normalized to seconds', () => {
  assert.equal(normalizeContentPlanningTimeRange('00:00-00:02'), '0-2秒');
  assert.equal(normalizeContentPlanningTimeRange('00：02-00：03.5'), '2-3.5秒');
  assert.equal(normalizeContentPlanningTimeRange('0-2s'), '0-2秒');
  assert.equal(normalizeContentPlanningTimeRange('00:01:02-00:01:05'), '62-65秒');
});

test('planning timelines correct a small final duration drift to the configured target', () => {
  const source = [
    { startSecond: 0, endSecond: 2, beat: 'hook', goal: 'attention' },
    { startSecond: 2, endSecond: 5, beat: 'proof', goal: 'benefit' },
    { startSecond: 5, endSecond: 9, beat: 'close', goal: 'conversion' },
  ];
  const normalized = normalizePlanningTimelineSegments(source, 10);

  assert.deepEqual(normalized.map(({ startSecond, endSecond }) => ({ startSecond, endSecond })), [
    { startSecond: 0, endSecond: 2 },
    { startSecond: 2, endSecond: 5 },
    { startSecond: 5, endSecond: 10 },
  ]);
  assert.equal(source[2]?.endSecond, 9);

  const halfSecondShort = normalizePlanningTimelineSegments([
    { startSecond: 0, endSecond: 1.5 },
    { startSecond: 1.5, endSecond: 9.5 },
  ], 10);
  assert.equal(halfSecondShort[1]?.endSecond, 10);

  const floatingPointDrift = normalizePlanningTimelineSegments([
    { startSecond: 0, endSecond: 2 },
    { startSecond: 2.0004, endSecond: 10.0004 },
  ], 10);
  assert.deepEqual(floatingPointDrift.map(({ startSecond, endSecond }) => ({ startSecond, endSecond })), [
    { startSecond: 0, endSecond: 2 },
    { startSecond: 2, endSecond: 10 },
  ]);
});

test('planning timelines reject large duration mismatches and discontinuities', () => {
  assert.throws(
    () => normalizePlanningTimelineSegments([
      { startSecond: 0, endSecond: 2 },
      { startSecond: 2, endSecond: 7 },
    ], 10),
    /总时长不是 10 秒/u,
  );
  assert.throws(
    () => normalizePlanningTimelineSegments([
      { startSecond: 0, endSecond: 2 },
      { startSecond: 2.5, endSecond: 10 },
    ], 10),
    /不连续或无效/u,
  );
});

test('partial audit text extraction decodes streamed JSON string content', () => {
  assert.equal(
    extractPartialJsonStringField('```json\n{"auditText":"先检查\\n商品特征', 'auditText'),
    '先检查\n商品特征',
  );
  assert.equal(
    extractPartialJsonStringField('{"auditText":"校验\\u65f6\\u957f","result":', 'auditText'),
    '校验时长',
  );
  assert.equal(extractPartialJsonStringField('{"summary":"none"}', 'auditText'), '');
});

test('planning audit projection keeps streaming structured stage fields after audit text', () => {
  const auditOnly = projectPlanningAuditStream('{"auditText":"先检查商品与时长","summary":"先突出锁骨');
  assert.match(auditOnly, /先检查商品与时长/u);
  assert.match(auditOnly, /阶段结果生成中：/u);
  assert.match(auditOnly, /摘要：先突出锁骨/u);

  const withConstraints = projectPlanningAuditStream([
    '{"auditText":"先检查商品与时长",',
    '"summary":"先突出锁骨线条",',
    `"hardConstraints":["总时长10秒","保持商品颜色稳定`,
  ].join(''));
  assert.ok(withConstraints.startsWith(auditOnly));
  assert.match(withConstraints, /硬性约束：总时长10秒/u);
  assert.match(withConstraints, /硬性约束：保持商品颜色稳定/u);
});

class StreamingDeterministicPlanningProvider extends DeterministicContentPlanningAgentProvider {
  override async planner(context: PlanningRuntimeContext) {
    context.onAuditDelta?.('正在检查商品素材');
    await new Promise((resolve) => setTimeout(resolve, 120));
    context.onAuditDelta?.('、时长与生成约束');
    await new Promise((resolve) => setTimeout(resolve, 120));
    return super.planner(context);
  }
}

class CountingDeterministicPlanningProvider extends DeterministicContentPlanningAgentProvider {
  plannerCalls = 0;

  override async planner(context: PlanningRuntimeContext) {
    this.plannerCalls += 1;
    return super.planner(context);
  }
}

async function waitFor<T>(read: () => T, predicate: (value: T) => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let value = read();
  while (!predicate(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = read();
  }
  assert.ok(predicate(value), 'timed out waiting for planning state');
  return value;
}

function createTestSession(userId: string, service: ContentPlanningService = contentPlanningService) {
  const session = service.createSession({
    userId,
    prompt: 'Create a concise product video',
    productName: 'Test product',
  });
  assert.ok(session);
  return session;
}

function createProductImageAsset(userId: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const group = contentRepository.createGroup({
    userId,
    resourceType: 'product',
    name: `planning-product-${suffix}`,
    description: '',
    metadata: { source: 'content-planning-test' },
  });
  assert.ok(group);
  const asset = contentRepository.createAsset({
    userId,
    groupId: group.id,
    resourceType: 'product',
    name: 'Test product image',
    description: '',
    originalFileName: 'product.jpg',
    storedFileName: `product-${suffix}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 4,
    filePath: `/tmp/product-${suffix}.jpg`,
    fileUrl: `/files/product-${suffix}.jpg`,
    metadata: { source: 'content-planning-test' },
  });
  assert.ok(asset);
  return asset.id;
}

function createReferenceVideoAsset(userId: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const group = contentRepository.createGroup({
    userId,
    resourceType: 'scene',
    name: `planning-video-${suffix}`,
    description: '',
    metadata: { source: 'content-planning-test' },
  });
  assert.ok(group);
  const asset = contentRepository.createAsset({
    userId,
    groupId: group.id,
    resourceType: 'scene',
    name: 'Test reference video',
    description: '',
    originalFileName: 'reference.mp4',
    storedFileName: `reference-${suffix}.mp4`,
    mimeType: 'video/mp4',
    fileSize: 4,
    filePath: `/tmp/reference-${suffix}.mp4`,
    fileUrl: `/files/reference-${suffix}.mp4`,
    metadata: { source: 'content-planning-test' },
  });
  assert.ok(asset);
  return asset.id;
}

function createReferenceAudioAsset(userId: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const group = contentRepository.createGroup({
    userId,
    resourceType: 'voice',
    name: `planning-audio-${suffix}`,
    description: '',
    metadata: { source: 'content-planning-test' },
  });
  assert.ok(group);
  const asset = contentRepository.createAsset({
    userId,
    groupId: group.id,
    resourceType: 'voice',
    name: 'Test reference audio',
    description: '',
    originalFileName: 'reference.wav',
    storedFileName: `reference-${suffix}.wav`,
    mimeType: 'audio/wav',
    fileSize: 4,
    filePath: `/tmp/reference-${suffix}.wav`,
    fileUrl: `/files/reference-${suffix}.wav`,
    metadata: { source: 'content-planning-test' },
  });
  assert.ok(asset);
  return asset.id;
}

test('planning analysis requires a product image rather than a reference video', () => {
  const userId = `planning-test-${Date.now()}-required-image`;
  const created = createTestSession(userId);
  const videoAssetId = createReferenceVideoAsset(userId);
  assert.throws(
    () => contentPlanningService.analyze({
      userId,
      sessionId: created.id,
      prompt: '',
      productName: '',
      imageAssetIds: [],
      referenceVideoAssetId: videoAssetId,
    }),
    /product image is required/u,
  );
  contentPlanningRepository.deleteSession(created.id);
});

async function advanceSessionToConfiguring(
  userId: string,
  service: ContentPlanningService = contentPlanningService,
  references: { referenceVideoAssetId?: string; referenceAudioAssetId?: string } = {},
) {
  const created = createTestSession(userId, service);
  const imageAssetId = createProductImageAsset(userId);
  const analyzed = service.analyze({
    userId,
    sessionId: created.id,
    prompt: 'Use a display-only product demo',
    productName: 'Test product',
    imageAssetIds: [imageAssetId],
    referenceVideoAssetId: references.referenceVideoAssetId,
    referenceAudioAssetId: references.referenceAudioAssetId,
  });
  await waitFor(
    () => service.getSession(userId, analyzed.id),
    (session) => session.status === 'confirming',
  );
  const confirmed = service.updateConfirmation({
    userId,
    sessionId: created.id,
    materialCaptions: [],
    productInsights: {
      productName: 'Test product',
      productCategory: 'demo',
      productFeatures: ['fast'],
      coreSellingPoints: ['simple'],
      targetAudience: ['buyers'],
      useScenarios: ['daily use'],
    },
    referencePolicy: { useBreakdown: false, lockedContentPreset: null },
  });
  assert.ok(confirmed);
  const configured = service.updateSettings({
    userId,
    sessionId: created.id,
    settings: {
      ...confirmed.settings,
      displayOnly: true,
      deepThink: false,
      durationSeconds: 10,
      candidateCount: 3,
    },
  });
  assert.ok(configured);
  return { created, configured, imageAssetId };
}

async function advanceSessionToReady(
  userId: string,
  service: ContentPlanningService = contentPlanningService,
  references: { referenceVideoAssetId?: string; referenceAudioAssetId?: string } = {},
) {
  const { created, configured, imageAssetId } = await advanceSessionToConfiguring(userId, service, references);
  const generating = service.generate(userId, created.id);
  assert.equal(generating.status, 'generating');
  const ready = await waitFor(
    () => service.getSession(userId, created.id),
    (session) => session.status === 'ready_to_apply',
  );
  return { created, configured, imageAssetId, ready };
}

test('reference audio bypasses planning analysis and is returned when applying', async () => {
  const userId = `planning-test-${Date.now()}-reference-audio`;
  const analysisProvider = new class extends DeterministicContentPlanningAnalysisProvider {
    referenceAnalysisCalls = 0;

    override async analyzeReference() {
      this.referenceAnalysisCalls += 1;
      return super.analyzeReference();
    }
  }();
  const service = new ContentPlanningService(
    new DeterministicContentPlanningAgentProvider(),
    analysisProvider,
    noOpAnalysisBilling,
    noOpGenerationBilling,
  );
  const referenceAudioAssetId = createReferenceAudioAsset(userId);
  const { created, ready } = await advanceSessionToReady(userId, service, { referenceAudioAssetId });

  assert.equal(analysisProvider.referenceAnalysisCalls, 0);
  assert.equal(ready.materialBundle.referenceAudio?.assetId, referenceAudioAssetId);
  const applied = service.apply(userId, created.id);
  assert.equal(applied.allowlist.referenceAudio?.assetId, referenceAudioAssetId);
  assert.equal(applied.session.applySnapshot?.referenceAudio?.assetId, referenceAudioAssetId);

  contentPlanningRepository.deleteSession(created.id);
});

test('reference video is returned when applying a planning result', async () => {
  const userId = `planning-test-${Date.now()}-reference-video-apply`;
  const referenceVideoAssetId = createReferenceVideoAsset(userId);
  const { created, ready } = await advanceSessionToReady(
    userId,
    contentPlanningService,
    { referenceVideoAssetId },
  );

  assert.equal(ready.materialBundle.referenceVideo?.assetId, referenceVideoAssetId);
  const applied = contentPlanningService.apply(userId, created.id);
  assert.equal(applied.allowlist.referenceVideo?.assetId, referenceVideoAssetId);
  assert.equal(applied.session.applySnapshot?.referenceVideo?.assetId, referenceVideoAssetId);

  contentPlanningRepository.deleteSession(created.id);
});

test('planning session analysis is restorable and advances asynchronously', async () => {
  const userId = `planning-test-${Date.now()}-restore`;
  const created = createTestSession(userId);
  assert.equal(created.settings.candidateCount, 1);
  const imageAssetId = createProductImageAsset(userId);
  const restored = contentPlanningService.createSession({ userId, restoreLatest: true });
  assert.equal(restored.id, created.id);
  assert.equal(restored.materialBundle.prompt, 'Create a concise product video');

  const analyzing = contentPlanningService.analyze({
    userId,
    sessionId: created.id,
    prompt: 'Show the main benefit first',
    productName: 'Test product',
    imageAssetIds: [imageAssetId],
  });
  assert.equal(analyzing.status, 'analyzing');
  assert.equal(analyzing.jobStage, 'analyzing_materials');

  const completed = await waitFor(
    () => contentPlanningService.getSession(userId, created.id),
    (session) => session.status === 'confirming',
  );
  assert.equal(completed.uiStep, 'step2');
  assert.equal(completed.materialBundle.prompt, 'Show the main benefit first');
  assert.equal(completed.materialBundle.imageMaterials[0]?.assetId, imageAssetId);
  assert.equal(completed.materialBundle.referenceVideo, null);
  assert.equal(completed.analysis.confirmed, false);

  contentPlanningRepository.deleteSession(created.id);
});

test('planning analysis settles its reserved fixed charge after success', async () => {
  const billing = new RecordingAnalysisBilling();
  const service = new ContentPlanningService(
    new DeterministicContentPlanningAgentProvider(),
    new DeterministicContentPlanningAnalysisProvider(),
    billing,
    noOpGenerationBilling,
  );
  const userId = `planning-test-${Date.now()}-analysis-billing-success`;
  const created = createTestSession(userId, service);
  const imageAssetId = createProductImageAsset(userId);
  service.analyze({
    userId,
    sessionId: created.id,
    productName: 'Test product',
    imageAssetIds: [imageAssetId],
  });

  await waitFor(
    () => service.getSession(userId, created.id),
    (session) => session.status === 'confirming',
  );
  assert.equal(billing.reserveCalls, 1);
  assert.equal(billing.completeCalls, 1);
  assert.equal(billing.failCalls, 0);
  contentPlanningRepository.deleteSession(created.id);
});

test('planning analysis releases its reserved fixed charge after failure', async () => {
  const billing = new RecordingAnalysisBilling();
  const analysisProvider = new class extends DeterministicContentPlanningAnalysisProvider {
    override async analyzeProduct() {
      throw new Error('analysis failed');
    }
  }();
  const service = new ContentPlanningService(
    new DeterministicContentPlanningAgentProvider(),
    analysisProvider,
    billing,
    noOpGenerationBilling,
  );
  const userId = `planning-test-${Date.now()}-analysis-billing-failure`;
  const created = createTestSession(userId, service);
  const imageAssetId = createProductImageAsset(userId);
  service.analyze({
    userId,
    sessionId: created.id,
    productName: 'Test product',
    imageAssetIds: [imageAssetId],
  });

  await waitFor(
    () => service.getSession(userId, created.id),
    (session) => session.status === 'failed',
  );
  assert.equal(billing.reserveCalls, 1);
  assert.equal(billing.completeCalls, 0);
  assert.equal(billing.failCalls, 1);
  contentPlanningRepository.deleteSession(created.id);
});

test('planning generation settles one fixed charge and ignores duplicate starts', async () => {
  const billing = new RecordingGenerationBilling();
  const service = new ContentPlanningService(
    new DeterministicContentPlanningAgentProvider(),
    new DeterministicContentPlanningAnalysisProvider(),
    noOpAnalysisBilling,
    billing,
  );
  const userId = `planning-test-${Date.now()}-generation-billing-success`;
  const { created } = await advanceSessionToConfiguring(userId, service);
  const generating = service.generate(userId, created.id);
  const duplicate = service.generate(userId, created.id);
  assert.equal(generating.status, 'generating');
  assert.equal(duplicate.status, 'generating');

  await waitFor(
    () => service.getSession(userId, created.id),
    (session) => session.status === 'ready_to_apply',
  );
  assert.equal(billing.reserveCalls, 1);
  assert.equal(billing.completeCalls, 1);
  assert.equal(billing.failCalls, 0);
  contentPlanningRepository.deleteSession(created.id);
});

test('planning candidate count is limited to three', () => {
  const userId = `planning-test-${Date.now()}-candidate-limit`;
  const created = createTestSession(userId);
  assert.throws(
    () => contentPlanningService.updateSettings({
      userId,
      sessionId: created.id,
      settings: { ...created.settings, candidateCount: 4 },
    }),
    /integer from 1 to 3/u,
  );
  contentPlanningRepository.deleteSession(created.id);
});

test('fallback agent pipeline produces candidates and an allowlist apply payload without reasoning logs', async () => {
  const userId = `planning-test-${Date.now()}-generate`;
  const { created, ready } = await advanceSessionToReady(userId);
  assert.equal(ready.generation.stages.length, 6);
  assert.ok(ready.generation.stages.every((stage) => stage.status === 'completed'));
  assert.equal(ready.generation.candidates.length, 3);
  assert.equal(ready.generation.reasoningLogs.length, 0);
  assert.ok(ready.generation.candidates[0]?.script.storyboard.length);
  assert.equal(ready.generation.candidates[0]?.script.storyboard[0]?.dialogue, '');

  const selected = ready.generation.candidates[1];
  assert.ok(selected);
  const selectedSession = contentPlanningService.selectCandidate(userId, created.id, selected.id);
  assert.equal(selectedSession?.generation.selectedCandidateId, selected.id);
  const applied = contentPlanningService.apply(userId, created.id);
  assert.equal(applied.session.status, 'applied');
  assert.equal(applied.allowlist.duration, '10s');
  assert.equal(applied.allowlist.prompt, selected.prompt);
  assert.match(applied.allowlist.prompt, /^## /u);
  assert.match(applied.allowlist.prompt, /生成要求：/u);
  assert.match(applied.allowlist.prompt, /逐秒分镜：/u);
  assert.match(applied.allowlist.prompt, /画面：/u);
  assert.match(applied.allowlist.prompt, /景别\/运镜：/u);
  assert.match(applied.allowlist.prompt, /空间关系：/u);
  assert.match(applied.allowlist.prompt, /口播：/u);
  assert.doesNotMatch(applied.allowlist.prompt, /Create a|Use these image references|; camera |; lighting /u);
  assert.deepEqual(Object.keys(applied.allowlist).sort(), ['duration', 'imageMaterials', 'prompt']);
  contentPlanningRepository.deleteSession(created.id);
});

test('apply rebuilds legacy candidate prompts from the structured storyboard', async () => {
  const userId = `planning-test-${Date.now()}-legacy-prompt`;
  const { created, ready } = await advanceSessionToReady(userId);
  const candidate = ready.generation.candidates[0];
  assert.ok(candidate);
  const stalePrompt = 'Create a 10-second vertical product video; camera close-up; lighting soft.';
  const updated = contentPlanningRepository.updateSession(created.id, {
    generation: {
      ...ready.generation,
      candidates: ready.generation.candidates.map((item) => (
        item.id === candidate.id
          ? { ...item, prompt: stalePrompt, script: { ...item.script, prompt: stalePrompt } }
          : item
      )),
    },
  });
  assert.ok(updated);

  const applied = contentPlanningService.apply(userId, created.id, candidate.id);
  assert.match(applied.allowlist.prompt, /^## /u);
  assert.match(applied.allowlist.prompt, /逐秒分镜：/u);
  assert.match(applied.allowlist.prompt, /画面：/u);
  assert.doesNotMatch(applied.allowlist.prompt, /Create a|; camera |; lighting /u);
  contentPlanningRepository.deleteSession(created.id);
});

test('deep-think generation exposes complete auditable stage outputs', async () => {
  const userId = `planning-test-${Date.now()}-deep-think`;
  const { created, configured } = await advanceSessionToConfiguring(userId);
  contentPlanningService.updateSettings({
    userId,
    sessionId: created.id,
    settings: { ...configured.settings, deepThink: true },
  });
  contentPlanningService.generate(userId, created.id);
  const ready = await waitFor(
    () => contentPlanningService.getSession(userId, created.id),
    (session) => session.status === 'ready_to_apply',
  );
  assert.equal(ready.generation.reasoningLogs.length, 6);
  assert.match(ready.generation.reasoningLogs[0]?.content || '', /1\. 分析输入与约束/u);
  assert.match(ready.generation.reasoningLogs[1]?.content || '', /开场钩子：/u);
  assert.match(ready.generation.reasoningLogs[2]?.content || '', /3\. 细化时间轴与节奏/u);
  assert.match(ready.generation.reasoningLogs[4]?.content || '', /画面：/u);
  assert.doesNotMatch(ready.generation.reasoningLogs[4]?.content || '', /素材引用/u);
  assert.doesNotMatch(ready.generation.reasoningLogs.map((log) => log.content).join('\n'), /【|Planner|Timeline|Visual Director/u);
  assert.match(ready.generation.reasoningLogs[5]?.content || '', /评分/u);
  contentPlanningRepository.deleteSession(created.id);
});

test('deep-think generation exposes an in-progress reasoning stream before a stage completes', async () => {
  const service = new ContentPlanningService(
    new StreamingDeterministicPlanningProvider(),
    new DeterministicContentPlanningAnalysisProvider(),
    noOpAnalysisBilling,
    noOpGenerationBilling,
  );
  const userId = `planning-test-${Date.now()}-reasoning-stream`;
  const { created, configured } = await advanceSessionToConfiguring(userId, service);
  service.updateSettings({
    userId,
    sessionId: created.id,
    settings: { ...configured.settings, deepThink: true },
  });
  service.generate(userId, created.id);

  const streaming = await waitFor(
    () => service.getSession(userId, created.id),
    (session) => Boolean(session.generation.reasoningStream?.content.includes('正在检查商品素材')),
  );
  assert.equal(streaming.status, 'generating');
  assert.equal(streaming.generation.stages[0]?.status, 'running');
  assert.equal(streaming.generation.reasoningLogs.length, 0);
  const updates = service.getUpdates(userId, created.id);
  assert.match(updates.reasoningStream?.content || '', /正在检查商品素材/u);

  const ready = await waitFor(
    () => service.getSession(userId, created.id),
    (session) => session.status === 'ready_to_apply',
  );
  assert.equal(ready.generation.reasoningStream, null);
  assert.equal(ready.generation.reasoningLogs.length, 6);
  contentPlanningRepository.deleteSession(created.id);
});

test('interrupted generation resumes after the last persisted completed stage', async () => {
  const provider = new CountingDeterministicPlanningProvider();
  const service = new ContentPlanningService(
    provider,
    new DeterministicContentPlanningAnalysisProvider(),
    noOpAnalysisBilling,
    noOpGenerationBilling,
  );
  const userId = `planning-test-${Date.now()}-resume-generation`;
  const { created, ready } = await advanceSessionToReady(userId, service);
  assert.equal(provider.plannerCalls, 1);
  const plannerOutput = ready.generation.stageOutputs.planner;
  assert.ok(plannerOutput);
  const interrupted = contentPlanningRepository.updateSession(created.id, {
    status: 'generating',
    uiStep: 'step4',
    jobStage: 'strategy_running',
    generation: {
      ...ready.generation,
      stages: ready.generation.stages.map((stage) => ({
        ...stage,
        status: stage.role === 'Planner' ? 'completed' : 'pending',
        ...(stage.role === 'Planner' ? {} : {
          outputSummary: '',
          startedAt: undefined,
          completedAt: undefined,
        }),
      })),
      candidates: [],
      selectedCandidateId: '',
      validatorSummary: '',
      stageOutputs: { planner: plannerOutput },
      reasoningLogs: ready.generation.reasoningLogs.filter((log) => log.role === 'Planner'),
      reasoningStream: null,
    },
  });
  assert.ok(interrupted);
  assert.equal(service.resumeInterruptedGeneration(created.id), true);

  const resumed = await waitFor(
    () => service.getSession(userId, created.id),
    (session) => session.status === 'ready_to_apply',
  );
  assert.equal(provider.plannerCalls, 1);
  assert.ok(resumed.generation.candidates.length);
  assert.ok(resumed.generation.stages.every((stage) => stage.status === 'completed'));
  contentPlanningRepository.deleteSession(created.id);
});

test('re-analyzing clears stale candidates and apply snapshot', async () => {
  const userId = `planning-test-${Date.now()}-reanalyze`;
  const { created, imageAssetId } = await advanceSessionToReady(userId);
  const applied = contentPlanningService.apply(userId, created.id);
  assert.equal(applied.session.status, 'applied');
  assert.ok(applied.session.applySnapshot);

  const reanalyzing = contentPlanningService.analyze({
    userId,
    sessionId: created.id,
    prompt: 'Refresh the planning input',
    productName: 'Updated test product',
    imageAssetIds: [imageAssetId],
  });
  assert.equal(reanalyzing.status, 'analyzing');
  assert.equal(reanalyzing.generation.candidates.length, 0);
  assert.equal(reanalyzing.generation.selectedCandidateId, '');
  assert.equal(reanalyzing.applySnapshot, null);

  const confirming = await waitFor(
    () => contentPlanningService.getSession(userId, created.id),
    (session) => session.status === 'confirming',
  );
  assert.equal(confirming.generation.candidates.length, 0);
  assert.equal(confirming.generation.selectedCandidateId, '');
  assert.equal(confirming.applySnapshot, null);

  contentPlanningRepository.deleteSession(created.id);
});

test('apply rejects sessions that are not ready to apply', async () => {
  const userId = `planning-test-${Date.now()}-apply-guard`;
  const { created, configured } = await advanceSessionToConfiguring(userId);
  assert.equal(configured.status, 'configuring');
  assert.throws(
    () => contentPlanningService.apply(userId, created.id),
    /not ready to apply/u,
  );
  contentPlanningRepository.deleteSession(created.id);
});

test('confirmation and settings updates clear stale generation and apply snapshots', async () => {
  const confirmUserId = `planning-test-${Date.now()}-confirm-reset`;
  const { created: confirmCreated, ready: confirmReady } = await advanceSessionToReady(confirmUserId);
  const confirmApplied = contentPlanningService.apply(confirmUserId, confirmCreated.id);
  assert.equal(confirmApplied.session.status, 'applied');
  assert.ok(confirmApplied.session.applySnapshot);

  const resetAfterConfirmation = contentPlanningService.updateConfirmation({
    userId: confirmUserId,
    sessionId: confirmCreated.id,
    materialCaptions: confirmReady.analysis.materialCaptions,
    productInsights: {
      ...confirmReady.analysis.productInsights,
      coreSellingPoints: ['updated selling point'],
    },
    referencePolicy: { useBreakdown: false, lockedContentPreset: null },
  });
  assert.equal(resetAfterConfirmation?.status, 'configuring');
  assert.equal(resetAfterConfirmation?.generation.candidates.length, 0);
  assert.equal(resetAfterConfirmation?.generation.selectedCandidateId, '');
  assert.equal(resetAfterConfirmation?.applySnapshot, null);
  assert.throws(
    () => contentPlanningService.apply(confirmUserId, confirmCreated.id),
    /not ready to apply/u,
  );
  contentPlanningRepository.deleteSession(confirmCreated.id);

  const settingsUserId = `planning-test-${Date.now()}-settings-reset`;
  const { created: settingsCreated, ready: settingsReady } = await advanceSessionToReady(settingsUserId);
  const settingsApplied = contentPlanningService.apply(settingsUserId, settingsCreated.id);
  assert.equal(settingsApplied.session.status, 'applied');
  assert.ok(settingsApplied.session.applySnapshot);

  const resetAfterSettings = contentPlanningService.updateSettings({
    userId: settingsUserId,
    sessionId: settingsCreated.id,
    settings: {
      ...settingsReady.settings,
      candidateCount: 2,
      extraInstruction: 'Need a stronger hook',
    },
  });
  assert.equal(resetAfterSettings?.status, 'configuring');
  assert.equal(resetAfterSettings?.generation.candidates.length, 0);
  assert.equal(resetAfterSettings?.generation.selectedCandidateId, '');
  assert.equal(resetAfterSettings?.applySnapshot, null);
  assert.throws(
    () => contentPlanningService.apply(settingsUserId, settingsCreated.id),
    /not ready to apply/u,
  );
  contentPlanningRepository.deleteSession(settingsCreated.id);
});

test('duplicate analyze and generate requests are protected per session', async () => {
  const analyzeUserId = `planning-test-${Date.now()}-analyze-guard`;
  const analyzeSession = createTestSession(analyzeUserId);
  const analyzeImageAssetId = createProductImageAsset(analyzeUserId);
  const firstAnalyze = contentPlanningService.analyze({
    userId: analyzeUserId,
    sessionId: analyzeSession.id,
    prompt: 'Analyze once',
    productName: 'Test product',
    imageAssetIds: [analyzeImageAssetId],
  });
  assert.equal(firstAnalyze.status, 'analyzing');
  assert.throws(
    () => contentPlanningService.analyze({
      userId: analyzeUserId,
      sessionId: analyzeSession.id,
      prompt: 'Analyze twice',
      productName: 'Test product',
      imageAssetIds: [analyzeImageAssetId],
    }),
    /already in progress/u,
  );
  await waitFor(
    () => contentPlanningService.getSession(analyzeUserId, analyzeSession.id),
    (session) => session.status === 'confirming',
  );
  contentPlanningRepository.deleteSession(analyzeSession.id);

  const generateUserId = `planning-test-${Date.now()}-generate-guard`;
  const { created } = await advanceSessionToConfiguring(generateUserId);
  const firstGenerate = contentPlanningService.generate(generateUserId, created.id);
  assert.equal(firstGenerate.status, 'generating');
  const duplicateGenerate = contentPlanningService.generate(generateUserId, created.id);
  assert.equal(duplicateGenerate.id, created.id);
  assert.equal(duplicateGenerate.status, 'generating');
  await waitFor(
    () => contentPlanningService.getSession(generateUserId, created.id),
    (session) => session.status === 'ready_to_apply',
  );
  contentPlanningRepository.deleteSession(created.id);
});

test('failed generation keeps the session non-applicable', async () => {
  class FailingValidatorProvider extends DeterministicContentPlanningAgentProvider {
    override async validator(_context: Parameters<DeterministicContentPlanningAgentProvider['validator']>[0]) {
      throw new Error('validator failed');
    }
  }

  const billing = new RecordingGenerationBilling();
  const service = new ContentPlanningService(
    new FailingValidatorProvider(),
    new DeterministicContentPlanningAnalysisProvider(),
    noOpAnalysisBilling,
    billing,
  );
  const userId = `planning-test-${Date.now()}-generate-failed`;
  const { created } = await advanceSessionToConfiguring(userId, service);
  const generating = service.generate(userId, created.id);
  assert.equal(generating.status, 'generating');

  const failed = await waitFor(
    () => service.getSession(userId, created.id),
    (session) => session.status === 'failed',
  );
  assert.equal(failed.jobStage, 'failed');
  assert.equal(failed.generation.selectedCandidateId, '');
  assert.equal(billing.reserveCalls, 1);
  assert.equal(billing.completeCalls, 0);
  assert.equal(billing.failCalls, 1);
  assert.throws(
    () => service.apply(userId, created.id),
    /not ready to apply/u,
  );
  contentPlanningRepository.deleteSession(created.id);
});

test('planning sessions are isolated by owner', () => {
  const owner = `planning-test-${Date.now()}-owner`;
  const other = `${owner}-other`;
  const created = createTestSession(owner);
  assert.throws(
    () => contentPlanningService.getSession(other, created.id),
    /planning session not found/u,
  );
  contentPlanningRepository.deleteSession(created.id);
});
