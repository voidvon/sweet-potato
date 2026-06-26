'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app } = require('electron');
const { getMainWindow } = require('ee-core/electron');

const execFileAsync = promisify(execFile);
const SCRIPT_RELATIVE_PATH = path.join('backend', 'ai-worker', 'scripts', 'wechat_probe.py');
const DEFAULT_WINDOW_NAME = '\u5fae\u4fe1';

function formatDatePart(date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function appendAutomationRunLog(repoRoot, entry) {
  try {
    const logsDir = path.join(repoRoot, 'frontend', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const filePath = path.join(logsDir, `wechat-automation-${formatDatePart(new Date())}.log`);
    fs.appendFileSync(filePath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn('[wechat-automation] append run log failed:', error);
  }
}

function resolveRepoRoot() {
  const candidates = [
    process.cwd(),
    path.resolve(__dirname, '../../..'),
    path.resolve(__dirname, '../../../..'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, SCRIPT_RELATIVE_PATH))) {
      return candidate;
    }
  }

  return path.resolve(__dirname, '../../../..');
}

function resolvePythonCommand(repoRoot) {
  const candidates = [
    process.env.WECHAT_AUTOMATION_PYTHON,
    process.env.PYTHON,
    path.join(repoRoot, 'backend', 'ai-worker', '.venv', 'Scripts', 'python.exe'),
    path.join(repoRoot, 'backend', 'ai-worker', '.venv', 'bin', 'python'),
    process.platform === 'win32' ? 'python' : 'python3',
    process.platform === 'win32' ? 'py' : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      continue;
    }

    return candidate;
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}

function resolveScriptPath(repoRoot) {
  return path.join(repoRoot, SCRIPT_RELATIVE_PATH);
}

function focusMainWindow() {
  try {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    if (process.platform === 'win32') {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    app.focus();
    mainWindow.focus();
    if (typeof mainWindow.moveTop === 'function') {
      mainWindow.moveTop();
    }
    if (process.platform === 'win32') {
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(false);
        }
      }, 120);
    }
  } catch (error) {
    console.warn('[wechat-automation] restore main window focus failed:', error);
  }
}

function restoreMainWindowFocus() {
  for (const delay of [0, 120, 360, 800]) {
    setTimeout(focusMainWindow, delay);
  }
}

