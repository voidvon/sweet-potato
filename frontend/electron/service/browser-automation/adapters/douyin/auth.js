'use strict';

const { ensureLoggedIn } = require('../../core/login-guard');
const {
  inspectAccountNameDom,
  isGenericLoggedInSentinel,
  readAccountName,
  readSessionAccount,
} = require('./account');

const DOUYIN_HOME_URL = 'https://www.douyin.com/';

function isDouyinUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.origin === 'https://www.douyin.com';
  } catch {
    return false;
  }
}

function isLoginUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    return /login|passport|oauth|authorize/i.test(parsed.pathname)
      || /login|passport|oauth|authorize/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function ensureDouyinLoggedIn(ctx) {
  const account = await ensureLoggedIn(ctx, {
    homeUrl: DOUYIN_HOME_URL,
    isLoginUrl,
    readAccount: readSessionAccount,
    inspectLoginState: inspectAccountNameDom,
    checkCurrentPageFirst: true,
    loginMessage: '当前抖音账号未登录，请先在抖音主页完成登录',
    waitAfterGotoMs: 1500,
    timeoutMs: 20000,
    attempts: 4,
    retryDelayMs: 1200,
  });

  if (isGenericLoggedInSentinel(account)) {
    return '';
  }

  return account;
}

async function confirmDouyinSession(ctx) {
  const account = await ensureLoggedIn(ctx, {
    homeUrl: DOUYIN_HOME_URL,
    isLoginUrl,
    readAccount: readSessionAccount,
    inspectLoginState: inspectAccountNameDom,
    checkCurrentPageFirst: true,
    loginMessage: '当前抖音账号未登录，请先在抖音主页完成登录',
    waitAfterGotoMs: 1800,
    timeoutMs: 20000,
    attempts: 4,
    retryDelayMs: 1200,
  });

  if (isGenericLoggedInSentinel(account)) {
    return await readAccountName(ctx.page, 5000).catch(() => '');
  }

  return account;
}

module.exports = {
  DOUYIN_HOME_URL,
  confirmDouyinSession,
  ensureDouyinLoggedIn,
  inspectAccountNameDom,
  isDouyinUrl,
  isLoginUrl,
  readAccountName,
};
