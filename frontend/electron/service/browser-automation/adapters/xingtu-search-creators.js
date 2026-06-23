'use strict';

const { createCreatorSearchAdapter } = require('./creator-adapter-factory');
const { CREATOR_HOME_URL, ensureXingtuLoggedIn, isXingtuCreatorUrl } = require('./xingtu/auth');
const { collectCurrentCreatorResultsPage, searchCreators } = require('./xingtu/creator-market');

module.exports = createCreatorSearchAdapter({
  name: 'xingtu-search-creators',
  site: 'xingtu',
  initialUrl: CREATOR_HOME_URL,
  isCreatorUrl: isXingtuCreatorUrl,
  ensureLoggedIn: ensureXingtuLoggedIn,
  collectCurrentCreatorResultsPage,
  searchCreators,
  snapshotPrefix: 'xingtu-creator',
});
