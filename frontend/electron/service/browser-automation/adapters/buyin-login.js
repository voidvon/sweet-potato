'use strict';

const { createCreatorLoginAdapter } = require('./creator-adapter-factory');
const { DAREN_SQUARE_URL, confirmBuyinSession, isBuyinCreatorUrl, readAccountName } = require('./buyin/auth');

module.exports = createCreatorLoginAdapter({
  name: 'buyin-login',
  site: 'buyin',
  initialUrl: DAREN_SQUARE_URL,
  targetUrl: DAREN_SQUARE_URL,
  isCreatorUrl: isBuyinCreatorUrl,
  isTargetUrl: isBuyinCreatorUrl,
  readAccountName,
  confirmSession: confirmBuyinSession,
  openLogMessage: '打开精选联盟达人广场',
  waitLogMessage: `等待登录成功并进入: ${DAREN_SQUARE_URL}`,
  readLogMessage: '读取精选联盟账号昵称',
  missingAccountMessage: '未读取到精选联盟账号昵称',
});
