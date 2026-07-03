'use strict';

const { ensureLoggedIn } = require('../../core/login-guard');
const { inspectAccountNameDom, readAccountName } = require('../xingtu-account');

const CREATOR_HOME_URL = 'https://www.xingtu.cn/ad/creator/index';
const LOGIN_URL = 'https://sso.oceanengine.com/xingtu/login?role=1';

function isXingtuCreatorUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://www.xingtu.cn' && parsed.pathname.startsWith('/ad/creator');
  } catch {
    return false;
  }
}

function isLoginUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'sso.oceanengine.com' || parsed.pathname.includes('/xingtu/login');
  } catch {
    return false;
  }
}

async function ensureXingtuLoggedIn(ctx) {
  return ensureLoggedIn(ctx, {
    homeUrl: CREATOR_HOME_URL,
    bootstrapUrl: LOGIN_URL,
    isLoginUrl,
    readAccount: readAccountName,
    inspectLoginState: inspectAccountNameDom,
    checkCurrentPageFirst: true,
    loginMessage: '当前星图账号未登录，请先进入账号后台完成登录',
    waitAfterBootstrapMs: 1800,
    waitAfterGotoMs: 1200,
    timeoutMs: 15000,
    attempts: 4,
    retryDelayMs: 1200,
  });
}

async function confirmXingtuSession(ctx) {
  return ensureLoggedIn(ctx, {
    homeUrl: CREATOR_HOME_URL,
    bootstrapUrl: LOGIN_URL,
    isLoginUrl,
    readAccount: readAccountName,
    inspectLoginState: inspectAccountNameDom,
    checkCurrentPageFirst: true,
    loginMessage: '当前星图账号未登录，请先进入账号后台完成登录',
    waitAfterBootstrapMs: 1800,
    waitAfterGotoMs: 1500,
    timeoutMs: 15000,
    attempts: 4,
    retryDelayMs: 1200,
  });
}

module.exports = {
  CREATOR_HOME_URL,
  LOGIN_URL,
  confirmXingtuSession,
  ensureXingtuLoggedIn,
  inspectAccountNameDom,
  isXingtuCreatorUrl,
  isLoginUrl,
  readAccountName,
};
