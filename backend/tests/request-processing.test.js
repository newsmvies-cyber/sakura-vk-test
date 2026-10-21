'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../catalog.json');
const { createHandler, cleanExpiredOrders, verifyLaunchParams, isAdmin } = require('../index');
const { createHmac } = require('node:crypto');
const cleanupHandler = require('../cleanup').handler;
const { cleanupDecision, RETENTION_MS } = require('../order-lifecycle');

class MockYdb {
  constructor() { this.orders = new Map(); }

  async withDb(callback) {
    const sql = async (parts, ...values) => {
      const statement = parts.join(' ? ').replace(/\s+/g, ' ').trim();
      if (statement.startsWith('UPSERT INTO orders')) {
        const [id, createdAt, status, payload] = values;
        this.orders.set(id, { id, created_at: createdAt, status, payload });
        return [];
      }
      if (statement.startsWith('SELECT payload FROM orders WHERE id =')) {
        const row = this.orders.get(values[0]);
        return [row ? [{ payload: row.payload }] : []];
      }
      if (statement.startsWith('SELECT payload FROM orders ORDER BY')) {
        return [[...this.orders.values()].map(({ payload }) => ({ payload }))];
      }
      if (statement.startsWith('SELECT id, status, payload FROM orders WHERE id >')) {
        const [cursorId] = values;
        const rows = [...this.orders.values()]
          .filter((row) => ['done', 'cancelled'].includes(row.status))
          .filter((row) => row.id > cursorId)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, 500)
          .map(({ id, status, payload }) => ({ id, status, payload }));
        return [rows];
      }
      if (statement.startsWith('SELECT id, payload FROM orders WHERE id >')) {
        const [cursorId] = values;
        const rows = [...this.orders.values()]
          .filter((row) => row.id > cursorId)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, 500)
          .map(({ id, payload }) => ({ id, payload }));
        return [rows];
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
      throw new Error(`Unexpected mock query: ${statement}`);
    };
    return callback(sql);
  }
}

function setup() {
  const db = new MockYdb();
  const handler = createHandler({
    withDb: db.withDb.bind(db),
    requestIdentity: (event) => event.headers?.authorization === 'Bearer fixture' ? { userId: event.fixtureUser || 'staff' } : null,
    isAdmin: (id) => id === 'staff',
    env: { ORDERS_ENABLED: 'true', ORDERS_TEST_ONLY: 'false' },
    now: () => new Date('2026-10-21T09:00:00.000Z')
  });
  return { db, handler };
}

function request(method, path, body, identity = 'staff') {
  return { httpMethod: method, path, headers: { authorization: 'Bearer fixture' }, fixtureUser: identity, body: JSON.stringify(body || {}) };
}

async function jsonResponse(result) { return { status: result.statusCode, body: JSON.parse(result.body) }; }

test('new request is persisted with legacy new status and only receipt payments', async () => {
  const { db, handler } = setup();
  const itemId = Object.keys(catalog)[0];
  const base = { name: 'Тест', phone: '+7 900 000-00-00', fulfillment: 'pickup', items: [{ id: itemId, quantity: 1 }], payment: 'Наличными', offerAccepted: true, offerVersion: 'offer-draft-2026-10-20-v1' };
  const ok = await jsonResponse(await handler(request('POST', '/orders', base)));
  assert.equal(ok.status, 201);
  const saved = JSON.parse(db.orders.get(ok.body.orderId).payload);
  assert.equal(saved.status, 'new');
  assert.equal(saved.completedAt, undefined);

  const transfer = await jsonResponse(await handler(request('POST', '/orders', { ...base, payment: 'Переводом после подтверждения' })));
  assert.equal(transfer.status, 400);
  assert.equal(db.orders.size, 1);
});

test('only an administrator may change statuses or read the admin list', async () => {
  const { db, handler } = setup();
  db.orders.set('foreign', { id: 'foreign', status: 'new', created_at: '2026-10-21', payload: JSON.stringify({ id: 'foreign', status: 'new', vkUserId: 'someone-else' }) });
  const denied = await jsonResponse(await handler(request('PATCH', '/admin/orders/SK-1/status', { status: 'accepted' }, 'customer')));
  assert.equal(denied.status, 403);
  const listDenied = await jsonResponse(await handler(request('GET', '/admin/orders', null, 'customer')));
  assert.equal(listDenied.status, 403);
  const ownOrders = await jsonResponse(await handler(request('GET', '/orders', null, 'customer')));
  assert.deepEqual(ownOrders.body.orders, []);
  const csvRoute = await jsonResponse(await handler(request('GET', '/admin/orders/export.csv', null, 'customer')));
  assert.equal(csvRoute.status, 403);
});

