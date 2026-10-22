'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const permission = require('../message-permission.js');

function makeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test('requests native VK message permission once per verified account', async () => {
  const storage = makeStorage();
  let calls = 0;
  const bridge = { send: async (method, payload) => { calls++; assert.equal(method, 'VKWebAppAllowMessagesFromGroup'); assert.deepEqual(payload, { group_id: 242422490 }); return { result: true }; } };
  assert.deepEqual(await permission.requestOnce(bridge, storage, '12345', 242422490), { requested: true, allowed: true });
  assert.deepEqual(await permission.requestOnce(bridge, storage, '12345', 242422490), { requested: false, reason: 'already-requested' });
  assert.deepEqual(await permission.requestOnce(bridge, storage, '67890', 242422490), { requested: true, allowed: true });
  assert.equal(calls, 2);
});

test('does not prompt without a verified VK ID or supported Bridge method', async () => {
  const storage = makeStorage();
  let calls = 0;
  const bridge = { send: async () => { calls++; }, supports: () => false };
  assert.equal((await permission.requestOnce(bridge, storage, 'not-an-id', 242422490)).reason, 'unverified-user');
  assert.equal((await permission.requestOnce(bridge, storage, '12345', 242422490)).reason, 'method-unavailable');
  assert.equal(calls, 0);
});

test('records a declined native prompt so app launch does not repeatedly interrupt the user', async () => {
  const storage = makeStorage();
  let calls = 0;
  const bridge = { send: async () => { calls++; throw new Error('user denied'); } };
  assert.deepEqual(await permission.requestOnce(bridge, storage, '12345', 242422490), { requested: true, allowed: false });
  assert.deepEqual(await permission.requestOnce(bridge, storage, '12345', 242422490), { requested: false, reason: 'already-requested' });
  assert.equal(calls, 1);
});

test('restores the displayed permission state separately for each VK account', () => {
  const storage = makeStorage();
  permission.markAttempt(storage, '12345', 'allowed');
  permission.markAttempt(storage, '67890', 'not-allowed');
  assert.equal(permission.getOutcome(storage, '12345'), 'allowed');
  assert.equal(permission.getOutcome(storage, '67890'), 'not-allowed');
  assert.equal(permission.getOutcome(storage, '99999'), '');
});
