'use strict';

const ACCOUNT_NAME_SELECTOR = [
  '[class*="user-name"]',
  '[class*="username"]',
  '[class*="account-name"]',
  '[class*="nickname"]',
  '[class*="avatar-name"]',
  '[data-e2e*="user-name"]',
  '[data-e2e*="nickname"]',
].join(',');

const GENERIC_LOGGED_IN_SENTINEL = '__douyin_logged_in__';
const AUTH_COOKIE_NAMES = new Set([
  'sessionid',
  'sessionid_ss',
  'sid_guard',
  'uid_tt',
  'sid_tt',
]);

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isAccountNameCandidate(value) {
  const text = normalizeText(value);
  if (!text || text.length < 2 || text.length > 40) {
    return false;
  }

  return !/(登录|注册|消息|发布|关注|推荐|搜索|首页|直播|商城|我|更多|下载|打开APP|反馈|帮助)/.test(text);
}

async function inspectAccountNameDom(page) {
  const frames = page.frames();
  const snapshots = [];

  for (const frame of frames) {
    const snapshot = await frame.evaluate((selector) => {
      const visible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none';
      };

      const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const elements = Array.from(document.querySelectorAll(selector));
      const texts = elements.map((element) => clean(element.textContent)).filter(Boolean);
      const visibleTexts = elements.filter(visible).map((element) => clean(element.textContent)).filter(Boolean);
      const topRightTexts = Array.from(document.querySelectorAll('header *, nav *, [class*="header"] *, [class*="Header"] *, [class*="nav"] *, [class*="Nav"] *'))
        .filter((element) => element instanceof HTMLElement && visible(element))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.top < 160 && rect.left > window.innerWidth * 0.58;
        })
        .map((element) => clean(element.textContent))
        .filter(Boolean);

      return {
        url: window.location.href,
        count: elements.length,
        texts,
        visibleTexts,
        topRightTexts,
      };
    }, ACCOUNT_NAME_SELECTOR).catch(() => null);

    if (snapshot) {
      snapshots.push(snapshot);
    }
  }

  return {
    count: snapshots.reduce((sum, snapshot) => sum + snapshot.count, 0),
    texts: snapshots.flatMap((snapshot) => snapshot.texts),
    visibleTexts: snapshots.flatMap((snapshot) => snapshot.visibleTexts),
    topRightTexts: snapshots.flatMap((snapshot) => snapshot.topRightTexts),
    frames: snapshots,
  };
}

async function readAccountName(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error('页面已关闭');
    }

    const snapshot = await inspectAccountNameDom(page);
    const accountName = [
      ...snapshot.visibleTexts,
      ...snapshot.topRightTexts,
      ...snapshot.texts,
    ].map(normalizeText).find(isAccountNameCandidate);

    if (accountName) {
      return accountName;
    }

    await page.waitForTimeout(500);
  }

  return '';
}

async function hasAuthenticatedCookies(page) {
  try {
    const context = page.context();
    const cookies = await context.cookies('https://www.douyin.com/');
    return cookies.some((cookie) => (
      AUTH_COOKIE_NAMES.has(String(cookie.name || '').trim())
      && String(cookie.value || '').trim().length > 0
    ));
  } catch {
    return false;
  }
}

async function readSessionAccount(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const nickname = await readAccountName(page, 1200).catch(() => '');
    if (nickname) {
      return nickname;
    }

    if (await hasAuthenticatedCookies(page)) {
      return GENERIC_LOGGED_IN_SENTINEL;
    }

    await page.waitForTimeout(500).catch(() => {});
  }

  return '';
}

function isGenericLoggedInSentinel(value) {
  return normalizeText(value) === GENERIC_LOGGED_IN_SENTINEL;
}

module.exports = {
  ACCOUNT_NAME_SELECTOR,
  GENERIC_LOGGED_IN_SENTINEL,
  isGenericLoggedInSentinel,
  readSessionAccount,
  inspectAccountNameDom,
  readAccountName,
};