test('customer history is filtered by verified identity across database pages', async () => {
  const { db, handler } = setup();
  for (let index = 0; index < 505; index += 1) {
    const id = `order-${String(index).padStart(4, '0')}`;
    const owner = index === 0 ? 'customer' : 'other-customer';
    const order = { id, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), status: 'new', vkUserId: owner };
    db.orders.set(id, { id, status: order.status, created_at: order.createdAt, payload: JSON.stringify(order) });
  }
  const result = await jsonResponse(await handler(request('GET', '/orders', null, 'customer')));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.orders.map((item) => item.id), ['order-0000']);
});

test('server accepts only signed VK identity and checks admin allowlist against that identity', () => {
  const previousSecret = process.env.VK_APP_SECRET;
  const previousAdmins = process.env.ADMIN_VK_USER_IDS;
  process.env.VK_APP_SECRET = 'test-only-fixture-secret';
  process.env.ADMIN_VK_USER_IDS = '123';
  try {
    const fields = { vk_app_id: '54834346', vk_user_id: '123', vk_ts: String(Math.floor(Date.now() / 1000)), vk_platform: 'web' };
    const signed = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
    fields.sign = createHmac('sha256', process.env.VK_APP_SECRET).update(signed).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=$/, '');
    const launchParams = new URLSearchParams(fields).toString();
    assert.deepEqual(verifyLaunchParams(launchParams), { userId: '123' });
    assert.equal(isAdmin('123'), true);
    assert.equal(isAdmin('456'), false);
    assert.equal(verifyLaunchParams(launchParams.replace('vk_user_id=123', 'vk_user_id=456')), null);
  } finally {
    if (previousSecret === undefined) delete process.env.VK_APP_SECRET;
    else process.env.VK_APP_SECRET = previousSecret;
    if (previousAdmins === undefined) delete process.env.ADMIN_VK_USER_IDS;
    else process.env.ADMIN_VK_USER_IDS = previousAdmins;
  }
});

test('status transitions preserve legacy codes, timestamp completion and block reopening', async () => {
  const { db, handler } = setup();
  const id = 'SK-1234567-1234';
  const initial = { id, createdAt: '2026-10-21T08:00:00.000Z', status: 'new', name: 'Тест', phone: '+7 900 000-00-00', fulfillment: 'pickup', address: 'Алексеевка', items: [], payment: 'Наличными' };
  db.orders.set(id, { id, status: 'new', created_at: initial.createdAt, payload: JSON.stringify(initial) });
  const accepted = await jsonResponse(await handler(request('PATCH', `/admin/orders/${id}/status`, { status: 'accepted' })));
  assert.equal(accepted.status, 200);
  const preparing = await jsonResponse(await handler(request('PATCH', `/admin/orders/${id}/status`, { status: 'preparing' })));
  assert.equal(preparing.status, 200);
  const delivering = await jsonResponse(await handler(request('PATCH', `/admin/orders/${id}/status`, { status: 'delivering' })));
  assert.equal(delivering.status, 200);
  const done = await jsonResponse(await handler(request('PATCH', `/admin/orders/${id}/status`, { status: 'done' })));
  assert.equal(done.status, 200);
  assert.equal(JSON.parse(db.orders.get(id).payload).completedAt, '2026-10-21T09:00:00.000Z');
  const reopen = await jsonResponse(await handler(request('PATCH', `/admin/orders/${id}/status`, { status: 'preparing' })));
  assert.equal(reopen.status, 409);
});

