'use strict';

const { throwIfAborted, withAbort } = require('./abort');

async function ensureLoggedIn(ctx, options) {
  const {
    homeUrl,
    bootstrapUrl = '',
    isLoginUrl,
    readAccount,
    inspectLoginState,
    checkCurrentPageFirst = false,
    waitAfterGotoMs = 0,
    waitAfterBootstrapMs = 0,
    timeoutMs = 12000,
    attempts = 2,
    retryDelayMs = 800,
    loginMessage = '当前账号未登录，请先完成登录',
  } = options;
  const signal = ctx && ctx.task ? ctx.task.signal : null;

  if (checkCurrentPageFirst) {
    throwIfAborted(signal);
    ctx.log.info('优先检查当前页面登录态');
    const currentAccount = await withAbort(signal, readAccount(ctx.page, timeoutMs).catch(() => ''));
    if (currentAccount) {
      ctx.log.info(`当前页登录态已确认: ${currentAccount}`);
      return currentAccount;
    }
    if (isLoginUrl && isLoginUrl(ctx.page.url())) {
      ctx.log.warn('当前页面处于登录页，改为重新打开站点首页检查登录态');
    } else {
      ctx.log.info('当前页未读到登录态，继续走站点首页检查流程');
    }
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    throwIfAborted(signal);
    ctx.log.info(`打开站点首页，检查登录态（第 ${attempt}/${attempts} 次）`);
    if (attempt > 1) {
      await withAbort(signal, ctx.page.goto('about:blank', { waitUntil: 'load' }).catch(() => {}));
      if (retryDelayMs > 0) {
        await withAbort(signal, ctx.page.waitForTimeout(retryDelayMs));
      }
    }

    if (bootstrapUrl) {
      throwIfAborted(signal);
      ctx.log.info(`打开登录引导页，预热站点会话（第 ${attempt}/${attempts} 次）`);
      await withAbort(signal, ctx.page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded' }));
      await withAbort(signal, ctx.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}));
      if (waitAfterBootstrapMs > 0) {
        await withAbort(signal, ctx.page.waitForTimeout(waitAfterBootstrapMs));
      }

      const bootstrapAccount = await withAbort(signal, readAccount(ctx.page, timeoutMs).catch(() => ''));
      if (bootstrapAccount) {
        ctx.log.info(`登录态已在登录引导页确认: ${bootstrapAccount}`);
        return bootstrapAccount;
      }
    }

    throwIfAborted(signal);
    await withAbort(signal, ctx.page.goto(homeUrl, { waitUntil: 'domcontentloaded' }));
    await withAbort(signal, ctx.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}));
    if (waitAfterGotoMs > 0) {
      await withAbort(signal, ctx.page.waitForTimeout(waitAfterGotoMs));
    }

    const account = await withAbort(signal, readAccount(ctx.page, timeoutMs).catch(() => ''));
    if (account) {
      ctx.log.info(`登录态已确认: ${account}`);
      return account;
    }

    const onLoginUrl = Boolean(isLoginUrl && isLoginUrl(ctx.page.url()));
    if (attempt < attempts) {
      ctx.log.warn(onLoginUrl
        ? '首次打开进入登录页，准备重新打开站点重试登录态'
        : '首次打开未读取到登录态，准备重新打开站点重试');
      continue;
    }

    if (onLoginUrl) {
      throw new Error(loginMessage);
    }

    if (inspectLoginState) {
      const state = await withAbort(signal, inspectLoginState(ctx.page).catch(() => null));
      if (state) {
        throw new Error(`${loginMessage}。当前页面: ${ctx.page.url()}，状态: ${JSON.stringify(state).slice(0, 500)}`);
      }
    }
  }

  throw new Error(`${loginMessage}。当前页面: ${ctx.page.url()}`);
}

module.exports = {
  ensureLoggedIn,
};
