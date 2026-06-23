'use strict';

const { listAdapters } = require('./adapters');
const { listTasks } = require('./task-store');
const { startTask, cancelTask, resumeTask, getTaskStatus } = require('./task-runner');
const { closeAutomationWindows, countAutomationWindows } = require('./automation-window');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class BrowserAutomationService {
  listAdapters() {
    return { ok: true, adapters: listAdapters() };
  }

  listTasks() {
    return { ok: true, tasks: listTasks() };
  }

  startTask(args) {
    return startTask(args);
  }

  cancelTask(args) {
    return cancelTask(args);
  }

  resumeTask(args) {
    return resumeTask(args);
  }

  getTask(args) {
    return getTaskStatus(args);
  }

  closeWindows(args = {}) {
    const profileId = String(args.profileId || '').trim();
    if (!profileId) {
      return { ok: false, message: '缺少 profileId' };
    }
    return {
      ok: true,
      closedCount: closeAutomationWindows({ profileId }),
    };
  }

  async stopProfile(args = {}) {
    const profileId = String(args.profileId || '').trim();
    const site = String(args.site || '').trim();
    if (!profileId) {
      return { ok: false, message: '缺少 profileId' };
    }

    const activeTasks = listTasks().filter((task) => {
      if (task.profileId !== profileId) {
        return false;
      }
      if (site && !String(task.adapter || '').includes(site)) {
        return false;
      }
      return ['created', 'running', 'waiting_user'].includes(String(task.status || ''));
    });

    const canceledTaskIds = [];
    for (const task of activeTasks) {
      const result = cancelTask({ taskId: task.id });
      if (result && result.ok) {
        canceledTaskIds.push(task.id);
      }
    }

    const closedCount = closeAutomationWindows({ profileId });
    const deadline = Date.now() + Number(args.timeoutMs || 4000);
    while (Date.now() < deadline) {
      const remainingTasks = listTasks().filter((task) => {
        if (task.profileId !== profileId) {
          return false;
        }
        if (site && !String(task.adapter || '').includes(site)) {
          return false;
        }
        return ['created', 'running', 'waiting_user'].includes(String(task.status || ''));
      }).length;
      const remainingWindows = countAutomationWindows({ profileId });
      if (remainingTasks === 0 && remainingWindows === 0) {
        return {
          ok: true,
          canceledTaskIds,
          closedCount,
        };
      }
      await sleep(80);
    }

    return {
      ok: true,
      canceledTaskIds,
      closedCount,
      message: '旧账号任务或窗口仍在关闭中',
    };
  }
}

BrowserAutomationService.toString = () => '[class BrowserAutomationService]';

module.exports = {
  BrowserAutomationService,
  browserAutomationService: new BrowserAutomationService(),
};
