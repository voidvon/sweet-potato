'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const authModulePath = path.resolve(__dirname, 'auth.js');
const loginGuardModulePath = path.resolve(__dirname, '../../core/login-guard.js');
const accountModulePath = path.resolve(__dirname, '../xingtu-account.js');

function restoreModule(modulePath, previous) {
  if (previous) {
    require.cache[modulePath] = previous;
    return;
  }
  delete require.cache[modulePath];
}

function loadAuthModule(stubs = {}) {
  const previous = {
    auth: require.cache[authModulePath],
    loginGuard: require.cache[loginGuardModulePath],
    account: require.cache[accountModulePath],
  };

  delete require.cache[authModulePath];
  require.cache[loginGuardModulePath] = {
    id: loginGuardModulePath,
    filename: loginGuardModulePath,
    loaded: true,
    exports: {
      ensureLoggedIn: stubs.ensureLoggedIn,
    },
  };
  require.cache[accountModulePath] = {
    id: accountModulePath,
    filename: accountModulePath,
    loaded: true,
    exports: {
      inspectAccountNameDom: stubs.inspectAccountNameDom,
      readAccountName: stubs.readAccountName,
    },
  };

  const auth = require(authModulePath);
  return {
    auth,
    restore() {
      restoreModule(authModulePath, previous.auth);
      restoreModule(loginGuardModulePath, previous.loginGuard);
      restoreModule(accountModulePath, previous.account);
    },
  };
}

test('ensureXingtuLoggedIn uses stronger retry and settle configuration', async () => {
  let receivedOptions = null;
  const readAccountName = async () => 'demo-account';
  const inspectAccountNameDom = async () => ({ visibleTexts: ['demo-account'] });
  const ensureLoggedIn = async (_ctx, options) => {
    receivedOptions = options;
    return 'demo-account';
  };

  const { auth, restore } = loadAuthModule({
    ensureLoggedIn,
    inspectAccountNameDom,
    readAccountName,
  });

  try {
    const result = await auth.ensureXingtuLoggedIn({ page: {} });
    assert.equal(result, 'demo-account');
    assert.equal(receivedOptions.homeUrl, 'https://www.xingtu.cn/ad/creator/index');
    assert.equal(receivedOptions.bootstrapUrl, 'https://sso.oceanengine.com/xingtu/login?role=1');
    assert.equal(receivedOptions.checkCurrentPageFirst, true);
    assert.equal(receivedOptions.waitAfterBootstrapMs, 1800);
    assert.equal(receivedOptions.waitAfterGotoMs, 1200);
    assert.equal(receivedOptions.timeoutMs, 15000);
    assert.equal(receivedOptions.attempts, 4);
    assert.equal(receivedOptions.retryDelayMs, 1200);
    assert.equal(receivedOptions.readAccount, readAccountName);
    assert.equal(receivedOptions.inspectLoginState, inspectAccountNameDom);
  } finally {
    restore();
  }
});

test('confirmXingtuSession forces a fresh home-page confirmation', async () => {
  let receivedOptions = null;
  const ensureLoggedIn = async (_ctx, options) => {
    receivedOptions = options;
    return 'stable-account';
  };

  const { auth, restore } = loadAuthModule({
    ensureLoggedIn,
    inspectAccountNameDom: async () => ({ visibleTexts: ['stable-account'] }),
    readAccountName: async () => 'stable-account',
  });

  try {
    const result = await auth.confirmXingtuSession({ page: {} });
    assert.equal(result, 'stable-account');
    assert.equal(receivedOptions.bootstrapUrl, 'https://sso.oceanengine.com/xingtu/login?role=1');
    assert.equal(receivedOptions.checkCurrentPageFirst, false);
    assert.equal(receivedOptions.waitAfterBootstrapMs, 1800);
    assert.equal(receivedOptions.waitAfterGotoMs, 1500);
    assert.equal(receivedOptions.timeoutMs, 15000);
    assert.equal(receivedOptions.attempts, 4);
    assert.equal(receivedOptions.retryDelayMs, 1200);
  } finally {
    restore();
  }
});
