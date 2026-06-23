'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getAdapter, listAdapters } = require('./index');

test('registers buyin automation adapters', () => {
  const adapterNames = listAdapters();
  assert.ok(adapterNames.includes('buyin-login'));
  assert.ok(adapterNames.includes('buyin-open-profile'));
  assert.ok(adapterNames.includes('buyin-search-creators'));

  const openProfileAdapter = getAdapter('buyin-open-profile');
  assert.ok(openProfileAdapter);
  assert.equal(openProfileAdapter.name, 'buyin-open-profile');
});
