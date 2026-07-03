'use strict';

const { createCreatorOpenProfileAdapter } = require('./creator-adapter-factory');
const { confirmDouyinSession, DOUYIN_HOME_URL, isDouyinUrl } = require('./douyin/auth');

module.exports = createCreatorOpenProfileAdapter({
  name: 'douyin-open-profile',
  site: 'douyin',
  initialUrl: DOUYIN_HOME_URL,
  isCreatorUrl: isDouyinUrl,
  confirmSession: confirmDouyinSession,
  openLogMessage: '打开抖音主页',
});
