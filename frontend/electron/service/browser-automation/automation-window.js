'use strict';

const { BrowserWindow, app, session } = require('electron');

function safeProfileId(profileId) {
  return String(profileId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
}

function createPlaceholderUrl(marker) {
  const safeMarker = String(marker || 'automation-window');
  const html = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${safeMarker}</title>`,
    '<style>',
    'body{margin:0;height:100vh;display:grid;place-items:center;background:#f7f8fa;color:#1f2937;font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
    '.box{padding:18px 22px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;box-shadow:0 8px 28px rgba(15,23,42,.08);}',
    '.title{font-size:15px;font-weight:600;margin-bottom:6px;}',
    '.sub{color:#64748b;}',
    '</style>',
    '</head>',
    `<body data-automation-marker="${safeMarker}">`,
    '<div class="box">',
    '<div class="title">正在准备自动化浏览器</div>',
    '<div class="sub">连接成功后会自动打开目标网站。</div>',
    '</div>',
    '</body>',
    '</html>',
  ].join('');

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function focusMainWindow() {
  try {
    const { getMainWindow } = require('ee-core/electron');
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    if (process.platform === 'darwin') {
      app.focus({ steal: true });
    }
    mainWindow.focus();
  } catch (error) {
    console.warn('[browser-automation] restore main window focus failed:', error);
  }
}

function restoreMainWindowFocus() {
  for (const delay of [0, 120, 360, 800]) {
    setTimeout(focusMainWindow, delay);
  }
}

function isWindowUsable(win) {
  return Boolean(
    win
    && !win.isDestroyed()
    && !win.__automationClosing
    && win.webContents
    && !win.webContents.isDestroyed(),
  );
}

function markWindowClosing(win) {
  if (!win || win.isDestroyed()) {
    return false;
  }
  win.__automationClosing = true;
  return true;
}

function getWindowUrl(win) {
  if (!isWindowUsable(win)) {
    return '';
  }
  try {
    return String(win.webContents.getURL() || '');
  } catch {
    return '';
  }
}

function presentAutomationWindow(win, options = {}) {
  if (!isWindowUsable(win)) {
    return false;
  }

  if (win.isMinimized()) {
    win.restore();
  }

  if (options.show === false) {
    return true;
  }

  if (options.showInactive) {
    if (typeof win.showInactive === 'function') {
      win.showInactive();
    } else {
      win.show();
    }
    return true;
  }

  win.show();
  return true;
}

function createAutomationWindow(options = {}) {
  const profileId = safeProfileId(options.profileId);
  const partition = `persist:automation:${profileId}`;
  const showInactive = Boolean(options.showInactive);
  const win = new BrowserWindow({
    title: options.title || '自动化浏览器',
    width: options.width || 1280,
    height: options.height || 860,
    minWidth: 960,
    minHeight: 640,
    show: !showInactive && options.show !== false,
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: options.backgroundThrottling !== false,
      partition,
    },
  });
  win.__automationProfileId = profileId;
  win.__automationPartition = partition;

  if (showInactive) {
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.showInactive();
      }
    });
  }

  if (options.restoreFocusToMain) {
    win.once('ready-to-show', restoreMainWindowFocus);
    restoreMainWindowFocus();
  }

  return win;
}

function findAutomationWindow(options = {}) {
  const profileId = safeProfileId(options.profileId);
  const partition = `persist:automation:${profileId}`;
  const urlMatcher = typeof options.urlMatcher === 'function' ? options.urlMatcher : null;
  const profileSession = session.fromPartition(partition);
  const windows = BrowserWindow.getAllWindows().slice().reverse();

  for (const win of windows) {
    if (!isWindowUsable(win)) {
      continue;
    }
    if (win.webContents.session !== profileSession) {
      continue;
    }
    const currentUrl = getWindowUrl(win);
    if (urlMatcher && !urlMatcher(currentUrl, win)) {
      continue;
    }
    return win;
  }

  return null;
}

function closeAutomationWindows(options = {}) {
  const profileId = safeProfileId(options.profileId);
  const partition = `persist:automation:${profileId}`;
  const urlMatcher = typeof options.urlMatcher === 'function' ? options.urlMatcher : null;
  const profileSession = session.fromPartition(partition);
  const windows = BrowserWindow.getAllWindows().slice().reverse();
  let closedCount = 0;

  for (const win of windows) {
    if (!isWindowUsable(win)) {
      continue;
    }
    if (win.webContents.session !== profileSession) {
      continue;
    }
    const currentUrl = getWindowUrl(win);
    if (urlMatcher && !urlMatcher(currentUrl, win)) {
      continue;
    }
    try {
      markWindowClosing(win);
      win.close();
      closedCount += 1;
    } catch {
      if (win && !win.isDestroyed()) {
        win.__automationClosing = false;
      }
      continue;
    }
  }

  return closedCount;
}

function countAutomationWindows(options = {}) {
  const profileId = safeProfileId(options.profileId);
  const partition = `persist:automation:${profileId}`;
  const profileSession = session.fromPartition(partition);
  const windows = BrowserWindow.getAllWindows();
  let count = 0;

  for (const win of windows) {
    if (!win || win.isDestroyed()) {
      continue;
    }
    if (win.__automationPartition === partition) {
      count += 1;
      continue;
    }
    try {
      if (win.webContents && !win.webContents.isDestroyed() && win.webContents.session === profileSession) {
        count += 1;
      }
    } catch {
      continue;
    }
  }

  return count;
}

async function clearAutomationProfile(profileId) {
  const safeId = safeProfileId(profileId);
  const profileSession = session.fromPartition(`persist:automation:${safeId}`);
  await profileSession.clearStorageData();
  await profileSession.clearCache();
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isMatchingPage(page, targetUrl, marker) {
  const pageUrl = page.url();
  if (targetUrl && pageUrl === targetUrl) {
    return true;
  }
  if (!marker) {
    return false;
  }

  if (pageUrl.includes(marker) || pageUrl.includes(encodeURIComponent(marker))) {
    return true;
  }

  try {
    return await page.title() === marker;
  } catch {
    return false;
  }
}

async function getPageForWindow(browser, win, options = {}) {
  const marker = options.marker ? String(options.marker) : '';
  const timeoutMs = Number(options.timeoutMs || 8000);
  const startedAt = Date.now();
  const targetUrl = getWindowUrl(win);
  const webContentsId = isWindowUsable(win) ? win.webContents.id : 'destroyed';

  while (Date.now() - startedAt < timeoutMs) {
    const contexts = browser.contexts();

    for (const context of contexts) {
      for (const page of context.pages()) {
        if (page.isClosed()) {
          continue;
        }
        if (await isMatchingPage(page, targetUrl, marker)) {
          return page;
        }
      }
    }

    await sleep(100);
  }

  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  const visiblePages = pages.filter((page) => !page.isClosed());
  if (!marker && visiblePages.length === 1) {
    return visiblePages[0];
  }

  throw new Error(`无法匹配自动化窗口页面: ${webContentsId}, marker=${marker || 'none'}`);
}

module.exports = {
  clearAutomationProfile,
  createPlaceholderUrl,
  createAutomationWindow,
  findAutomationWindow,
  closeAutomationWindows,
  countAutomationWindows,
  getWindowUrl,
  isWindowUsable,
  markWindowClosing,
  presentAutomationWindow,
  restoreMainWindowFocus,
  getPageForWindow,
};
