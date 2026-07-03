'use strict';

const CAPTCHA_SELECTOR = '#captcha_container';
const CAPTCHA_POLL_INTERVAL_MS = 1000;
const CAPTCHA_SETTLE_DELAY_MS = 500;

async function hasDouyinCaptcha(page) {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle?.(element);
    const rect = element.getBoundingClientRect();
    return style?.display !== 'none'
      && style?.visibility !== 'hidden'
      && rect.width > 0
      && rect.height > 0;
  }, CAPTCHA_SELECTOR).catch(() => false);
}

async function waitForCaptchaSolved(ctx) {
  if (!(await hasDouyinCaptcha(ctx.page))) {
    return false;
  }

  ctx.log.warn('Detected Douyin captcha, waiting for manual verification');
  ctx.window?.activate?.();
  await ctx.task.waitForUser({
    reason: '检测到抖音验证码，请先在自动化窗口手动完成验证',
    until: async () => !(await hasDouyinCaptcha(ctx.page)),
    onPoll: () => {
      ctx.window?.activate?.();
    },
    pollIntervalMs: CAPTCHA_POLL_INTERVAL_MS,
  });
  await ctx.page.waitForTimeout(CAPTCHA_SETTLE_DELAY_MS).catch(() => {});
  ctx.log.info('Douyin captcha cleared, resuming automation');
  ctx.window?.restoreMain?.();
  return true;
}

async function ensureNoDouyinCaptcha(ctx) {
  while (await hasDouyinCaptcha(ctx.page)) {
    await waitForCaptchaSolved(ctx);
  }
}

module.exports = {
  ensureNoDouyinCaptcha,
  hasDouyinCaptcha,
  waitForCaptchaSolved,
};
