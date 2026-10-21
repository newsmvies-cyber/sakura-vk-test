'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const history = require('../order-history-store.js');

function storageFixture() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    has(key) { return values.has(key); }
  };
}

function order(id, status = 'new') {
  return {
    id,
    createdAt: '2026-10-21T10:00:00.000Z',
    status,
    name: 'Test user',
    phone: '9000000000',
    fulfillment: 'pickup',
    address: 'Pickup point',
    slot: '12:00',
    payment: 'Наличными',
    persons: 1,
    items: [{ id: 'maki-cucumber', name: 'Огурец', quantity: 2, price: 90 }],
    total: 180,
    comment: 'must not be persisted',
    vkUserId: '999',
    legalEvents: [{ userId: '999' }]
  };
}

test('local history is isolated by VK account and survives app reinitialization', () => {
  const storage = storageFixture();
  const firstAccount = { id: '101' };
  const secondAccount = { id: '202' };
  assert.equal(history.save(storage, firstAccount, order('A-1')), true);
  assert.equal(history.save(storage, secondAccount, order('B-1')), true);

  // Re-reading from the same persistent storage simulates closing and reopening the app.
  assert.deepEqual(history.read(storage, firstAccount).map((item) => item.id), ['A-1']);
  assert.deepEqual(history.read(storage, secondAccount).map((item) => item.id), ['B-1']);
  assert.deepEqual(history.read(storage, { id: '303' }), []);
});

test('switching accounts never leaks one account history into the other', () => {
  const storage = storageFixture();
  history.save(storage, { id: '101' }, order('A-1'));
  history.save(storage, { id: '202' }, order('B-1'));
  assert.deepEqual(history.read(storage, { id: '202' }).map((item) => item.id), ['B-1']);
  assert.deepEqual(history.read(storage, { id: '101' }).map((item) => item.id), ['A-1']);
});

test('legacy unscoped history is cleared without changing scoped or server records', () => {
  const storage = storageFixture();
  storage.setItem('sakura-demo-orders', JSON.stringify([order('legacy')]));
  history.save(storage, { id: '101' }, order('server-backed'));
  assert.equal(storage.has('sakura-demo-orders'), false);
  assert.deepEqual(history.read(storage, { id: '101' }).map((item) => item.id), ['server-backed']);
});

test('server history takes precedence and duplicate IDs appear once', () => {
  const merged = history.merge([order('same', 'preparing'), order('server-only')], [order('same', 'new'), order('local-only')]);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((item) => item.id === 'same').status, 'preparing');
  assert.deepEqual(new Set(merged.map((item) => item.id)), new Set(['same', 'server-only', 'local-only']));
});

test('authorized server results are cached locally and remain after later server retention', () => {
  const storage = storageFixture();
  const identity = { id: '101' };
  const cached = history.cacheServerOrders(storage, identity, [order('server-1', 'completed')]);
  assert.deepEqual(cached.map((item) => item.id), ['server-1']);
  assert.deepEqual(history.merge([], history.read(storage, identity)).map((item) => item.id), ['server-1']);
});

test('local records keep only fields needed to display history', () => {
  const normalized = history.normalize(order('A-1'));
  assert.equal('comment' in normalized, false);
  assert.equal('vkUserId' in normalized, false);
  assert.equal('legalEvents' in normalized, false);
  assert.equal('price' in normalized.items[0], false);
});

test('server history still uses the VK launch authorization header', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /fetch\(base\+'\/orders',\{headers:vkAuthorizationHeaders\(\),cache:'no-store'\}\)/);
  assert.match(app, /window\.SakuraOrderHistoryStore\.merge\(/);
  assert.match(app, /window\.SakuraOrderHistoryStore\.cacheServerOrders\(localStorage,profileIdentity,serverOrders\)/);
  assert.doesNotMatch(app, /localStorage\.getItem\(['"]sakura-demo-orders['"]\)/);
});
