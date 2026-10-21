'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const profileStore = require('../profile-store.js');

function makeStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

function identity(id, firstName, lastName) {
  return profileStore.resolveIdentity(
    { id, first_name: firstName, last_name: lastName },
    '?vk_app_id=54834346&vk_user_id=' + id,
    '54834346'
  );
}

test('profile storage is isolated when the VK account changes', () => {
  const storage = makeStorage();
  const accountA = identity(1111, 'Анна', 'Иванова');
  const accountB = identity(2222, 'Борис', 'Петров');

  assert.equal(profileStore.save(storage, accountA.id, { name: 'Анна Иванова', phone: '+79990000001', address: 'Алексеевка, улица Первая, 1' }), true);
  assert.equal(profileStore.save(storage, accountB.id, { name: 'Борис Петров', phone: '+79990000002', address: 'Алексеевка, улица Вторая, 2' }), true);
  assert.deepEqual(profileStore.read(storage, accountA.id), { name: 'Анна Иванова', phone: '+79990000001', address: 'Алексеевка, улица Первая, 1' });
  assert.deepEqual(profileStore.read(storage, accountB.id), { name: 'Борис Петров', phone: '+79990000002', address: 'Алексеевка, улица Вторая, 2' });
});

test('saved profile remains available after reopening the app', () => {
  const storage = makeStorage();
  const account = identity(3333, 'Мария', 'Сидорова');
  profileStore.save(storage, account.id, { name: 'Маша С.', phone: '+79990000003', address: 'Алексеевка, улица Третья, 3' });

  const reopenedProfileStore = require('../profile-store.js');
  assert.deepEqual(reopenedProfileStore.read(storage, account.id), { name: 'Маша С.', phone: '+79990000003', address: 'Алексеевка, улица Третья, 3' });
});

test('identity is rejected when VK Bridge ID and launch parameters disagree', () => {
  assert.equal(profileStore.resolveIdentity(
    { id: 4444, first_name: 'Ирина', last_name: 'Смирнова' },
    '?vk_app_id=54834346&vk_user_id=5555',
    '54834346'
  ), null);
  assert.equal(profileStore.resolveIdentity(
    { id: 4444 },
    '?vk_app_id=1&vk_user_id=4444',
    '54834346'
  ), null);
});

test('name, phone, and delivery address are persisted; the legacy shared key is not read', () => {
  const storage = makeStorage();
  storage.setItem('sakura-profile', JSON.stringify({ name: 'Legacy', phone: '+70000000000', email: 'old@example.test', birthday: '1990-01-01' }));
  const account = identity(6666, 'Елена', 'Кузнецова');

  profileStore.save(storage, account.id, { name: 'Елена Кузнецова', phone: '+79990000004', address: 'Алексеевка, улица Четвёртая, 4', email: 'new@example.test', birthday: '1990-01-01' });
  const saved = JSON.parse(storage.getItem(profileStore.storageKey(account.id)));
  assert.deepEqual(saved, { name: 'Елена Кузнецова', phone: '+79990000004', address: 'Алексеевка, улица Четвёртая, 4' });
  assert.deepEqual(profileStore.read(storage, account.id), { name: 'Елена Кузнецова', phone: '+79990000004', address: 'Алексеевка, улица Четвёртая, 4' });
  assert.equal(storage.getItem('sakura-profile'), JSON.stringify({ name: 'Legacy', phone: '+70000000000', email: 'old@example.test', birthday: '1990-01-01' }));
});

test('old account profiles remain readable and explicit address clearing is saved', () => {
  const storage = makeStorage();
  const account = identity(7777, 'Ольга', 'Николаева');
  storage.setItem(profileStore.storageKey(account.id), JSON.stringify({ name: 'Ольга', phone: '+79990000007' }));
  assert.deepEqual(profileStore.read(storage, account.id), { name: 'Ольга', phone: '+79990000007', address: '' });

  profileStore.save(storage, account.id, { name: 'Ольга', phone: '+79990000007', address: 'Алексеевка, улица Пятая, 5' });
  profileStore.save(storage, account.id, { name: 'Ольга', phone: '+79990000007' });
  assert.equal(profileStore.read(storage, account.id).address, 'Алексеевка, улица Пятая, 5');
  profileStore.save(storage, account.id, { name: 'Ольга', phone: '+79990000007', address: '' });
  assert.equal(profileStore.read(storage, account.id).address, '');
});

test('phone is requested only through the VK Bridge method and signature is discarded', async () => {
  let calls = 0;
  const bridge = {
    supports(method) { return method === 'VKWebAppGetPhoneNumber'; },
    async send(method) {
      calls += 1;
      assert.equal(method, 'VKWebAppGetPhoneNumber');
      return { phone_number: '+79990000005', sign: 'must-not-be-stored' };
    }
  };

  assert.deepEqual(await profileStore.requestPhoneNumber(bridge), { supported: true, phone: '+79990000005' });
  assert.equal(calls, 1);
  assert.deepEqual(await profileStore.requestPhoneNumber({ supports: () => false, send: () => { throw new Error('not supported'); } }), { supported: false, phone: '' });
});


test('phone permission denial keeps manual entry path available', async () => {
  const result = await profileStore.requestPhoneNumber({
    supports: () => true,
    async send() { throw new Error('user_denied'); }
  });
  assert.deepEqual(result, { supported: false, phone: '' });
});
