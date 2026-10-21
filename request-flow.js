(function (root) {
  'use strict';

  // Keep synchronized with legalDocumentVersions in the current backend package.
  var DOCUMENT_VERSIONS = {
    offer: 'offer-draft-2026-10-20-v1',
    consent: 'status-consent-draft-2026-10-20-v1'
  };
  var RECEIPT_PAYMENT_OPTIONS = [
    { value: 'Наличными', label: 'Наличными при получении' },
    { value: 'Картой при получении', label: 'Картой при получении' }
  ];
  var SERVER_STATUSES = [
    { api: 'new', status: 'pending', label: 'Ожидает подтверждения' },
    { api: 'accepted', status: 'accepted', label: 'Принята в работу' },
    { api: 'preparing', status: 'preparing', label: 'Готовится' },
    { api: 'delivering', status: 'delivering', label: 'В доставке' },
    { api: 'done', status: 'completed', label: 'Завершена' },
    { api: 'cancelled', status: 'cancelled', label: 'Отменена' }
  ];

  function statusCode(apiStatus) {
    return ({ new: 'pending', done: 'completed' })[apiStatus] || apiStatus || 'pending';
  }

  function statusLabel(apiStatus, fulfillment) {
    var status = statusCode(apiStatus);
    if (status === 'delivering' && fulfillment === 'pickup') return 'Готова к выдаче';
    return ({
      pending: 'Ожидает подтверждения',
      accepted: 'Принята в работу',
      preparing: 'Готовится',
      delivering: 'В доставке',
      completed: 'Завершена',
      cancelled: 'Отменена'
    })[status] || 'Статус уточняется';
  }

  function adminStatuses(fulfillment, currentApiStatus) {
    var terminal = currentApiStatus === 'done' || currentApiStatus === 'cancelled';
    var options = SERVER_STATUSES.map(function (item) {
      return {
        api: item.api,
        status: item.status,
        disabled: terminal,
        label: item.api === 'delivering' && fulfillment === 'pickup' ? 'Готова к выдаче' : item.label
      };
    });
    if (currentApiStatus && !options.some(function (item) { return item.api === currentApiStatus; })) {
      options.unshift({
        api: currentApiStatus,
        status: statusCode(currentApiStatus),
        label: statusLabel(currentApiStatus, fulfillment),
        disabled: true
      });
    }
    return options;
  }

  function legalAcknowledgement(order, userAction) {
    var result = Object.assign({}, order, {
      offerAccepted: userAction && userAction.offerAccepted === true,
      offerVersion: DOCUMENT_VERSIONS.offer
    });
    if (result.notifyStatus === true) result.statusConsentVersion = DOCUMENT_VERSIONS.consent;
    else delete result.statusConsentVersion;
    return result;
  }

  function deliveryCost(subtotal, fulfillment) {
    var amount = Number(subtotal) || 0;
    return fulfillment === 'delivery' && amount > 0 && amount < 990 ? 200 : 0;
  }

  async function dispatch(payload, transport) {
    if (typeof transport !== 'function') throw new TypeError('transport must be a function');
    var result = await transport(payload);
    return Object.assign({ sent: true }, result || {});
  }

  root.SakuraRequestFlow = {
    DOCUMENT_VERSIONS: DOCUMENT_VERSIONS,
    RECEIPT_PAYMENT_OPTIONS: RECEIPT_PAYMENT_OPTIONS,
    statusCode: statusCode,
    statusLabel: statusLabel,
    adminStatuses: adminStatuses,
    deliveryCost: deliveryCost,
    legalAcknowledgement: legalAcknowledgement,
    dispatch: dispatch
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.SakuraRequestFlow;
  }
})(typeof window !== 'undefined' ? window : globalThis);
