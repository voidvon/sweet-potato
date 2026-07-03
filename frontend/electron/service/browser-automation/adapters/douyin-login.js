'use strict';

const { confirmDouyinSession, DOUYIN_HOME_URL, isDouyinUrl, readAccountName } = require('./douyin/auth');

module.exports = {
  name: 'douyin-login',
  site: 'douyin',
  initialUrl: DOUYIN_HOME_URL,
  closeWindowOnDone: true,
  closeWindowOnCancel: true,
  closeWindowOnFailure: true,
  windowOptions: {
    backgroundThrottling: false,
    reuseExistingWindowWhen: isDouyinUrl,
    keepWindowOpenWhen: isDouyinUrl,
    restoreFocusToMain: true,
  },

  async run(ctx) {
    ctx.log.info('打开抖音主页，等待账号完成登录');
    await ctx.page.goto(DOUYIN_HOME_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await ctx.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await ctx.page.waitForTimeout(1200).catch(() => {});

    ctx.log.info('读取抖音账号名称');
    const nickname = await readAccountName(ctx.page, 180000);
    if (!nickname) {
      ctx.log.warn('未及时读取到抖音账号昵称，继续确认会话是否已写入 Profile');
    }

    ctx.log.info('刷新抖音主页，确认登录态已稳定写入 Profile');
    const stableNickname = await confirmDouyinSession(ctx);
    if (!stableNickname && !nickname) {
      throw new Error('未读取到抖音账号名称，请确认已在窗口中完成登录');
    }

    return {
      loggedIn: true,
      nickname: stableNickname || nickname,
      url: ctx.page.url(),
    };
  },
};
