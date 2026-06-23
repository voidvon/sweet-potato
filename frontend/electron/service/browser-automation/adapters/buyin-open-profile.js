'use strict';

const { createCreatorOpenProfileAdapter } = require('./creator-adapter-factory');
const { DAREN_SQUARE_URL, confirmBuyinSession, isBuyinCreatorUrl } = require('./buyin/auth');

module.exports = createCreatorOpenProfileAdapter({
  name: 'buyin-open-profile',
  site: 'buyin',
  initialUrl: DAREN_SQUARE_URL,
  isCreatorUrl: isBuyinCreatorUrl,
  confirmSession: confirmBuyinSession,
  openLogMessage: '打开精选联盟达人广场',
});
