(function (root) {
  'use strict';

  var PREFIX = 'sakura-orders:v1:';
  var LEGACY_KEY = 'sakura-demo-orders';
  var MAX_ITEMS = 60;

  function isVkId(value) {
    return /^[1-9]\d{0,19}$/.test(String(value == null ? '' : value));
  }

  function keyFor(identity) {
    var id = identity && String(identity.id == null ? '' : identity.id);
    return isVkId(id) ? PREFIX + id : null;
  }

  function text(value, limit) {
    return String(value == null ? '' : value).trim().slice(0, limit);
  }

  function normalize(order) {
    if (!order || typeof order !== 'object' || Array.isArray(order)) return null;
    var id = text(order.id, 100);
    if (!id) return null;
    return {
      id: id,
      createdAt: text(order.createdAt, 40),
      status: text(order.status || 'new', 32),
      name: text(order.name, 60),
      phone: text(order.phone, 32),
      fulfillment: order.fulfillment === 'pickup' ? 'pickup' : 'delivery',
      address: text(order.address, 300),
      slot: text(order.slot, 80),
      payment: text(order.payment, 80),
      persons: Math.max(1, Number(order.persons) || 1),
      items: (Array.isArray(order.items) ? order.items : []).slice(0, MAX_ITEMS).map(function (item) {
        return { id: text(item && item.id, 100), name: text(item && item.name, 120), quantity: Math.max(0, Number(item && item.quantity) || 0) };
      }),
      total: Math.max(0, Number(order.total) || 0)
    };
  }

  function removeLegacy(storage) {
    if (!storage) return;
    try { storage.removeItem(LEGACY_KEY); } catch (_) {}
  }

  function read(storage, identity) {
    var key = keyFor(identity);
    if (!key || !storage) return [];
    removeLegacy(storage);
    try {
      var value = JSON.parse(storage.getItem(key) || '[]');
      return Array.isArray(value) ? value.map(normalize).filter(Boolean) : [];
    } catch (_) { return []; }
  }

  function save(storage, identity, order) {
    var key = keyFor(identity), normalized = normalize(order);
    if (!key || !storage || !normalized) return false;
    removeLegacy(storage);
    try {
      var orders = read(storage, identity);
      var index = orders.findIndex(function (item) { return item.id === normalized.id; });
      if (index >= 0) orders[index] = normalized;
      else orders.unshift(normalized);
      storage.setItem(key, JSON.stringify(orders));
      return true;
    } catch (_) { return false; }
  }

  function cacheServerOrders(storage, identity, orders) {
    var key = keyFor(identity);
    if (!key || !storage || !Array.isArray(orders)) return read(storage, identity);
    orders.forEach(function (order) { save(storage, identity, order); });
    return read(storage, identity);
  }

  function merge(serverOrders, localOrders) {
    var byId = new Map();
    (Array.isArray(localOrders) ? localOrders : []).map(normalize).filter(Boolean).forEach(function (order) { byId.set(order.id, order); });
    (Array.isArray(serverOrders) ? serverOrders : []).map(normalize).filter(Boolean).forEach(function (order) { byId.set(order.id, order); });
    return Array.from(byId.values()).sort(function (a, b) { return Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''); });
  }

  var api = { keyFor: keyFor, normalize: normalize, removeLegacy: removeLegacy, read: read, save: save, cacheServerOrders: cacheServerOrders, merge: merge };
  root.SakuraOrderHistoryStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
