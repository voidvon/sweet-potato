import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db } from '../src/db/database.js';
import { migrateDatabase } from '../src/db/schema.js';
import {
  findReservedFixedBillableUsage,
  InsufficientStepCreditsError,
  normalizeBillingSettings,
  recordVideoGenerationUsage,
  releaseFixedBillableUsage,
  reserveFixedBillableUsage,
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

test('video generation rounds billed credits up before debiting the balance', () => {
  const userId = createBillingTestUser(10);
  const now = new Date().toISOString();
  try {
    const record = recordVideoGenerationUsage({
      userId,
      modelConfig: {
        id: `video-billing-${userId}`,
        type: 'video',
        name: 'Video billing rounding test',
        provider: 'test-provider',
        model: 'test-video-model',
        apiKey: 'test',
        baseUrl: 'https://example.com',
        temperature: 0,
        settings: {
          billing: {
            creditsPer1MTokens: 1,
            multiplier: 2,
          },
        },
        isDefault: false,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      },
      sourceType: 'video_generation',
      sourceId: `${userId}:video-generation`,
      taskId: `${userId}:task`,
      durationSeconds: 5,
      usage: {
        completionTokens: 1_534_204,
        totalTokens: 1_534_204,
      },
    });

    assert.equal(record.creditBaseCost, 1.534204);
    assert.equal(record.creditBilledCost, 4);
    assert.equal(record.creditCost, 4);
    assert.equal(record.quantitySnapshot.creditRounding, 'ceil');
    assert.equal(userRepository.findById(userId)?.creditBalance, 6);
    const ledger = billingRepository.listLedgerEntries({ userId });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].creditDelta, -4);
    assert.equal(ledger[0].creditBilledCost, 4);
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
