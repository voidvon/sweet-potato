import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db } from '../src/db/database.js';
import { migrateDatabase } from '../src/db/schema.js';
import {
  billedVodUploadMegabytes,
  findReservedFixedBillableUsage,
  estimateSubtitleRemovalPrice,
  estimateVideoGenerationPrice,
  estimateVideoTranslationPrice,
  InsufficientStepCreditsError,
  normalizeBillingSettings,
  recordVideoGenerationUsage,
  releaseFixedBillableUsage,
  reserveFixedBillableUsage,
  settleReservedFixedBillableUsage,
  settleFixedBillableUsage,
} from '../src/modules/billing/billing.service.js';
import { billingRepository } from '../src/modules/billing/billing.repository.js';
import { userRepository } from '../src/modules/users/user.repository.js';

function createBillingTestUser(creditBalance: number) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = `fixed-billing-${suffix}`;
  userRepository.create({
    id: userId,
    username: userId,
    displayName: 'Fixed billing test',
    role: 'user',
    isBlacklisted: false,
    creditBalance,
    passwordHash: 'test',
    salt: 'test',
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  });
  return userId;
}

function cleanupBillingTestUser(userId: string) {
  db.prepare('DELETE FROM billable_usage_records WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM credit_ledger WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM credit_reservations WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM user_role_assignments WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

test('billing settings include default content planning request prices', () => {
  const settings = normalizeBillingSettings({});
  assert.equal(settings.contentPlanningAnalysisCreditsPerRequest, 2);
  assert.equal(settings.contentPlanningGenerationCreditsPerRequest, 3);
});

test('billing settings include default Seedance prices by model and resolution', () => {
  const settings = normalizeBillingSettings({});
  assert.equal(settings.seedance2CreditsPerSecond720p, 20);
  assert.equal(settings.seedance2CreditsPerSecond480p, 12);
  assert.equal(settings.seedance2FastCreditsPerSecond720p, 18);
  assert.equal(settings.seedance2FastCreditsPerSecond480p, 11);
  assert.equal(settings.seedance2MiniCreditsPerSecond720p, 15);
  assert.equal(settings.seedance2MiniCreditsPerSecond480p, 7);
});

test('VOD uploads bill every started megabyte as a full megabyte', () => {
  assert.equal(billedVodUploadMegabytes(0), 0);
  assert.equal(billedVodUploadMegabytes(1), 1);
  assert.equal(billedVodUploadMegabytes(1024 * 1024), 1);
  assert.equal(billedVodUploadMegabytes(1024 * 1024 + 1), 2);
});

test('video operation estimates use configured model, resolution, duration, and enabled modes', () => {
  assert.deepEqual(estimateVideoGenerationPrice({
    durationSeconds: 5,
    modelId: 'doubao-seedance-2-0-260128',
    resolution: '480P',
  }), {
    credits: 60,
    creditsPerSecond: 12,
    durationSeconds: 5,
    resolution: '480p',
  });
  assert.deepEqual(estimateVideoGenerationPrice({
    durationSeconds: 5.1,
    modelId: 'doubao-seedance-2-0-260128',
    resolution: '480P',
  }), {
    credits: 72,
    creditsPerSecond: 12,
    durationSeconds: 6,
    resolution: '480p',
  });
  assert.deepEqual(estimateSubtitleRemovalPrice(5.1), {
    credits: 12,
    creditsPerSecond: 2,
    durationSeconds: 6,
  });
  assert.deepEqual(estimateVideoTranslationPrice({
    durationSeconds: 5.1,
    eraseSourceSubtitles: true,
    translationTypes: ['subtitle', 'voice', 'face'],
  }), {
    credits: 42,
    creditsPerSecond: 7,
    durationSeconds: 6,
  });
});

test('video generation bills by model, resolution, and duration without token usage', () => {
  const userId = createBillingTestUser(100);
  const now = new Date().toISOString();
  try {
    const record = recordVideoGenerationUsage({
      userId,
      modelConfig: {
        id: `video-billing-${userId}`,
        type: 'video',
        name: 'Seedance 2.0',
        provider: 'volcengine-seedance',
        model: 'doubao-seedance-2-0-260128',
        apiKey: 'test',
        baseUrl: 'https://example.com',
        temperature: 0,
        settings: {},
        isDefault: false,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      },
      sourceType: 'video_generation',
      sourceId: `${userId}:video-generation`,
      taskId: `${userId}:task`,
      durationSeconds: 5,
      resolution: '480P',
    });

    assert.equal(record.pricingMode, 'per_second');
    assert.equal(record.creditBaseCost, 60);
    assert.equal(record.creditBilledCost, 60);
    assert.equal(record.creditCost, 60);
    assert.equal(record.quantitySnapshot.seconds, 5);
    assert.equal(record.quantitySnapshot.resolution, '480p');
    assert.equal(record.quantitySnapshot.configuredCreditsPerSecond, 12);
    assert.equal(userRepository.findById(userId)?.creditBalance, 40);
    const ledger = billingRepository.listLedgerEntries({ userId });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].creditDelta, -60);
    assert.equal(ledger[0].creditBilledCost, 60);
  } finally {
    cleanupBillingTestUser(userId);
  }
});

