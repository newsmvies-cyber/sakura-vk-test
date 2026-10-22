const { notifyStaff } = require('./staff-notifications');
const { createHmac, timingSafeEqual, randomInt } = require('node:crypto');
const catalog = require('./catalog.json');
const { ALLOWED_STATUSES, ALLOWED_PAYMENTS, transitionOrder, cleanupDecision } = require('./order-lifecycle');

const statusLabels = { new: 'Ожидает подтверждения', accepted: 'Принята в работу', preparing: 'Готовится', delivering: 'В доставке', done: 'Завершена', cancelled: 'Отменена' };
const appId = '54834346';
const maxBodyBytes = 32 * 1024;
const legalDocumentVersions = { offer: 'offer-draft-2026-10-20-v1', consent: 'status-consent-draft-2026-10-20-v1' };
const orderIntakeSettingId = 'SAKURA-SETTING-ORDER-INTAKE';

function parseOrderIntake(payload) {
  try {
    const value = JSON.parse(payload);
    return !(value && value.kind === 'order_intake_setting' && value.acceptingOrders === false);
  } catch (_) {
    return true;
  }
}

function response(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin || 'null',
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-max-age': '600',
      'vary': 'Origin'
    },
    body: JSON.stringify(body)
  };
}

function getHeader(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : '';
}

function allowedOrigin(origin) {
  const permitted = String(process.env.APP_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const vkOrigins = new Set(['https://vk.ru', 'https://m.vk.ru', 'https://vk.com', 'https://m.vk.com']);
  return origin && (permitted.includes(origin) || vkOrigins.has(origin) || /^https:\/\/(?:stage|prod)-app54834346-[a-z0-9-]+\.pages\.vk-apps\.ru$/.test(origin)) ? origin : '';
}

function verifyLaunchParams(rawParams) {
  const secret = process.env.VK_APP_SECRET;
  if (!secret || !rawParams || rawParams.length > 8192) return null;
  const params = new URLSearchParams(rawParams);
  const all = new Map();
  for (const [key, value] of params) {
    if (all.has(key)) return null;
    all.set(key, value);
  }
  const sign = all.get('sign');
  const userId = all.get('vk_user_id');
  const launchTimestamp = Number(all.get('vk_ts'));
  const now = Math.floor(Date.now() / 1000);
  if (!sign || all.get('vk_app_id') !== appId || !/^\d{1,20}$/.test(userId || '') || !Number.isSafeInteger(launchTimestamp) || launchTimestamp > now + 300 || now - launchTimestamp > 86400) return null;
  const signed = [...all.entries()]
    .filter(([key]) => key.startsWith('vk_'))
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  if (!signed) return null;
  const expected = createHmac('sha256', secret).update(signed).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=$/, '');
  const actualBytes = Buffer.from(sign);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  return { userId };
}

function requestIdentity(event) {
  const authorization = getHeader(event.headers, 'authorization');
  if (!authorization.startsWith('Bearer ')) return null;
  return verifyLaunchParams(authorization.slice(7));
}

function isAdmin(userId) {
  return String(process.env.ADMIN_VK_USER_IDS || '').split(',').map((value) => value.trim()).filter(Boolean).includes(userId);
}

function parseBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : String(event.body || '');
  if (Buffer.byteLength(raw, 'utf8') > maxBodyBytes) throw new Error('BODY_TOO_LARGE');
  return JSON.parse(raw || '{}');
}

