'use strict';

const { ensureLoggedIn } = require('../../core/login-guard');
const { inspectAccountNameDom, readAccountName } = require('./account');

const DAREN_SQUARE_URL = 'https://buyin.jinritemai.com/dashboard/servicehall/daren-square';

function isBuyinCreatorUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://buyin.jinritemai.com'
      && parsed.pathname.startsWith('/dashboard/servicehall');
  } catch {
    return false;
  }
}

function isLoginUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)login\.|(^|\.)sso\.|passport|oauth|authorize/i.test(parsed.hostname)
      || /login|passport|oauth|authorize/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function ensureBuyinLoggedIn(ctx) {
  return ensureLoggedIn(ctx, {
    homeUrl: DAREN_SQUARE_URL,
    isLoginUrl,
    readAccount: readAccountName,
    inspectLoginState: inspectAccountNameDom,
    checkCurrentPageFirst: true,
    loginMessage: '当前精选联盟账号未登录，请先进入账号后台完成登录',
    waitAfterGotoMs: 1500,
    timeoutMs: 15000,
    attempts: 4,
    retryDelayMs: 1200,
  });
}

async function confirmBuyinSession(ctx) {
  return ensureLoggedIn(ctx, {
    homeUrl: DAREN_SQUARE_URL,
    isLoginUrl,
    readAccount: readAccountName,
    inspectLoginState: inspectAccountNameDom,
    checkCurrentPageFirst: true,
    loginMessage: '当前精选联盟账号未登录，请先进入账号后台完成登录',
    waitAfterGotoMs: 1500,
    timeoutMs: 15000,
    attempts: 4,
    retryDelayMs: 1200,
  });
}

module.exports = {
  DAREN_SQUARE_URL,
  confirmBuyinSession,
  ensureBuyinLoggedIn,
  inspectAccountNameDom,
  isBuyinCreatorUrl,
  isLoginUrl,
  readAccountName,
};
