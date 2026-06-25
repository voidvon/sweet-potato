'use strict';

const { logger } = require('ee-core/log');
const { getConfig } = require('ee-core/config');
const { getMainWindow } = require('ee-core/electron');
const { app, Menu, session } = require('electron');
const { stopAutomationBridgeServer } = require('../service/browser-automation/bridge-server');
const { closeCdpRuntime } = require('../service/browser-automation/cdp-runtime');

let isQuitting = false;

function allowMicrophoneCapture() {
  const frontendPort = Number(process.env.FRONTEND_PORT || 9527);
  const insecureOrigins = [
    `http://192.168.11.55:${frontendPort}`,
    `http://127.0.0.1:${frontendPort}`,
    `http://localhost:${frontendPort}`,
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ].join(',');
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', insecureOrigins);
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

function registerMediaPermissions() {
  const ses = session.defaultSession;
  if (!ses) {
    return;
  }
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(['media', 'microphone'].includes(permission));
  });
  ses.setPermissionCheckHandler((_webContents, permission) => ['media', 'microphone'].includes(permission));
}

function registerDevToolsShortcut(win) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.webContents.on('before-input-event', (event, input) => {
    const isF12 = input.key === 'F12';
    const isInspectShortcut = input.key?.toLowerCase() === 'i' && input.shift && (input.control || input.meta);
    if (!isF12 && !isInspectShortcut) {
      return;
    }

    event.preventDefault();
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools();
      return;
    }
    win.webContents.openDevTools({ mode: 'detach' });
  });
}

function registerMacWindowCloseBehavior(win) {
  if (process.platform !== 'darwin' || !win || win.isDestroyed()) {
    return;
  }

  win.on('close', (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    win.hide();
  });
}

function hideWindowsMenu(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) {
    return;
  }

  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);
  win.removeMenu();
}

class Lifecycle {

  /**
   * core app have been loaded
   */
  async ready() {
    logger.info('[lifecycle] ready');
    allowMicrophoneCapture();
  }

  /**
   * electron app ready
   */
  async electronAppReady() {
    logger.info('[lifecycle] electron-app-ready');
  }

  /**
   * main window have been loaded
   */
  async windowReady() {
    logger.info('[lifecycle] window-ready');
    const win = getMainWindow();
    registerMediaPermissions();
    registerDevToolsShortcut(win);
    registerMacWindowCloseBehavior(win);
    hideWindowsMenu(win);

    // Electron 模式不再启动本地后端，统一连接独立部署的服务端
    // 后端应该通过 Docker 或其他方式独立部署

    // 延迟加载，无白屏
    const { windowsOption } = getConfig();
    if (windowsOption.show == false) {
      const win = getMainWindow();
      win.once('ready-to-show', () => {
        win.show();
        win.focus();
      })
    }
  }

  /**
   * before app close
   */
  async beforeClose() {
    logger.info('[lifecycle] before-close');
    isQuitting = true;
    void stopAutomationBridgeServer();
    void closeCdpRuntime();
  }
}
Lifecycle.toString = () => '[class Lifecycle]';

module.exports = {
  Lifecycle
};