test('fixed billable usage reserves credits and settles one completed record', () => {
  const userId = createBillingTestUser(10);
  const sourceId = `${userId}:analysis`;
  try {
    const reservation = reserveFixedBillableUsage({
      userId,
      category: 'content_planning_analysis',
      sourceType: 'content_planning_analysis',
      sourceId,
      sessionId: 'planning-session-test',
      credits: 2,
      step: 'content_planning_analysis',
      stepLabel: '爆款策划素材识别',
      requestSnapshot: { imageCount: 1, hasReferenceVideo: true },
    });
    assert.equal(userRepository.findById(userId)?.creditBalance, 8);
    assert.equal(billingRepository.findReservation(reservation.id)?.status, 'reserved');
    assert.equal(billingRepository.listLedgerEntries({ userId }).at(0)?.type, 'reserve_debit');

    const record = settleFixedBillableUsage({
      reservation,
      category: 'content_planning_analysis',
      provider: 'volcengine-ark',
      model: 'test-model',
      sessionId: 'planning-session-test',
      responseSnapshot: { status: 'completed' },
    });
    assert.equal(record.creditCost, 2);
    assert.equal(record.status, 'completed');
    assert.equal(record.requestSnapshot.imageCount, 1);
    assert.equal(billingRepository.findReservation(reservation.id)?.status, 'settled');
    const ledger = billingRepository.listLedgerEntries({ userId });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].type, 'usage_debit');
    assert.equal(ledger[0].creditDelta, -2);
    assert.equal(userRepository.findById(userId)?.creditBalance, 8);
  } finally {
    cleanupBillingTestUser(userId);
  }
});

test('fixed billable usage releases reserved credits after failure', () => {
  const userId = createBillingTestUser(10);
  try {
    const reservation = reserveFixedBillableUsage({
      userId,
      category: 'content_planning_analysis',
      sourceType: 'content_planning_analysis',
      sourceId: `${userId}:analysis`,
      credits: 2,
      step: 'content_planning_analysis',
      stepLabel: '爆款策划素材识别',
    });
    assert.equal(userRepository.findById(userId)?.creditBalance, 8);

    releaseFixedBillableUsage(reservation);
    assert.equal(billingRepository.findReservation(reservation.id)?.status, 'released');
    assert.equal(userRepository.findById(userId)?.creditBalance, 10);
  } finally {
    cleanupBillingTestUser(userId);
  }
});

test('fixed video generation charge settles as per-second usage linked to the video task', () => {
  const userId = createBillingTestUser(200);
  const taskId = `${userId}:video-task`;
  try {
    const reservation = reserveFixedBillableUsage({
      userId,
      category: 'video_generation',
      sourceType: 'marketing_video_generation',
      sourceId: `${taskId}:generation`,
      credits: 100,
      step: 'marketing_video_generation',
      stepLabel: '营销视频生成',
      pricingMode: 'per_second',
      quantitySnapshot: {
        seconds: 5,
        resolution: '720p',
        configuredCreditsPerSecond: 20,
      },
    });

    const record = settleReservedFixedBillableUsage({
      reservationId: reservation.id,
      category: 'video_generation',
      provider: 'volcengine-seedance',
      model: 'doubao-seedance-2-0-260128',
      taskId,
    });

    assert.ok(record);
    assert.equal(record.pricingMode, 'per_second');
    assert.equal(record.taskId, taskId);
    assert.equal(record.creditCost, 100);
    assert.equal(record.quantitySnapshot.seconds, 5);
    assert.equal(record.quantitySnapshot.resolution, '720p');
    assert.equal(userRepository.findById(userId)?.creditBalance, 100);
  } finally {
    cleanupBillingTestUser(userId);
  }
});

test('fixed billable usage recovers a reserved generation charge by session', () => {
  const userId = createBillingTestUser(10);
  const sessionId = `planning-session-${Date.now()}`;
  try {
    const reservation = reserveFixedBillableUsage({
      userId,
      category: 'content_planning_generation',
      sourceType: 'content_planning_generation',
      sourceId: `${sessionId}:generation:test`,
      sessionId,
      credits: 3,
      step: 'content_planning_generation',
      stepLabel: '爆款策划脚本生成',
    });

    assert.equal(findReservedFixedBillableUsage({
      sourceType: 'content_planning_generation',
      sessionId,
    })?.id, reservation.id);
    releaseFixedBillableUsage(reservation);
  } finally {
    cleanupBillingTestUser(userId);
  }
});

test('migration backfills settled content planning reserve ledger as usage debit', () => {
  const userId = createBillingTestUser(10);
  const sessionId = `planning-session-${Date.now()}`;
  try {
    const reservation = reserveFixedBillableUsage({
      userId,
      category: 'content_planning_generation',
      sourceType: 'content_planning_generation',
      sourceId: `${sessionId}:generation:test`,
      sessionId,
      credits: 3,
      step: 'content_planning_generation',
      stepLabel: '爆款策划脚本生成',
    });
    billingRepository.updateReservationStatus(reservation.id, 'settled', new Date().toISOString());
    assert.equal(billingRepository.listLedgerEntries({ userId }).at(0)?.type, 'reserve_debit');

    migrateDatabase();

    const ledger = billingRepository.listLedgerEntries({ userId });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].type, 'usage_debit');
    assert.equal(ledger[0].creditDelta, -3);
  } finally {
    cleanupBillingTestUser(userId);
  }
});

test('fixed billable usage rejects insufficient credits before reservation', () => {
  const userId = createBillingTestUser(1);
  try {
    assert.throws(
      () => reserveFixedBillableUsage({
        userId,
        category: 'content_planning_analysis',
        sourceType: 'content_planning_analysis',
        sourceId: `${userId}:analysis`,
        credits: 2,
        step: 'content_planning_analysis',
        stepLabel: '爆款策划素材识别',
      }),
      InsufficientStepCreditsError,
    );
    assert.equal(userRepository.findById(userId)?.creditBalance, 1);
  } finally {
    cleanupBillingTestUser(userId);
  }
});
