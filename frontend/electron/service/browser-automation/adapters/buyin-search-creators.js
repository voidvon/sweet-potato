'use strict';

const { createCreatorSearchAdapter } = require('./creator-adapter-factory');
const { DAREN_SQUARE_URL, ensureBuyinLoggedIn, isBuyinCreatorUrl } = require('./buyin/auth');
const { collectCurrentCreatorResultsPage, searchCreators } = require('./buyin/creator-square');

module.exports = createCreatorSearchAdapter({
  name: 'buyin-search-creators',
  site: 'buyin',
  initialUrl: DAREN_SQUARE_URL,
  isCreatorUrl: isBuyinCreatorUrl,
  ensureLoggedIn: ensureBuyinLoggedIn,
  collectCurrentCreatorResultsPage,
  searchCreators,
  snapshotPrefix: 'buyin-creator',
});
