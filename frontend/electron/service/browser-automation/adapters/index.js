'use strict';

const xingtuLogin = require('./xingtu-login');
const xingtuOpenProfile = require('./xingtu-open-profile');
const xingtuSearchCreators = require('./xingtu-search-creators');
const buyinLogin = require('./buyin-login');
const buyinOpenProfile = require('./buyin-open-profile');
const buyinSearchCreators = require('./buyin-search-creators');

const adapters = new Map([
  [xingtuLogin.name, xingtuLogin],
  [xingtuOpenProfile.name, xingtuOpenProfile],
  [xingtuSearchCreators.name, xingtuSearchCreators],
  [buyinLogin.name, buyinLogin],
  [buyinOpenProfile.name, buyinOpenProfile],
  [buyinSearchCreators.name, buyinSearchCreators],
]);

function getAdapter(name) {
  return adapters.get(name);
}

function listAdapters() {
  return Array.from(adapters.keys());
}

module.exports = {
  getAdapter,
  listAdapters,
};
