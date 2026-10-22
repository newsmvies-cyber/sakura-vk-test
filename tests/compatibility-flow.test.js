'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../backend/catalog.json');
const flow = require('../request-flow.js');
const profile = require('../profile-store.js');
const history = require('../order-history-store.js');
const { createHandler, cleanExpiredOrders } = require('../backend');
const { RETENTION_MS } = require('../backend/order-lifecycle');

class MemoryYdb {
  constructor() { this.orders = new Map(); }
  async withDb(callback) {
    const sql = async (parts, ...values) => {
      const statement = parts.join(' ? ').replace(/\s+/g, ' ').trim();
      if (statement.startsWith('UPSERT INTO orders')) {
        const [id, createdAt, status, payload] = values;
        this.orders.set(id, { id, created_at: createdAt, status, payload });
        return [];
      }
      if (statement.startsWith('SELECT id, payload FROM orders WHERE id >')) {
        const [cursorId] = values;
        return [[...this.orders.values()].filter((row) => row.id > cursorId).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 500).map(({ id, payload }) => ({ id, payload }))];
      }
      if (statement.startsWith('SELECT payload FROM orders WHERE id =')) {
        const row = this.orders.get(values[0]);
        return [row ? [{ payload: row.payload }] : []];
      }
      if (statement.startsWith('SELECT id, payload FROM orders ORDER BY')) {
        return [[...this.orders.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200).map(({ id, payload }) => ({ id, payload }))];
      }
      if (statement.startsWith('SELECT id, status, payload FROM orders WHERE id >')) {
        const [cursorId] = values;
        return [[...this.orders.values()].filter((row) => row.id > cursorId && ['done', 'cancelled'].includes(row.status)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, 500).map(({ id, status, payload }) => ({ id, status, payload }))];
      }
      if (statement.startsWith('UPDATE orders SET status =')) {
        const [status, payload, id, oldStatus, oldPayload] = values;
        const row = this.orders.get(id);
        if (row && row.status === oldStatus && row.payload === oldPayload) this.orders.set(id, { ...row, status, payload });
        return [];
      }
      if (statement.startsWith('UPDATE orders SET payload =')) {
        const [payload, id, status, oldPayload] = values;
        const row = this.orders.get(id);
        if (row && row.status === status && row.payload === oldPayload) this.orders.set(id, { ...row, payload });
        return [];
      }
      if (statement.startsWith('DELETE FROM orders WHERE id =')) {
        const [id, status, payload] = values;
        const row = this.orders.get(id);
        if (row && row.status === status && row.payload === payload) this.orders.delete(id);
        return [];
      }
      throw new Error(`Unexpected mock YDB query: ${statement}`);
    };
    return callback(sql);
  }
}

function event(method, path, body, userId) {
  return { httpMethod: method, path, headers: { authorization: 'Bearer mock-vk-launch' }, body: body == null ? '' : JSON.stringify(body), mockUserId: userId };
}

