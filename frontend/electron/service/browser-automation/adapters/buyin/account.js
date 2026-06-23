'use strict';

const ACCOUNT_NAME_SELECTOR = [
  '.account-name',
  '.user-name',
  '.userName',
  '.nickname',
  '[class*="account-name"]',
  '[class*="user-name"]',
  '[class*="userName"]',
  '[class*="nickname"]',
  '[class*="UserName"]',
  '[class*="user-info"]',
  '[class*="UserInfo"]',
].join(',');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isAccountNameCandidate(value) {
  const text = normalizeText(value);
  if (!text || text.length < 2 || text.length > 40) {
    return false;
  }
  return !/(登录|注册|退出|帮助|消息|通知|店铺|商家|营销|服务市场|精选联盟|达人广场)/.test(text);
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
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const elements = Array.from(document.querySelectorAll(selector));
      const texts = elements.map((element) => clean(element.textContent)).filter(Boolean);
      const visibleTexts = elements.filter(visible).map((element) => clean(element.textContent)).filter(Boolean);
      const topRightTexts = Array.from(document.querySelectorAll('header *, [class*="header"] *, [class*="Header"] *, [class*="nav"] *, [class*="Nav"] *'))
        .filter((element) => element instanceof HTMLElement && visible(element))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.top < 120 && rect.left > window.innerWidth * 0.45;
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

async function readAccountName(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let fallbackName = '';

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error('页面已关闭');
    }

    const snapshot = await inspectAccountNameDom(page);
    const accountName = [
      ...snapshot.visibleTexts,
      ...snapshot.texts,
      ...snapshot.topRightTexts,
    ].map(normalizeText).find(isAccountNameCandidate);
    if (accountName) {
      return accountName;
    }
    fallbackName = await page.evaluate(() => {
      try {
        const url = new URL(window.location.href);
        if (url.hostname === 'buyin.jinritemai.com' && url.pathname.startsWith('/dashboard')) {
          return '精选联盟账号';
        }
      } catch {
        // Ignore malformed transient URLs while login redirects.
      }
      return '';
    }).catch(() => '') || fallbackName;

    await page.waitForTimeout(300);
  }

  return fallbackName;
}

module.exports = {
  ACCOUNT_NAME_SELECTOR,
  inspectAccountNameDom,
  readAccountName,
};
