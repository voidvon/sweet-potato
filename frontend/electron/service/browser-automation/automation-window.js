'use strict';

const fs = require('fs');
const path = require('path');
const { BrowserWindow, app, session } = require('electron');

const SAFE_NAVIGATION_PROTOCOLS = new Set(['http:', 'https:', 'data:', 'about:', 'blob:']);
const usedAutomationProfiles = new Set();

function safeProfileId(profileId) {
  return String(profileId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
}

function getAutomationProfilePartition(profileId) {
  return `persist:automation:${safeProfileId(profileId)}`;
}

function getAutomationProfileSession(profileId) {
  return session.fromPartition(getAutomationProfilePartition(profileId));
}

function getAutomationProfileBackupDir() {
  const dir = path.join(app.getPath('userData'), 'automation-profile-backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getAutomationProfileBackupPath(profileId) {
  return path.join(getAutomationProfileBackupDir(), `${safeProfileId(profileId)}.json`);
}

function getCookieUrl(cookie) {
  const rawDomain = String(cookie?.domain || '').trim().replace(/^\./, '');
  if (!rawDomain) {
    return null;
  }
  const protocol = cookie?.secure ? 'https' : 'http';
  const pathname = String(cookie?.path || '/').startsWith('/')
    ? String(cookie?.path || '/')
    : `/${String(cookie?.path || '/')}`;
  return `${protocol}://${rawDomain}${pathname}`;
}

function serializeCookie(cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    session: Boolean(cookie.session),
    sameSite: cookie.sameSite,
    expirationDate: typeof cookie.expirationDate === 'number' ? cookie.expirationDate : null,
  };
}

function isSafeNavigationUrl(targetUrl) {
  if (!targetUrl) {
    return false;
  }

  try {
    const parsed = new URL(String(targetUrl));
    return SAFE_NAVIGATION_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function blockUnsafeNavigation(event, targetUrl, source) {
  if (isSafeNavigationUrl(targetUrl)) {
    return false;
  }

  event.preventDefault();
  console.warn(`[browser-automation] blocked external protocol navigation from ${source}: ${targetUrl}`);
  return true;
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

function registerDevToolsShortcut(win) {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
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
  const partition = getAutomationProfilePartition(profileId);
  usedAutomationProfiles.add(profileId);
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

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isSafeNavigationUrl(url)) {
      console.warn(`[browser-automation] blocked external protocol window open: ${url}`);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.webContents.on('will-navigate', (event, targetUrl) => {
    blockUnsafeNavigation(event, targetUrl, 'will-navigate');
  });

  win.webContents.on('will-frame-navigate', (event, targetUrl) => {
    blockUnsafeNavigation(event, targetUrl, 'will-frame-navigate');
  });

  win.webContents.on('will-redirect', (event, targetUrl) => {
    blockUnsafeNavigation(event, targetUrl, 'will-redirect');
  });

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

  registerDevToolsShortcut(win);

  return win;
}

function findAutomationWindow(options = {}) {
  const profileId = safeProfileId(options.profileId);
  const partition = getAutomationProfilePartition(profileId);
  const urlMatcher = typeof options.urlMatcher === 'function' ? options.urlMatcher : null;
  const profileSession = getAutomationProfileSession(profileId);
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
  const partition = getAutomationProfilePartition(profileId);
  const urlMatcher = typeof options.urlMatcher === 'function' ? options.urlMatcher : null;
  const profileSession = getAutomationProfileSession(profileId);
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
  const partition = getAutomationProfilePartition(profileId);
  const profileSession = getAutomationProfileSession(profileId);
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
  const profileSession = getAutomationProfileSession(safeId);
  await profileSession.clearStorageData();
  await profileSession.clearCache();
}

async function backupAutomationProfileCookies(profileId) {
  const safeId = safeProfileId(profileId);
  const profileSession = getAutomationProfileSession(safeId);
  const cookies = await profileSession.cookies.get({});
  const payload = {
    profileId: safeId,
    savedAt: new Date().toISOString(),
    cookies: cookies.map(serializeCookie),
  };
  fs.writeFileSync(getAutomationProfileBackupPath(safeId), JSON.stringify(payload, null, 2), 'utf8');
  return payload.cookies.length;
}

async function restoreAutomationProfileCookies(profileId) {
  const safeId = safeProfileId(profileId);
  const backupPath = getAutomationProfileBackupPath(safeId);
  if (!fs.existsSync(backupPath)) {
    return { restoredCount: 0, backupFound: false };
  }

  let payload = null;
  try {
    payload = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  } catch {
    return { restoredCount: 0, backupFound: true };
  }

  const cookies = Array.isArray(payload?.cookies) ? payload.cookies : [];
  if (!cookies.length) {
    return { restoredCount: 0, backupFound: true };
  }

  const profileSession = getAutomationProfileSession(safeId);
  let restoredCount = 0;
  for (const cookie of cookies) {
    const url = getCookieUrl(cookie);
    if (!url || !cookie?.name) {
      continue;
    }
    const details = {
      url,
      name: String(cookie.name),
      value: String(cookie.value || ''),
      domain: cookie.domain,
      path: cookie.path,
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      sameSite: cookie.sameSite,
    };
    if (!cookie.session && typeof cookie.expirationDate === 'number' && Number.isFinite(cookie.expirationDate)) {
      details.expirationDate = cookie.expirationDate;
    }
    try {
      await profileSession.cookies.set(details);
      restoredCount += 1;
    } catch {
      continue;
    }
  }

  await profileSession.cookies.flushStore().catch(() => {});
  return { restoredCount, backupFound: true };
}

async function flushAutomationProfile(profileId) {
  const safeId = safeProfileId(profileId);
  const profileSession = getAutomationProfileSession(safeId);
  await profileSession.flushStorageData();
  await profileSession.cookies.flushStore();
  await backupAutomationProfileCookies(safeId);
}

async function flushAllAutomationProfiles() {
  const profileIds = Array.from(usedAutomationProfiles);
  for (const profileId of profileIds) {
    await flushAutomationProfile(profileId);
  }
}

async function readAutomationProfileStorage(profileId, origin) {
  const safeId = safeProfileId(profileId);
  const targetOrigin = String(origin || '').trim();
  if (!targetOrigin) {
    throw new Error('Missing origin');
  }
  return {
    partition: getAutomationProfilePartition(safeId),
    origin: targetOrigin,
  };
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
  backupAutomationProfileCookies,
  clearAutomationProfile,
  flushAutomationProfile,
  flushAllAutomationProfiles,
  readAutomationProfileStorage,
  restoreAutomationProfileCookies,
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