function validateOrder(input, now = () => new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const name = String(input.name || '').trim().slice(0, 60);
  const phone = String(input.phone || '').trim().slice(0, 32);
  const fulfillment = input.fulfillment === 'pickup' ? 'pickup' : input.fulfillment === 'delivery' ? 'delivery' : '';
  const sourceItems = Array.isArray(input.items) && input.items.length <= 60 ? input.items : [];
  const seen = new Set();
  const items = [];
  for (const item of sourceItems) {
    const id = String(item?.id || '');
    const quantity = Number(item?.quantity);
    const product = catalog[id];
    if (!product || seen.has(id) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) return null;
    seen.add(id);
    items.push({ id, name: product.name, quantity, price: product.price });
  }
  const payment = String(input.payment || '');
  const address = fulfillment === 'delivery' ? String(input.address || '').trim().slice(0, 200) : 'Алексеевка, ул. Некрасова, 59';
  if (!name || !/^\+?[0-9 ()-]{7,32}$/.test(phone) || !fulfillment || !items.length || !ALLOWED_PAYMENTS.has(payment) || (fulfillment === 'delivery' && !address)) return null;
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const delivery = fulfillment === 'delivery' && subtotal < 990 ? 200 : 0;
  const createdAt = now().toISOString();
  return {
    id: `SK-${Date.now().toString().slice(-7)}-${randomInt(1000, 10000)}`,
    createdAt,
    status: 'new',
    name,
    phone,
    fulfillment,
    address,
    slot: String(input.slot || '').trim().slice(0, 80),
    payment,
    persons: Math.max(1, Math.min(10, Number(input.persons) || 1)),
    comment: String(input.comment || '').trim().slice(0, 500),
    items,
    subtotal,
    delivery,
    total: subtotal + delivery
  };
}

async function withDb(fn, context = {}) {
  const { Driver, TokenAuthService, TypedValues, TypedData, AUTO_TX, ExecuteQuerySettings, OperationParams } = require('ydb-sdk');
  const connectionString = process.env.YDB_CONNECTION_STRING;
  if (!connectionString) throw new Error('YDB_NOT_CONFIGURED');
  const accessToken = context.token?.access_token;
  if (!accessToken) throw new Error('YDB_SERVICE_ACCOUNT_NOT_SET');
  const address = new URL(connectionString);
  const database = address.searchParams.get('database') || address.pathname;
  const quietLogger = Object.fromEntries(['fatal', 'error', 'warn', 'info', 'debug', 'trace'].map((level) => [level, () => {}]));
  const driver = new Driver({
    connectionString: `${address.protocol}//${address.host}${database}`,
    authService: new TokenAuthService(accessToken),
    poolSettings: { minLimit: 0, maxLimit: 1 },
    logger: quietLogger
  });
  let stage = 'database_connection';
  try {
    if (!await driver.ready(15000)) throw new Error('YDB_CONNECTION_TIMEOUT');
    stage = 'database_query';
    return await driver.tableClient.withSession(async (session) => {
      const sql = async (strings, ...values) => {
        const params = {};
        const declarations = values.map((value, index) => {
          if (typeof value !== 'string') throw new TypeError('YDB_STRING_PARAMETER_REQUIRED');
          params[`$p${index}`] = TypedValues.utf8(value);
          return `DECLARE $p${index} AS Utf8;`;
        }).join('\n');
        const statement = strings.reduce((text, part, index) => text + (index ? `$p${index - 1}` : '') + part, '');
        const settings = new ExecuteQuerySettings().withOperationParams(new OperationParams().withOperationTimeoutSeconds(20).withCancelAfterSeconds(22));
        const result = await session.executeQuery(`${declarations}\n${statement}`, params, AUTO_TX, settings);
        return (result.resultSets || []).map((resultSet) => TypedData.createNativeObjects(resultSet));
      };
      return await fn(sql);
    }, 30000);
  } catch (error) {
    error.sakuraStage = stage;
    throw error;
  } finally {
    await driver.destroy();
  }
}

async function runYdbReadWriteProbe(context, db = withDb) {
  const probeId = `codex-probe-${Date.now()}-${randomInt(100000, 999999)}`;
  return db(async (sql) => {
    await sql`UPSERT INTO sakura_backend_probe_20261020 (id) VALUES (${probeId})`;
    try {
      const [rows = []] = await sql`SELECT id FROM sakura_backend_probe_20261020 WHERE id = ${probeId}`;
      return rows.length === 1 && rows[0].id === probeId;
    } finally {
      await sql`DELETE FROM sakura_backend_probe_20261020 WHERE id = ${probeId}`;
    }
  }, context);
}

