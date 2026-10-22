'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const flow = require('../request-flow.js');

test('legacy backend statuses display the requested application statuses', () => {
  assert.equal(flow.statusCode('new'), 'pending');
  assert.equal(flow.statusLabel('new', 'delivery'), 'Ожидает подтверждения');
  assert.equal(flow.statusLabel('accepted', 'delivery'), 'Принята в работу');
  assert.equal(flow.statusLabel('preparing', 'delivery'), 'Готовится');
  assert.equal(flow.statusLabel('delivering', 'delivery'), 'В доставке');
  assert.equal(flow.statusCode('done'), 'completed');
  assert.equal(flow.statusLabel('done', 'delivery'), 'Завершена');
  assert.equal(flow.statusLabel('cancelled', 'delivery'), 'Отменена');
});

test('pickup displays ready for collection without sending an unsupported API status', () => {
  assert.equal(flow.statusLabel('delivering', 'pickup'), 'Готова к выдаче');
  const options = flow.adminStatuses('pickup');
  assert.equal(options.find((item) => item.api === 'accepted').status, 'accepted');
  assert.equal(options.find((item) => item.api === 'delivering').label, 'Готова к выдаче');
  assert.deepEqual(options.map((item) => item.api), ['new', 'accepted', 'preparing', 'delivering', 'done', 'cancelled']);
  assert.equal(options.some((item) => ['pending', 'completed'].includes(item.api)), false);
  const historicalCancelled = flow.adminStatuses('delivery', 'cancelled').find((item) => item.api === 'cancelled');
  assert.deepEqual(historicalCancelled, { api: 'cancelled', status: 'cancelled', disabled: true, label: 'Отменена' });
  assert.ok(flow.adminStatuses('delivery', 'cancelled').every((item) => item.disabled));
  assert.ok(flow.adminStatuses('delivery', 'done').every((item) => item.disabled));
});

test('legal acknowledgement follows an explicit user action and versions match backend draft', () => {
  const base = { status: 'new', notifyStatus: false };
  const unchecked = flow.legalAcknowledgement(base, { offerAccepted: false });
  assert.equal(unchecked.offerAccepted, false);
  assert.equal(unchecked.offerVersion, 'offer-draft-2026-10-20-v1');
  assert.equal('statusConsentVersion' in unchecked, false);

  const checked = flow.legalAcknowledgement({ ...base, notifyStatus: true }, { offerAccepted: true });
  assert.equal(checked.offerAccepted, true);
  assert.equal(checked.statusConsentVersion, 'status-consent-draft-2026-10-20-v1');
});

test('payment choices are limited to payment on delivery or pickup', () => {
  assert.deepEqual(flow.RECEIPT_PAYMENT_OPTIONS.map((option) => option.value), [
    'Наличными',
    'Картой при получении'
  ]);
  assert.equal(flow.RECEIPT_PAYMENT_OPTIONS.some((option) => /online|онлайн|vk pay|перевод/i.test(option.label)), false);
});

test('preliminary delivery total keeps the existing free-delivery threshold', () => {
  assert.equal(flow.deliveryCost(0, 'delivery'), 0);
  assert.equal(flow.deliveryCost(989, 'delivery'), 200);
  assert.equal(flow.deliveryCost(990, 'delivery'), 0);
  assert.equal(flow.deliveryCost(1500, 'pickup'), 0);
});

test('checkout UI uses request language, preliminary total, and keeps intake notice visible', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<h2>Оформление заявки<\/h2>/);
  assert.match(html, /type="submit">Отправить заявку<\/button>/);
  assert.match(html, /Предварительная стоимость/);
  assert.doesNotMatch(html, /Приём заявок пока отключён/);
  assert.match(html, /Отправить заявку/);
  assert.match(html, /Оплата при получении/);
  assert.doesNotMatch(html, /Подтвердить заказ|Переводом после подтверждения|VK Pay|эквайринг/i);
});

test('order intake notice uses existing gateway routes and admin toggle has a visible success state', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(html, /id="orderIntakeBanner"/);
  assert.match(html, /id="orderIntakeCheckout"/);
  assert.match(app, /fetch\(base\+'\/health'/);
  assert.match(app, /\/admin\/orders\/SAKURA-SETTING-ORDER-INTAKE\/status/);
  assert.match(app, /if\(!acceptingOrders\).*Временно не принимаем заявки/);
  assert.match(app, /Сообщения VK включены ✓/);
  assert.doesNotMatch(app, /\/admin\/settings\/order-intake|\/order-intake/);
});

test('request dispatcher sends the application request to its configured transport', async () => {
  let transportCalls = 0;
  const result = await flow.dispatch({ status: 'new' }, async () => {
    transportCalls += 1;
    return { ok: true };
  });

  assert.deepEqual(result, { sent: true, ok: true });
  assert.equal(transportCalls, 1);
});

test('mock API can simulate a request without contacting the real backend', async () => {
  let received;
  const payload = flow.legalAcknowledgement({
    status: 'new',
    payment: 'Наличными',
    notifyStatus: false,
    subtotal: 800,
    delivery: 200,
    total: 1000
  }, { offerAccepted: true });

  const result = await flow.dispatch(payload, async (request) => {
    received = request;
    return { ok: true, orderId: 'MOCK-1' };
  });

  assert.equal(result.sent, true);
  assert.equal(result.orderId, 'MOCK-1');
  assert.equal(received.status, 'new');
  assert.equal(received.payment, 'Наличными');
  assert.equal(received.offerAccepted, true);
  assert.equal(received.total, 1000);
});
