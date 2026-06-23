'use strict';

const ACCOUNT_NAME_SELECTOR = '.navigator-user__nickname, .user-info__name';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function inspectAccountNameDom(page) {
  const frames = page.frames();
  const snapshots = [];

  for (const frame of frames) {
    const snapshot = await frame.evaluate((selector) => {
      const elements = Array.from(document.querySelectorAll(selector));
      const visible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const textOf = (element) => (element.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        url: window.location.href,
        count: elements.length,
        texts: elements.map(textOf).filter(Boolean),
        visibleTexts: elements.filter(visible).map(textOf).filter(Boolean),
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
    frames: snapshots,
  };
}

async function readAccountName(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error('页面已关闭');
    }

    const snapshot = await inspectAccountNameDom(page);
    const accountName = snapshot.visibleTexts.map(normalizeText).find(Boolean)
      || snapshot.texts.map(normalizeText).find(Boolean);
    if (accountName) {
      return accountName;
    }

    await page.waitForTimeout(300);
  }

  return '';
}

module.exports = {
  ACCOUNT_NAME_SELECTOR,
  inspectAccountNameDom,
  readAccountName,
};
