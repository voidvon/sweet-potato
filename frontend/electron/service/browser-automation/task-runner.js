'use strict';

const { randomUUID } = require('crypto');
const { getConnectedBrowser } = require('./cdp-runtime');
const {
  backupAutomationProfileCookies,
  createAutomationWindow,
  createPlaceholderUrl,
  findAutomationWindow,
  flushAutomationProfile,
  getPageForWindow,
  getWindowUrl,
  isWindowUsable,
  markWindowClosing,
  presentAutomationWindow,
  restoreAutomationProfileCookies,
  restoreMainWindowFocus,
} = require('./automation-window');
const { getAdapter } = require('./adapters');
const { setTask, getTask, toPublicTask } = require('./task-store');
const { acquireProfileLock, releaseProfileLock } = require('./runtime/profile-lock');
const diagnostics = require('./core/diagnostics');

function now() {
  return new Date().toISOString();
}

function addLog(task, level, message) {
  task.logs.push({ time: now(), level, message });
  task.updatedAt = now();
}

function createLogger(task) {
  return {
    info(message) {
      addLog(task, 'info', message);
    },
    warn(message) {
      addLog(task, 'warn', message);
    },
    error(message) {
      addLog(task, 'error', message);
    },
  };
}

function markTask(task, status) {
  task.status = status;
  task.updatedAt = now();
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function getInitialUrl(adapter, input) {
  if (!adapter.initialUrl) {
    return '';
  }
  if (typeof adapter.initialUrl === 'function') {
    return String(adapter.initialUrl(input) || '');
  }
  return String(adapter.initialUrl || '');
}

function matchesWindowRule(rule, url, win) {
  if (!rule) {
    return false;
  }
  if (typeof rule === 'function') {
    return Boolean(rule(url, win));
  }
  if (rule instanceof RegExp) {
    return rule.test(String(url || ''));
  }
  if (Array.isArray(rule)) {
    return rule.some((item) => matchesWindowRule(item, url, win));
  }
  return String(url || '').includes(String(rule));
}

function closeTaskWindow(task) {
  if (!isWindowUsable(task.win)) {
    task.win = null;
    return false;
  }

  const currentUrl = getWindowUrl(task.win);
  if (matchesWindowRule(task.windowOptions.keepWindowOpenWhen, currentUrl, task.win)) {
    return false;
  }

  try {
    markWindowClosing(task.win);
    task.win.close();
    return true;
  } catch {
    if (task.win && !task.win.isDestroyed()) {
      task.win.__automationClosing = false;
    }
    task.win = null;
    return false;
  }
}

async function flushTaskProfile(task, log) {
  if (!task || !task.profileId) {
    return;
  }

  try {
    await flushAutomationProfile(task.profileId);
    await backupAutomationProfileCookies(task.profileId);
    log?.info(`Profile 存储已刷盘: ${task.profileId}`);
  } catch (error) {
    log?.warn(`Profile 存储刷盘失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function startTask(payload = {}) {
  const adapterName = String(payload.adapter || '');
  const adapter = getAdapter(adapterName);
  if (!adapter) {
    return { ok: false, message: `未知自动化适配器: ${adapterName}` };
  }

  const task = {
    id: randomUUID(),
    adapter: adapterName,
    profileId: String(payload.profileId || 'default'),
    status: 'created',
    input: payload.input || {},
    result: null,
    error: null,
    logs: [],
    createdAt: now(),
    updatedAt: now(),
    win: null,
    abortController: new AbortController(),
    closeWindowOnDone: Boolean(adapter.closeWindowOnDone),
    closeWindowOnCancel: Boolean(adapter.closeWindowOnCancel),
    closeWindowOnFailure: Boolean(adapter.closeWindowOnFailure),
    windowOptions: adapter.windowOptions || {},
    profileLock: null,
  };
  setTask(task);

  void runTask(task, adapter);

  return { ok: true, taskId: task.id, task: toPublicTask(task) };
}

async function runTask(task, adapter) {
  const log = createLogger(task);
  let handleWindowClosed = null;
  markTask(task, 'running');
  log.info('任务启动');

  try {
    const lock = acquireProfileLock(adapter, task.profileId, task.id);
    if (!lock.ok) {
      throw new Error(lock.message);
    }
    task.profileLock = lock;
    log.info(`Profile 锁定: ${lock.key}`);

    const restoredCookieResult = await restoreAutomationProfileCookies(task.profileId);
    if (restoredCookieResult.backupFound) {
      log.info(`Profile Cookie 已恢复: ${restoredCookieResult.restoredCount}`);
    } else {
      log.info('Profile Cookie 备份不存在');
    }

    const windowMarker = `automation-${task.id}`;
    let reusedWindow = false;
    if (task.windowOptions.reuseExistingWindowWhen) {
      task.win = findAutomationWindow({
        profileId: task.profileId,
        urlMatcher: (url, win) => matchesWindowRule(task.windowOptions.reuseExistingWindowWhen, url, win),
      });
      reusedWindow = Boolean(task.win);
    }
    if (task.win) {
      presentAutomationWindow(task.win, task.windowOptions);
      if (task.windowOptions.restoreFocusToMain) {
        restoreMainWindowFocus();
      }
      log.info(`复用自动化窗口: ${getWindowUrl(task.win) || 'about:blank'}`);
    } else {
      task.win = createAutomationWindow({ ...task.windowOptions, profileId: task.profileId });
      log.info('自动化窗口已创建');
      if (task.windowOptions.restoreFocusToMain) {
        restoreMainWindowFocus();
      }
    }
    handleWindowClosed = () => {
      task.win = null;
      if (task.status === 'running' || task.status === 'waiting_user') {
        task.abortController.abort();
        markTask(task, 'canceled');
        log.warn('自动化窗口已关闭，任务取消');
      }
    };
    task.win.on('closed', handleWindowClosed);
    if (!reusedWindow) {
      await task.win.loadURL(createPlaceholderUrl(windowMarker));
      log.info('自动化窗口占位页已加载');
      if (task.windowOptions.restoreFocusToMain) {
        restoreMainWindowFocus();
      }
    }

    const browser = await withTimeout(getConnectedBrowser(), 10000, 'CDP 连接超时，未能接管自动化窗口');
    log.info('CDP 已连接');
    const page = await getPageForWindow(browser, task.win, { marker: reusedWindow ? '' : windowMarker });
    log.info('自动化页面已匹配');

    const initialUrl = getInitialUrl(adapter, task.input);
    if (initialUrl && !(reusedWindow && task.windowOptions.skipInitialUrlOnReuse)) {
      log.info(`打开目标网站: ${initialUrl}`);
      await withTimeout(page.goto(initialUrl, { waitUntil: 'domcontentloaded' }), 15000, `打开目标网站超时: ${initialUrl}`).catch((error) => {
        log.warn(error instanceof Error ? error.message : String(error));
      });
      if (task.windowOptions.restoreFocusToMain) {
        restoreMainWindowFocus();
      }
    }

    const ctx = {
      page,
      task: {
        id: task.id,
        adapter: task.adapter,
        profileId: task.profileId,
        signal: task.abortController.signal,
        waitForUser: async ({ reason } = {}) => {
          markTask(task, 'waiting_user');
          log.info(reason || '等待用户接管');
          await new Promise((resolve, reject) => {
            const check = setInterval(() => {
              if (task.status === 'running') {
                clearInterval(check);
                resolve();
              }
              if (task.status === 'canceled' || task.abortController.signal.aborted) {
                clearInterval(check);
                reject(new Error('任务已取消'));
              }
            }, 300);
          });
        },
      },
      log,
    };
    ctx.diagnostics = {
      saveSnapshot: (label, options) => diagnostics.saveSnapshot(ctx, label, options),
      captureVisibleDom: () => diagnostics.captureVisibleDom(page),
    };

    const result = await adapter.run(ctx, task.input);
    if (task.status === 'canceled' || task.abortController.signal.aborted) {
      return;
    }
    task.result = result || null;
    markTask(task, 'done');
    log.info('任务完成');
    if (task.closeWindowOnDone) {
      await flushTaskProfile(task, log);
      closeTaskWindow(task);
    }
  } catch (error) {
    if (task.status === 'canceled' || task.abortController.signal.aborted) {
      if (task.closeWindowOnCancel) {
        await flushTaskProfile(task, log);
        closeTaskWindow(task);
      }
      return;
    }
    task.error = error instanceof Error ? error.message : String(error);
    markTask(task, 'failed');
    log.error(task.error);
    if (task.closeWindowOnFailure) {
      await flushTaskProfile(task, log);
      closeTaskWindow(task);
    }
  } finally {
    if (task.win && !task.win.isDestroyed() && handleWindowClosed) {
      task.win.removeListener('closed', handleWindowClosed);
    }
    if (task.profileLock) {
      log.info(`Profile 解锁: ${task.profileLock.key}`);
      releaseProfileLock(task.profileLock);
      task.profileLock = null;
    }
  }
}

function cancelTask(payload = {}) {
  const task = getTask(payload.taskId);
  if (!task) {
    return { ok: false, message: '任务不存在' };
  }
  if (!['created', 'running', 'waiting_user'].includes(String(task.status || ''))) {
    return { ok: false, message: '任务已结束', task: toPublicTask(task) };
  }
  task.abortController.abort();
  markTask(task, 'canceled');
  addLog(task, 'warn', '任务已取消');
  if (task.profileLock) {
    addLog(task, 'info', `Profile 提前解锁: ${task.profileLock.key}`);
    releaseProfileLock(task.profileLock);
    task.profileLock = null;
  }
  return { ok: true, task: toPublicTask(task) };
}

function resumeTask(payload = {}) {
  const task = getTask(payload.taskId);
  if (!task) {
    return { ok: false, message: '任务不存在' };
  }
  if (task.status !== 'waiting_user') {
    return { ok: false, message: '任务当前不在等待用户状态' };
  }
  markTask(task, 'running');
  addLog(task, 'info', '用户已确认继续');
  return { ok: true, task: toPublicTask(task) };
}

function getTaskStatus(payload = {}) {
  const task = getTask(payload.taskId);
  if (!task) {
    return { ok: false, message: '任务不存在' };
  }
  return { ok: true, task: toPublicTask(task) };
}

module.exports = {
  startTask,
  cancelTask,
  resumeTask,
  getTaskStatus,
};