async function sendStatusNotification(order, status) {
  const token = process.env.VK_GROUP_TOKEN;
  if (!token || !order.vkUserId || order.notifyStatus !== true) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const body = new URLSearchParams({
      user_id: String(order.vkUserId),
      random_id: String(randomInt(1, 2147483647)),
      message: `Заказ ${order.id}: ${statusLabels[status] || status}.`,
      access_token: token,
      v: '5.199'
    });
    const result = await fetch('https://api.vk.com/method/messages.send', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal
    });
    if (!result.ok) return false;
    const data = await result.json();
    return Number.isInteger(data.response) && data.response > 0;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function cleanExpiredOrders(db, now = new Date(), context = {}) {
  return db(async (sql) => {
    let cursorId = '';
    let removed = 0;
    let stamped = 0;
    let scanned = 0;
    while (true) {
      // id is the confirmed primary key; avoid ordering every batch by
      // non-key created_at when no secondary index exists.
      const [rows = []] = await sql`SELECT id, status, payload FROM orders WHERE id > ${cursorId} AND status IN ('done', 'cancelled') ORDER BY id LIMIT 500`;
      if (!rows.length) break;
      scanned += rows.length;
      for (const row of rows) {
        let order;
        try { order = JSON.parse(row.payload); } catch (_) { continue; }
        const decision = cleanupDecision(order, now);
        if (decision.action === 'stamp') {
          order.completedAt = decision.completedAt;
          order.completionTimeRecordedByServer = true;
          await sql`UPDATE orders SET payload = ${JSON.stringify(order)} WHERE id = ${row.id} AND status = ${row.status} AND payload = ${row.payload}`;
          stamped += 1;
        } else if (decision.action === 'delete') {
          // Compare-and-delete prevents a stale cleanup scan from deleting a row
          // changed concurrently by an administrator.
          await sql`DELETE FROM orders WHERE id = ${row.id} AND status = ${row.status} AND payload = ${row.payload}`;
          removed += 1;
        }
      }
      const last = rows[rows.length - 1];
      cursorId = last.id;
      if (rows.length < 500) break;
    }
    return { scanned, stamped, removed };
  }, context);
}

