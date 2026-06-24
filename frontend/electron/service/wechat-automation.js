'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const SCRIPT_RELATIVE_PATH = path.join('backend', 'ai-worker', 'scripts', 'wechat_probe.py');
const DEFAULT_WINDOW_NAME = '\u5fae\u4fe1';

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

async function runScript(argumentsList) {
  const repoRoot = resolveRepoRoot();
  const scriptPath = resolveScriptPath(repoRoot);

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
