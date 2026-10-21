'use strict';

const { cleanupExpiredOrders } = require('./index');

const EVENT_TYPE = 'yandex.cloud.events.serverless.triggers.TimerMessage';
const PAYLOAD = 'sakura-order-pii-cleanup-v1';

exports.handler = async function cleanupHandler(event, context = {}) {
  const messages = Array.isArray(event?.messages) ? event.messages : [];
  const message = messages.find((item) => item?.event_metadata?.event_type === EVENT_TYPE);
  const expectedTriggerId = process.env.CLEANUP_TRIGGER_ID;
  if (!message || !expectedTriggerId || message.event_metadata?.trigger_id !== expectedTriggerId || message.details?.payload !== PAYLOAD) {
    throw new Error('CLEANUP_TRIGGER_NOT_AUTHORIZED');
  }
  // Function invocation must be restricted to the dedicated Timer service
  // account. This handler must not be exposed through the public API Gateway.
  return cleanupExpiredOrders(context);
};
