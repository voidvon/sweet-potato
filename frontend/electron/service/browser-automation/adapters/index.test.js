'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getAdapter, listAdapters } = require('./index');

test('registers buyin automation adapters', () => {
  const adapterNames = listAdapters();
  assert.ok(adapterNames.includes('buyin-login'));
  assert.ok(adapterNames.includes('buyin-open-profile'));
  assert.ok(adapterNames.includes('buyin-search-creators'));
  assert.ok(adapterNames.includes('douyin-login'));
  assert.ok(adapterNames.includes('douyin-open-profile'));
  assert.ok(adapterNames.includes('douyin-open-search'));
  assert.ok(adapterNames.includes('douyin-connect-creators'));

  const openProfileAdapter = getAdapter('buyin-open-profile');
  assert.ok(openProfileAdapter);
  assert.equal(openProfileAdapter.name, 'buyin-open-profile');

  const douyinLoginAdapter = getAdapter('douyin-login');
  assert.ok(douyinLoginAdapter);
  assert.equal(douyinLoginAdapter.name, 'douyin-login');

  const douyinOpenProfileAdapter = getAdapter('douyin-open-profile');
  assert.ok(douyinOpenProfileAdapter);
  assert.equal(douyinOpenProfileAdapter.name, 'douyin-open-profile');

  const douyinAdapter = getAdapter('douyin-open-search');
  assert.ok(douyinAdapter);
  assert.equal(douyinAdapter.name, 'douyin-open-search');

  const douyinConnectAdapter = getAdapter('douyin-connect-creators');
  assert.ok(douyinConnectAdapter);
  assert.equal(douyinConnectAdapter.name, 'douyin-connect-creators');
});
