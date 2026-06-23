'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const taskRunnerModulePath = path.resolve(__dirname, 'task-runner.js');
const cdpRuntimeModulePath = path.resolve(__dirname, 'cdp-runtime.js');
const automationWindowModulePath = path.resolve(__dirname, 'automation-window.js');
const adaptersModulePath = path.resolve(__dirname, 'adapters/index.js');
const taskStoreModulePath = path.resolve(__dirname, 'task-store.js');
const profileLockModulePath = path.resolve(__dirname, 'runtime/profile-lock.js');
const diagnosticsModulePath = path.resolve(__dirname, 'core/diagnostics.js');

function restoreModule(modulePath, previous) {
  if (previous) {
    require.cache[modulePath] = previous;
    return;
  }
  delete require.cache[modulePath];
}

function loadTaskRunnerModule(stubs = {}) {
  const previous = {
    taskRunner: require.cache[taskRunnerModulePath],
    cdpRuntime: require.cache[cdpRuntimeModulePath],
    automationWindow: require.cache[automationWindowModulePath],
    adapters: require.cache[adaptersModulePath],
    taskStore: require.cache[taskStoreModulePath],
    profileLock: require.cache[profileLockModulePath],
    diagnostics: require.cache[diagnosticsModulePath],
  };

  delete require.cache[taskRunnerModulePath];
  require.cache[cdpRuntimeModulePath] = {
    id: cdpRuntimeModulePath,
    filename: cdpRuntimeModulePath,
    loaded: true,
    exports: {
      getConnectedBrowser: async () => ({}),
    },
  };
  require.cache[automationWindowModulePath] = {
    id: automationWindowModulePath,
    filename: automationWindowModulePath,
    loaded: true,
    exports: {
      createAutomationWindow: () => null,
      createPlaceholderUrl: () => 'about:blank',
      findAutomationWindow: () => null,
      getPageForWindow: async () => null,
      getWindowUrl: () => '',
      isWindowUsable: () => true,
      markWindowClosing: () => {},
      presentAutomationWindow: () => {},
      restoreMainWindowFocus: () => {},
    },
  };
  require.cache[adaptersModulePath] = {
    id: adaptersModulePath,
    filename: adaptersModulePath,
    loaded: true,
    exports: {
      getAdapter: () => null,
    },
  };
  require.cache[taskStoreModulePath] = {
    id: taskStoreModulePath,
    filename: taskStoreModulePath,
    loaded: true,
    exports: {
      setTask: (task) => task,
      getTask: stubs.getTask,
      toPublicTask: stubs.toPublicTask,
    },
  };
  require.cache[profileLockModulePath] = {
    id: profileLockModulePath,
    filename: profileLockModulePath,
    loaded: true,
    exports: {
      acquireProfileLock: () => ({ ok: false, message: 'unused in test' }),
      releaseProfileLock: stubs.releaseProfileLock,
    },
  };
  require.cache[diagnosticsModulePath] = {
    id: diagnosticsModulePath,
    filename: diagnosticsModulePath,
    loaded: true,
    exports: {
      saveSnapshot: async () => null,
      captureVisibleDom: async () => null,
    },
  };

  const taskRunner = require(taskRunnerModulePath);
  return {
    taskRunner,
    restore() {
      restoreModule(taskRunnerModulePath, previous.taskRunner);
      restoreModule(cdpRuntimeModulePath, previous.cdpRuntime);
      restoreModule(automationWindowModulePath, previous.automationWindow);
      restoreModule(adaptersModulePath, previous.adapters);
      restoreModule(taskStoreModulePath, previous.taskStore);
      restoreModule(profileLockModulePath, previous.profileLock);
      restoreModule(diagnosticsModulePath, previous.diagnostics);
    },
  };
}

test('cancelTask keeps the automation window open while canceling the task', () => {
  let releaseCount = 0;
  let windowClosed = false;
  const task = {
    id: 'task-1',
    status: 'running',
    logs: [],
    updatedAt: '',
    abortController: new AbortController(),
    profileLock: { key: 'profile:task-1' },
    win: {
      close() {
        windowClosed = true;
      },
    },
  };

  const { taskRunner, restore } = loadTaskRunnerModule({
    getTask: (taskId) => (taskId === task.id ? task : null),
    toPublicTask: (currentTask) => ({
      id: currentTask.id,
      status: currentTask.status,
      logs: currentTask.logs,
    }),
    releaseProfileLock: () => {
      releaseCount += 1;
    },
  });

  try {
    const result = taskRunner.cancelTask({ taskId: task.id });
    assert.equal(result.ok, true);
    assert.equal(result.task.status, 'canceled');
    assert.equal(task.abortController.signal.aborted, true);
    assert.equal(windowClosed, false);
    assert.equal(releaseCount, 1);
    assert.equal(task.profileLock, null);
    assert.deepEqual(task.logs.map((entry) => entry.level), ['warn', 'info']);
  } finally {
    restore();
  }
});

test('cancelTask returns a not-found error for unknown tasks', () => {
  const { taskRunner, restore } = loadTaskRunnerModule({
    getTask: () => null,
    toPublicTask: (task) => task,
    releaseProfileLock: () => {},
  });

  try {
    const result = taskRunner.cancelTask({ taskId: 'missing' });
    assert.deepEqual(result, { ok: false, message: '任务不存在' });
  } finally {
    restore();
  }
});

test('cancelTask does not rewrite a completed task', () => {
  const task = {
    id: 'task-2',
    status: 'done',
    logs: [],
    updatedAt: '',
    abortController: new AbortController(),
    profileLock: null,
  };

  const { taskRunner, restore } = loadTaskRunnerModule({
    getTask: (taskId) => (taskId === task.id ? task : null),
    toPublicTask: (currentTask) => ({
      id: currentTask.id,
      status: currentTask.status,
    }),
    releaseProfileLock: () => {},
  });

  try {
    const result = taskRunner.cancelTask({ taskId: task.id });
    assert.deepEqual(result, {
      ok: false,
      message: '任务已结束',
      task: {
        id: task.id,
        status: 'done',
      },
    });
    assert.equal(task.abortController.signal.aborted, false);
  } finally {
    restore();
  }
});