async function runScript(argumentsList) {
  const repoRoot = resolveRepoRoot();
  const scriptPath = resolveScriptPath(repoRoot);
  const startedAt = Date.now();

  if (!fs.existsSync(scriptPath)) {
    return {
      ok: false,
      message: `Wechat probe script not found: ${scriptPath}`,
    };
  }

  const command = [resolvePythonCommand(repoRoot), scriptPath, ...argumentsList];

  try {
    const { stdout, stderr } = await execFileAsync(command[0], command.slice(1), {
      cwd: repoRoot,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    const payload = JSON.parse(stdout || '{}');
    if (!payload.ok && stderr && stderr.trim()) {
      payload.message = payload.message || stderr.trim();
    }

    appendAutomationRunLog(repoRoot, {
      time: new Date().toISOString(),
      command,
      durationMs: Date.now() - startedAt,
      ok: Boolean(payload.ok),
      message: payload.message || '',
      logs: payload.logs || [],
      data: payload.data || null,
    });

    return {
      ...payload,
      command,
    };
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr || '').trim()
      : '';
    const stdout = error && typeof error === 'object' && 'stdout' in error
      ? String(error.stdout || '').trim()
      : '';
    const spawnFailed = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
    const message = stderr || stdout || (error instanceof Error ? error.message : 'Wechat automation execution failed');

    appendAutomationRunLog(repoRoot, {
      time: new Date().toISOString(),
      command,
      durationMs: Date.now() - startedAt,
      ok: false,
      message: spawnFailed ? `Python interpreter not found: ${command[0]}` : message,
      stderr,
      stdout,
    });

    return {
      ok: false,
      message: spawnFailed ? `Python interpreter not found: ${command[0]}` : message,
      command,
    };
  }
}

class WechatAutomationService {
  async runProbe(args = {}) {
    const windowName = String(args.windowName || DEFAULT_WINDOW_NAME).trim() || DEFAULT_WINDOW_NAME;

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    return runScript(['probe', '--window-name', windowName]);
  }

  async identifyCurrentPanel(args = {}) {
    const windowName = String(args.windowName || DEFAULT_WINDOW_NAME).trim() || DEFAULT_WINDOW_NAME;

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    return runScript(['identify-current-panel', '--window-name', windowName]);
  }

  async switchPanel(args = {}) {
    const windowName = String(args.windowName || DEFAULT_WINDOW_NAME).trim() || DEFAULT_WINDOW_NAME;
    const panel = String(args.panel || '').trim();

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    if (!['微信', '通讯录'].includes(panel)) {
      return {
        ok: false,
        message: 'Unsupported WeChat panel',
      };
    }

    return runScript(['switch-panel', '--window-name', windowName, '--panel', panel]);
  }

  async openAddFriend(args = {}) {
    const windowName = String(args.windowName || DEFAULT_WINDOW_NAME).trim() || DEFAULT_WINDOW_NAME;
    const account = String(args.account || '').trim();
    const greeting = String(args.greeting || '');

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    if (!account) {
      return {
        ok: false,
        message: 'Missing account or phone number',
      };
    }

    if (!greeting.trim()) {
      return {
        ok: false,
        message: 'Missing greeting content',
      };
    }

    const result = await runScript([
      'open-add-friend',
      '--window-name',
      windowName,
      '--account',
      account,
      '--greeting',
      greeting,
    ]);

    restoreMainWindowFocus();
    if (Array.isArray(result.logs)) {
      result.logs.push({
        level: 'info',
        code: 'main_window_focus_restore_requested',
        message: '已尝试恢复萌猫主窗口焦点',
      });
    }
    return result;
  }

  async probeAddFriendMenu(args = {}) {
    const windowName = String(args.windowName || DEFAULT_WINDOW_NAME).trim() || DEFAULT_WINDOW_NAME;

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    return runScript([
      'probe-add-friend-menu',
      '--window-name',
      windowName,
    ]);
  }

  async probeQuickAction(args = {}) {
    const windowName = String(args.windowName || DEFAULT_WINDOW_NAME).trim() || DEFAULT_WINDOW_NAME;

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    return runScript([
      'probe-quick-action',
      '--window-name',
      windowName,
    ]);
  }

  async clickAddFriendEntry(args = {}) {
    const windowName = String(args.windowName || DEFAULT_WINDOW_NAME).trim() || DEFAULT_WINDOW_NAME;

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    return runScript([
      'click-add-friend-entry',
      '--window-name',
      windowName,
    ]);
  }

  async focusAddFriendSearch(args = {}) {
    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    return runScript(['focus-add-friend-search']);
  }

  async searchAddFriendAccount(args = {}) {
    const account = String(args.account || '').trim();

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    if (!account) {
      return {
        ok: false,
        message: 'Missing account or phone number',
      };
    }

    return runScript([
      'search-add-friend-account',
      '--account',
      account,
    ]);
  }

  async handleAddFriendResult(args = {}) {
    const windowName = String(args.windowName || DEFAULT_WINDOW_NAME).trim() || DEFAULT_WINDOW_NAME;
    const greeting = String(args.greeting || '');

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    if (!greeting.trim()) {
      return {
        ok: false,
        message: 'Missing greeting content',
      };
    }

    const result = await runScript([
      'handle-add-friend-result',
      '--window-name',
      windowName,
      '--greeting',
      greeting,
    ]);

    restoreMainWindowFocus();
    if (Array.isArray(result.logs)) {
      result.logs.push({
        level: 'info',
        code: 'main_window_focus_restore_requested',
        message: '已尝试恢复萌猫主窗口焦点',
      });
    }
    return result;
  }

  async closeAddFriendWindows(args = {}) {
    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    return runScript(['close-add-friend-windows']);
  }

  async focusFillChatMessage(args = {}) {
    const windowName = String(args.windowName || DEFAULT_WINDOW_NAME).trim() || DEFAULT_WINDOW_NAME;
    const messageText = String(args.message || '');

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    if (!messageText.trim()) {
      return {
        ok: false,
        message: 'Missing message content',
      };
    }

    return runScript([
      'focus-fill-chat-message',
      '--window-name',
      windowName,
      '--message',
      messageText,
    ]);
  }

  async sendMessage(args = {}) {
    const windowName = String(args.windowName || DEFAULT_WINDOW_NAME).trim() || DEFAULT_WINDOW_NAME;
    const contactName = String(args.contactName || '').trim();
    const messageText = String(args.message || '');

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: 'Wechat automation is only supported on Windows',
      };
    }

    if (!contactName) {
      return {
        ok: false,
        message: 'Missing contact name',
      };
    }

    if (!messageText.trim()) {
      return {
        ok: false,
        message: 'Missing message content',
      };
    }

    return runScript([
      'send-message',
      '--window-name',
      windowName,
      '--contact-name',
      contactName,
      '--message',
      messageText,
    ]);
  }
}

module.exports = {
  wechatAutomationService: new WechatAutomationService(),
};