test('cancelled is terminal and cleanup grants old rows a fresh 48-hour grace period', async () => {
  const { db, handler } = setup();
  const id = 'SK-cancel-1';
  const order = { id, status: 'new', name: 'Тест', phone: '+7 900 000-00-00', address: 'Улица', comment: 'позвонить', vkUserId: '123', legalEvents: [{ userId: '123' }] };
  db.orders.set(id, { id, status: 'new', created_at: '2026-10-01T00:00:00.000Z', payload: JSON.stringify(order) });
  assert.equal((await jsonResponse(await handler(request('PATCH', `/admin/orders/${id}/status`, { status: 'cancelled' })))).status, 200);
  const result = await jsonResponse(await handler(request('PATCH', `/admin/orders/${id}/status`, { status: 'accepted' })));
  assert.equal(result.status, 409);

  const oldFinal = { status: 'done' };
  assert.equal(cleanupDecision(oldFinal, new Date('2026-10-21T09:00:00Z')).action, 'stamp');
  assert.equal(cleanupDecision({ status: 'done', completedAt: '2026-10-19T09:00:00.000Z', completionTimeRecordedByServer: true }, new Date('2026-10-21T08:59:59.999Z')).action, 'keep');
  assert.equal(cleanupDecision({ status: 'cancelled', completedAt: '2026-10-19T09:00:00.000Z', completionTimeRecordedByServer: true }, new Date('2026-10-21T09:00:00.000Z')).action, 'delete');
  assert.equal(RETENTION_MS, 172800000);
});

test('mock cleanup keeps active and not-yet-due orders, then deletes terminal PII idempotently', async () => {
  const db = new MockYdb();
  const now = new Date('2026-10-21T09:00:00.000Z');
  const expired = { id: 'finished', status: 'done', completedAt: '2026-10-19T09:00:00.000Z', completionTimeRecordedByServer: true, name: 'Тест', phone: '9000000000', address: 'Улица', comment: 'Личные данные', vkUserId: '123', legalEvents: [{ userId: '123' }] };
  const recent = { id: 'recent', status: 'cancelled', completedAt: '2026-10-20T09:00:00.001Z', completionTimeRecordedByServer: true, phone: 'не удалять пока' };
  const active = { id: 'active', status: 'preparing', createdAt: '2020-01-01T00:00:00.000Z', phone: 'активная' };
  for (const order of [expired, recent, active]) db.orders.set(order.id, { id: order.id, status: order.status, created_at: order.createdAt || order.completedAt, payload: JSON.stringify(order) });

  const first = await cleanExpiredOrders(db.withDb.bind(db), now);
  assert.equal(first.removed, 1);
  assert.equal(db.orders.has('finished'), false);
  assert.equal(db.orders.has('recent'), true);
  assert.equal(db.orders.has('active'), true);
  db.orders.delete('recent');
  const second = await cleanExpiredOrders(db.withDb.bind(db), now);
  assert.equal(second.removed, 0);
  assert.equal(db.orders.has('active'), true);

  const legacy = { id: 'legacy', status: 'done', phone: 'старые данные' };
  db.orders.set('legacy', { id: 'legacy', status: 'done', created_at: '2020-01-01T00:00:00.000Z', payload: JSON.stringify(legacy) });
  const stamped = await cleanExpiredOrders(db.withDb.bind(db), now);
  assert.equal(stamped.stamped, 1);
  assert.equal(JSON.parse(db.orders.get('legacy').payload).completedAt, now.toISOString());
  assert.equal(JSON.parse(db.orders.get('legacy').payload).completionTimeRecordedByServer, true);
  const beforeDue = await cleanExpiredOrders(db.withDb.bind(db), new Date(now.getTime() + RETENTION_MS - 1));
  assert.equal(beforeDue.removed, 0);
  const due = await cleanExpiredOrders(db.withDb.bind(db), new Date(now.getTime() + RETENTION_MS));
  assert.equal(due.removed, 1);
  assert.equal(db.orders.has('legacy'), false);
});

test('cleanup entry point rejects non-timer and wrong-trigger events before touching YDB', async () => {
  const previous = process.env.CLEANUP_TRIGGER_ID;
  process.env.CLEANUP_TRIGGER_ID = 'timer-fixture';
  try {
    await assert.rejects(cleanupHandler({ httpMethod: 'POST', body: '{}' }), /CLEANUP_TRIGGER_NOT_AUTHORIZED/);
    await assert.rejects(cleanupHandler({ messages: [{
      event_metadata: { event_type: 'yandex.cloud.events.serverless.triggers.TimerMessage', trigger_id: 'other-timer' },
      details: { payload: 'sakura-order-pii-cleanup-v1' }
    }] }), /CLEANUP_TRIGGER_NOT_AUTHORIZED/);
  } finally {
    if (previous === undefined) delete process.env.CLEANUP_TRIGGER_ID;
    else process.env.CLEANUP_TRIGGER_ID = previous;
  }
});
