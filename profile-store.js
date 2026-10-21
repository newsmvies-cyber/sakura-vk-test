(function (root) {
  'use strict';

  var PREFIX = 'sakura-profile:v1:';
  var PHONE_METHOD = 'VKWebAppGetPhoneNumber';

  function isVkId(value) {
    return /^[1-9]\d{0,19}$/.test(String(value == null ? '' : value));
  }

  function cleanText(value, maxLength) {
    return String(value == null ? '' : value).trim().slice(0, maxLength);
  }

  function resolveIdentity(userInfo, launchSearch, expectedAppId) {
    var id = String(userInfo && userInfo.id != null ? userInfo.id : '');
    if (!isVkId(id)) return null;

    var params = new URLSearchParams(String(launchSearch || '').replace(/^\?/, ''));
    var launchIds = params.getAll('vk_user_id');
    var appIds = params.getAll('vk_app_id');
    if (launchIds.length !== 1 || appIds.length !== 1) return null;
    if (launchIds[0] !== id || appIds[0] !== String(expectedAppId)) return null;

    var firstName = cleanText(userInfo.first_name, 40);
    var lastName = cleanText(userInfo.last_name, 40);
    return {
      id: id,
      firstName: firstName,
      lastName: lastName,
      fullName: cleanText([firstName, lastName].filter(Boolean).join(' '), 60)
    };
  }

  function storageKey(vkId) {
    return isVkId(vkId) ? PREFIX + String(vkId) : null;
  }

  function read(storage, vkId, fallbackName) {
    var key = storageKey(vkId);
    if (!key || !storage) return { name: '', phone: '', address: '' };
    try {
      var value = JSON.parse(storage.getItem(key) || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
      return {
        name: cleanText(value.name, 60) || cleanText(fallbackName, 60),
        phone: cleanText(value.phone, 32),
        address: cleanText(value.address, 180)
      };
    } catch (_) {
      return { name: cleanText(fallbackName, 60), phone: '', address: '' };
    }
  }

  function save(storage, vkId, profile) {
    var key = storageKey(vkId);
    if (!key || !storage) return false;
    try {
      var existing = read(storage, vkId);
      storage.setItem(key, JSON.stringify({
        name: cleanText(profile && profile.name, 60),
        phone: cleanText(profile && profile.phone, 32),
        address: profile && Object.prototype.hasOwnProperty.call(profile, 'address')
          ? cleanText(profile.address, 180)
          : existing.address
      }));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function requestPhoneNumber(bridge) {
    if (!bridge || typeof bridge.send !== 'function') return { supported: false, phone: '' };
    try {
      if (typeof bridge.supports === 'function' && !bridge.supports(PHONE_METHOD)) {
        return { supported: false, phone: '' };
      }
      var result = await bridge.send(PHONE_METHOD);
      return {
        supported: true,
        phone: cleanText(result && result.phone_number, 32)
      };
    } catch (_) {
      return { supported: false, phone: '' };
    }
  }

  var api = {
    isVkId: isVkId,
    resolveIdentity: resolveIdentity,
    storageKey: storageKey,
    read: read,
    save: save,
    requestPhoneNumber: requestPhoneNumber
  };

  root.SakuraProfileStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