function createHandler(dependencies = {}) {
  const db = dependencies.withDb || withDb;
  const identify = dependencies.requestIdentity || requestIdentity;
  const adminCheck = dependencies.isAdmin || isAdmin;
  const env = dependencies.env || process.env;
  const now = dependencies.now || (() => new Date());
  return async function handler(event, context = {}) {
  const headers = event.headers || {};
  const origin = getHeader(headers, 'origin');
  const corsOrigin = allowedOrigin(origin);
  const method = String(event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase();
  const path = String(event.path || event.rawPath || '/').replace(/\/+$/, '') || '/';
  if (method === 'OPTIONS') return origin && !corsOrigin ? response(403, { error: 'origin_not_allowed' }, 'null') : response(204, {}, corsOrigin);
  if (origin && !corsOrigin) return response(403, { error: 'origin_not_allowed' }, 'null');
  if (method === 'GET' && path === '/health') {
    try {
      const health = await db(async (sql) => {
        const [rows = []] = await sql`SELECT 1 AS connected`;
        const [settings = []] = await sql`SELECT payload FROM orders WHERE id = ${orderIntakeSettingId}`;
        return { connected: rows.length === 1, acceptingOrders: settings.length ? parseOrderIntake(settings[0].payload) : true };
      }, context);
      return response(health.connected ? 200 : 503, { ok: health.connected, service: 'sakura-orders', database: health.connected ? 'connected' : 'unavailable', ordersEnabled: env.ORDERS_ENABLED === 'true', testOrdersOnly: testOrdersOnly(env), acceptingOrders: health.acceptingOrders }, corsOrigin);
    } catch (_) {
      return response(503, { ok: false, service: 'sakura-orders', database: 'unavailable', ordersEnabled: env.ORDERS_ENABLED === 'true', testOrdersOnly: testOrdersOnly(env), acceptingOrders: true }, corsOrigin);
    }
  }

  const adminRoute = path === '/admin/orders' || path.startsWith('/admin/orders/');
  const identity = identify(event);
  if (adminRoute && !identity) {
    return response(401, { error: 'vk_auth_required' }, corsOrigin);
  }
  if (adminRoute && !adminCheck(identity.userId)) {
    return response(403, { error: 'admin_access_required' }, corsOrigin);
  }

  try {
    if (method === 'POST' && path === '/orders') {
      if (env.ORDERS_ENABLED !== 'true') return response(503, { error: 'orders_temporarily_disabled' }, corsOrigin);
      if (!identity) return response(401, { error: 'vk_auth_required' }, corsOrigin);
      const [intakeRows = []] = await db((sql) => sql`SELECT payload FROM orders WHERE id = ${orderIntakeSettingId}`, context);
      if (intakeRows.length && !parseOrderIntake(intakeRows[0].payload)) return response(503, { error: 'order_intake_paused' }, corsOrigin);
      if (testOrdersOnly(env) && !adminCheck(identity.userId)) return response(403, { error: 'test_orders_staff_only' }, corsOrigin);
      let order;
      let input;
      try { input = parseBody(event); order = validateOrder(input, now); }
      catch (error) { return response(error.message === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'invalid_request' }, corsOrigin); }
      if (!order || (order.fulfillment === 'delivery' && !order.address)) return response(400, { error: 'invalid_order' }, corsOrigin);
      if (input.offerAccepted !== true || input.offerVersion !== legalDocumentVersions.offer || (input.notifyStatus === true && input.statusConsentVersion !== legalDocumentVersions.consent)) return response(400, { error: 'invalid_legal_acknowledgement' }, corsOrigin);
      order.testOrder = testOrdersOnly(env);
      order.vkUserId = identity.userId;
      order.notifyStatus = input.notifyStatus === true;
      order.legalEvents = [{ action: 'offer_accepted', document: 'offer', version: legalDocumentVersions.offer, userId: identity.userId, occurredAt: new Date().toISOString() }];
      if (order.notifyStatus) order.legalEvents.push({ action: 'status_notifications_consent', document: 'consent', version: legalDocumentVersions.consent, userId: identity.userId, occurredAt: new Date().toISOString() });
      await db((sql) => sql`UPSERT INTO orders (id, created_at, status, payload) VALUES (${order.id}, ${order.createdAt}, ${order.status}, ${JSON.stringify(order)})`, context);
      try { await (dependencies.notifyStaff || notifyStaff)(order, env); } catch (_) { /* Saved requests must survive notification failures. */ }
      return response(201, { ok: true, orderId: order.id }, corsOrigin);
    }

    if (method === 'GET' && path === '/orders') {
      if (!identity) return response(401, { error: 'vk_auth_required' }, corsOrigin);
      const orders = await db(async (sql) => {
        let cursorId = '';
        const matching = [];
        while (true) {
          // id is the confirmed primary key; page on it instead of truncating
          // globally by created_at before filtering to the verified VK user.
          const [rows = []] = await sql`SELECT id, payload FROM orders WHERE id > ${cursorId} ORDER BY id LIMIT 500`;
          for (const row of rows) {
            try {
              const order = JSON.parse(row.payload);
              if (order.vkUserId === identity.userId) {
                delete order.vkUserId;
                matching.push(order);
              }
            } catch (_) {}
          }
          if (rows.length < 500) break;
          cursorId = rows[rows.length - 1].id;
        }
        return matching.sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || '')).slice(0, 200);
      }, context);
      return response(200, { orders }, corsOrigin);
    }

    if (method === 'GET' && path === '/admin/orders') {
      if (event.queryStringParameters?.probe === 'ydb') {
        const ok = await runYdbReadWriteProbe(context, db);
        return response(ok ? 200 : 503, { ok, database: ok ? 'read_write_ok' : 'probe_mismatch' }, corsOrigin);
      }
      const result = await db(async (sql) => {
        const [rows = []] = await sql`SELECT id, payload FROM orders ORDER BY created_at DESC LIMIT 200`;
        const [settings = []] = await sql`SELECT payload FROM orders WHERE id = ${orderIntakeSettingId}`;
        return { rows, acceptingOrders: settings.length ? parseOrderIntake(settings[0].payload) : true };
      }, context);
      const orders = result.rows.filter((row) => row.id !== orderIntakeSettingId).map((row) => {
        const order = JSON.parse(row.payload);
        delete order.vkUserId;
        return order;
      });
      return response(200, { orders, acceptingOrders: result.acceptingOrders }, corsOrigin);
    }

    const statusMatch = path.match(/^\/admin\/orders\/([A-Za-z0-9-]+)\/status$/);
    if (method === 'PATCH' && statusMatch) {
      let body;
      try { body = parseBody(event); } catch (_) { return response(400, { error: 'invalid_request' }, corsOrigin); }
      if (statusMatch[1] === orderIntakeSettingId) {
        if (typeof body.acceptingOrders !== 'boolean') return response(400, { error: 'invalid_order_intake_setting' }, corsOrigin);
        const setting = { id: orderIntakeSettingId, kind: 'order_intake_setting', acceptingOrders: body.acceptingOrders, updatedAt: now().toISOString() };
        const settingStatus = 'system';
        await db((sql) => sql`UPSERT INTO orders (id, created_at, status, payload) VALUES (${orderIntakeSettingId}, ${setting.updatedAt}, ${settingStatus}, ${JSON.stringify(setting)})`, context);
        return response(200, { ok: true, acceptingOrders: body.acceptingOrders }, corsOrigin);
      }
      if (!ALLOWED_STATUSES.has(body.status)) return response(400, { error: 'invalid_status' }, corsOrigin);
      const updated = await db(async (sql) => {
        const [rows = []] = await sql`SELECT payload FROM orders WHERE id = ${statusMatch[1]}`;
        if (!rows.length) return false;
        const order = JSON.parse(rows[0].payload);
        const transition = transitionOrder(order, body.status, now());
        if (!transition.ok) return transition;
        await sql`UPDATE orders SET status = ${transition.order.status}, payload = ${JSON.stringify(transition.order)} WHERE id = ${statusMatch[1]} AND status = ${order.status} AND payload = ${rows[0].payload}`;
        return transition.order;
      }, context);
      if (!updated) return response(404, { error: 'not_found' }, corsOrigin);
      if (updated.reason === 'terminal_status') return response(409, { error: 'terminal_status' }, corsOrigin);
      if (updated.reason) return response(400, { error: updated.reason }, corsOrigin);
      const notificationSent = await sendStatusNotification(updated, body.status);
      return response(200, { ok: true, notificationSent }, corsOrigin);
    }

    return response(404, { error: 'not_found' }, corsOrigin);
  } catch (error) {
    return response(500, {
      error: 'service_unavailable',
      stage: error.sakuraStage || 'request',
      errorType: String(error.constructor?.name || error.name || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 60),
      code: typeof error.code === 'number' ? error.code : error.constructor?.status
    }, corsOrigin);
  }
  };
}

function testOrdersOnly(env = process.env) {
  return env.ORDERS_TEST_ONLY === 'true';
}

async function cleanupExpiredOrders(context = {}, now = new Date()) {
  return cleanExpiredOrders(withDb, now, context);
}

exports.handler = createHandler();
exports.createHandler = createHandler;
exports.validateOrder = validateOrder;
exports.verifyLaunchParams = verifyLaunchParams;
exports.isAdmin = isAdmin;
exports.cleanExpiredOrders = cleanExpiredOrders;
exports.cleanupExpiredOrders = cleanupExpiredOrders;