async function result(response) {
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

test('mocked end-to-end request, admin lifecycle, local history, and 48-hour cleanup', async () => {
  const db = new MemoryYdb();
  let now = new Date('2026-10-21T08:00:00.000Z');
  const handler = createHandler({
    withDb: db.withDb.bind(db),
    requestIdentity: (req) => req.headers.authorization === 'Bearer mock-vk-launch' ? { userId: req.mockUserId } : null,
    isAdmin: (id) => id === 'staff',
    env: { ORDERS_ENABLED: 'true', ORDERS_TEST_ONLY: 'false' },
    now: () => new Date(now)
  });

  const identity = profile.resolveIdentity(
    { id: '12345', first_name: 'Тест', last_name: 'Клиент' },
    '?vk_app_id=54834346&vk_user_id=12345',
    '54834346'
  );
  assert.ok(identity);
  const storageMap = new Map();
  const storage = {
    getItem(key) { return storageMap.get(key) || null; },
    setItem(key, value) { storageMap.set(key, String(value)); },
    removeItem(key) { storageMap.delete(key); }
  };
  const deliveryAddress = 'Алексеевка, улица Тестовая, 10';
  assert.equal(profile.save(storage, identity.id, { name: identity.fullName, phone: '+79000000000', address: deliveryAddress }), true);
  assert.deepEqual(profile.read(storage, identity.id), { name: 'Тест Клиент', phone: '+79000000000', address: deliveryAddress });

  const firstProductId = Object.keys(catalog)[0];
  const firstProduct = catalog[firstProductId];
  const submitted = flow.legalAcknowledgement({
    status: 'new', name: 'Тест Клиент', phone: '+79000000000', fulfillment: 'delivery', address: profile.read(storage, identity.id).address,
    items: [{ id: firstProductId, quantity: 1 }], payment: 'Наличными', notifyStatus: true,
    slot: '12:00', persons: 1, comment: '', total: firstProduct.price
  }, { offerAccepted: true });
  assert.equal(submitted.offerAccepted, true);
  assert.equal(submitted.offerVersion, 'offer-draft-2026-10-20-v1');
  assert.equal(submitted.statusConsentVersion, 'status-consent-draft-2026-10-20-v1');

  const sent = await flow.dispatch(submitted, async (payload) => {
    const response = await handler(event('POST', '/orders', payload, identity.id));
    const body = await result(response);
    assert.equal(body.status, 201);
    return { orderId: body.body.orderId };
  });
  assert.equal(sent.sent, true);
  const orderId = sent.orderId;
  assert.equal(db.orders.get(orderId).payload.includes(deliveryAddress), true);
  const localCopy = { ...submitted, id: orderId, items: [{ id: firstProductId, name: firstProduct.name, quantity: 1 }] };
  assert.equal(history.save(storage, identity, localCopy), true);

  const customerView = await result(await handler(event('GET', '/orders', null, identity.id)));
  assert.equal(customerView.status, 200);
  assert.equal(customerView.body.orders.length, 1);
  history.cacheServerOrders(storage, identity, customerView.body.orders);
  assert.equal(history.merge(customerView.body.orders, history.read(storage, identity)).length, 1);

  const adminView = await result(await handler(event('GET', '/admin/orders', null, 'staff')));
  assert.equal(adminView.status, 200);
  assert.equal(adminView.body.orders[0].status, 'new');
  const accepted = await result(await handler(event('PATCH', `/admin/orders/${orderId}/status`, { status: 'accepted' }, 'staff')));
  assert.equal(accepted.status, 200);
  const preparing = await result(await handler(event('PATCH', `/admin/orders/${orderId}/status`, { status: 'preparing' }, 'staff')));
  assert.equal(preparing.status, 200);
  const done = await result(await handler(event('PATCH', `/admin/orders/${orderId}/status`, { status: 'done' }, 'staff')));
  assert.equal(done.status, 200);
  const finalCustomerView = await result(await handler(event('GET', '/orders', null, identity.id)));
  history.cacheServerOrders(storage, identity, finalCustomerView.body.orders);
  now = new Date(now.getTime() + RETENTION_MS);
  const cleaned = await cleanExpiredOrders(db.withDb.bind(db), now);
  assert.equal(cleaned.removed, 1);

  const afterCleanup = await result(await handler(event('GET', '/orders', null, identity.id)));
  assert.deepEqual(afterCleanup.body.orders, []);
  const retainedLocal = history.merge(afterCleanup.body.orders, history.read(storage, identity));
  assert.equal(retainedLocal.length, 1);
  assert.equal(retainedLocal[0].status, 'done');
  assert.equal(db.orders.has(orderId), false);
});

test('cancelled is an available admin action and both terminal statuses lock the selector', () => {
  const active = flow.adminStatuses('delivery', 'new');
  assert.equal(active.find((item) => item.api === 'cancelled').disabled, false);
  for (const status of ['done', 'cancelled']) assert.ok(flow.adminStatuses('delivery', status).every((item) => item.disabled));
});
