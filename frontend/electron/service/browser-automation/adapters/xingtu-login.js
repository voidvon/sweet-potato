'use strict';

const { createCreatorLoginAdapter } = require('./creator-adapter-factory');
const { CREATOR_HOME_URL, LOGIN_URL, confirmXingtuSession, isXingtuCreatorUrl } = require('./xingtu/auth');
const { readAccountName } = require('./xingtu-account');

function isCreatorHome(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://www.xingtu.cn' && parsed.pathname === '/ad/creator/index';
  } catch {
    return false;
  }
}

module.exports = createCreatorLoginAdapter({
  name: 'xingtu-login',
  site: 'xingtu',
  initialUrl: LOGIN_URL,
  targetUrl: CREATOR_HOME_URL,
  isCreatorUrl: isXingtuCreatorUrl,
  isTargetUrl: isCreatorHome,
  readAccountName,
  confirmSession: confirmXingtuSession,
  openLogMessage: '打开巨量星图登录页',
  waitLogMessage: `等待登录成功并跳转到: ${CREATOR_HOME_URL}`,
  readLogMessage: '读取星图账号昵称',
  missingAccountMessage: '未读取到星图账号昵称',
  stabilizeLogMessage: '刷新星图首页，确认登录态已稳定写入 Profile',
});
