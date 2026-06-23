'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function resolveRepoRoot() {
  return path.resolve(__dirname, '../../..');
}

function resolvePythonCommand() {
  return process.env.WECHAT_AUTOMATION_PYTHON
    || process.env.PYTHON
    || (process.platform === 'win32' ? 'python' : 'python3');
}

function resolveScriptPath() {
  return path.join(resolveRepoRoot(), 'backend/ai-worker/scripts/wechat_probe.py');
}

async function runScript(argumentsList) {
  const scriptPath = resolveScriptPath();
  if (!fs.existsSync(scriptPath)) {
    return {
      ok: false,
      message: `未找到微信探测脚本: ${scriptPath}`,
    };
  }

  const command = [resolvePythonCommand(), scriptPath, ...argumentsList];

  try {
    const { stdout, stderr } = await execFileAsync(command[0], command.slice(1), {
      cwd: resolveRepoRoot(),
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    const payload = JSON.parse(stdout || '{}');
    if (!payload.ok && stderr?.trim()) {
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
    const message = stderr || stdout || (error instanceof Error ? error.message : '微信自动化执行失败');

    return {
      ok: false,
      message,
      command,
    };
  }
}

class WechatAutomationService {
  async runProbe(args = {}) {
    const windowName = String(args.windowName || '微信').trim() || '微信';

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: '微信自动化当前仅支持 Windows 环境',
      };
    }
    return runScript(['probe', '--window-name', windowName]);
  }

  async sendMessage(args = {}) {
    const windowName = String(args.windowName || '微信').trim() || '微信';
    const contactName = String(args.contactName || '').trim();
    const messageText = String(args.message || '');

    if (process.platform !== 'win32') {
      return {
        ok: false,
        message: '微信自动化当前仅支持 Windows 环境',
      };
    }
    if (!contactName) {
      return {
        ok: false,
        message: '缺少联系人名称',
      };
    }
    if (!messageText.trim()) {
      return {
        ok: false,
        message: '缺少发送消息内容',
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
