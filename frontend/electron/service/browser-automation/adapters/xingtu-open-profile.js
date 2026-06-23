'use strict';

const { createCreatorOpenProfileAdapter } = require('./creator-adapter-factory');
const { CREATOR_HOME_URL, confirmXingtuSession, isXingtuCreatorUrl } = require('./xingtu/auth');

module.exports = createCreatorOpenProfileAdapter({
  name: 'xingtu-open-profile',
  site: 'xingtu',
  initialUrl: CREATOR_HOME_URL,
  isCreatorUrl: isXingtuCreatorUrl,
  confirmSession: confirmXingtuSession,
  openLogMessage: '打开星图达人后台',
});
