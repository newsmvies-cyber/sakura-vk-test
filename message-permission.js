(function (root) {
  'use strict';

  var PREFIX = 'sakura-message-permission:v1:';

  function validVkId(value) {
    return /^[1-9]\d{0,19}$/.test(String(value == null ? '' : value));
  }

  function storageKey(vkId) {
    return validVkId(vkId) ? PREFIX + String(vkId) : null;
  }

  function wasAttempted(storage, vkId) {
    var key = storageKey(vkId);
    if (!key || !storage) return false;
    try { return storage.getItem(key) !== null; } catch (_) { return false; }
  }

  function markAttempt(storage, vkId, outcome) {
    var key = storageKey(vkId);
    if (!key || !storage) return false;
    try {
      storage.setItem(key, JSON.stringify({ outcome: outcome === 'allowed' ? 'allowed' : 'not-allowed' }));
      return true;
    } catch (_) { return false; }
  }

  async function requestOnce(bridge, storage, vkId, groupId) {
    if (!validVkId(vkId)) return { requested: false, reason: 'unverified-user' };
    if (!bridge || typeof bridge.send !== 'function') return { requested: false, reason: 'bridge-unavailable' };
    if (typeof bridge.supports === 'function' && !bridge.supports('VKWebAppAllowMessagesFromGroup')) {
      return { requested: false, reason: 'method-unavailable' };
    }
    if (wasAttempted(storage, vkId)) return { requested: false, reason: 'already-requested' };
    try {
      await bridge.send('VKWebAppAllowMessagesFromGroup', { group_id: Number(groupId) });
      markAttempt(storage, vkId, 'allowed');
      return { requested: true, allowed: true };
    } catch (_) {
      markAttempt(storage, vkId, 'not-allowed');
      return { requested: true, allowed: false };
    }
  }

  var api = { storageKey: storageKey, wasAttempted: wasAttempted, markAttempt: markAttempt, requestOnce: requestOnce };
  root.SakuraMessagePermission = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
