'use strict';

const profileLocks = new Map();

function lockKey(adapter, profileId) {
  const site = adapter.site || adapter.name || 'default';
  return `${site}:${profileId || 'default'}`;
}

function acquireProfileLock(adapter, profileId, taskId) {
  const key = lockKey(adapter, profileId);
  const activeTaskId = profileLocks.get(key);
  if (activeTaskId && activeTaskId !== taskId) {
    return {
      ok: false,
      key,
      activeTaskId,
      message: `Profile 正在被任务使用: ${activeTaskId}`,
    };
  }
  profileLocks.set(key, taskId);
  return { ok: true, key, taskId };
}

function releaseProfileLock(lock) {
  if (!lock || !lock.key) {
    return;
  }
  const activeTaskId = profileLocks.get(lock.key);
  if (activeTaskId === lock.taskId) {
    profileLocks.delete(lock.key);
  }
}

module.exports = {
  acquireProfileLock,
  releaseProfileLock,
};
