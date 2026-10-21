'use strict';

const TERMINAL_STATUSES = new Set(['done', 'cancelled']);
const ALLOWED_STATUSES = new Set(['new', 'accepted', 'preparing', 'delivering', 'done', 'cancelled']);
const ALLOWED_PAYMENTS = new Set(['Наличными', 'Картой при получении']);
const RETENTION_MS = 48 * 60 * 60 * 1000;

function transitionOrder(order, nextStatus, now = new Date()) {
  if (!order || !ALLOWED_STATUSES.has(nextStatus)) return { ok: false, reason: 'invalid_status' };
  if (TERMINAL_STATUSES.has(order.status)) return { ok: false, reason: 'terminal_status' };
  const updated = { ...order, status: nextStatus };
  if (TERMINAL_STATUSES.has(nextStatus)) {
    updated.completedAt = now.toISOString();
    updated.completionTimeRecordedByServer = true;
  } else {
    delete updated.completedAt;
    delete updated.completionTimeRecordedByServer;
  }
  return { ok: true, order: updated };
}

// Old terminal records without a trustworthy completion timestamp are given a
// full 48-hour grace period from their first cleanup scan.
function cleanupDecision(order, now = new Date()) {
  if (!order || !TERMINAL_STATUSES.has(order.status)) return { action: 'keep' };
  if (order.completionTimeRecordedByServer !== true || !order.completedAt) return { action: 'stamp', completedAt: now.toISOString() };
  const completedAt = Date.parse(order.completedAt);
  if (!Number.isFinite(completedAt)) return { action: 'stamp', completedAt: now.toISOString() };
  if (now.getTime() < completedAt + RETENTION_MS) return { action: 'keep' };
  return { action: 'delete' };
}

module.exports = { ALLOWED_STATUSES, ALLOWED_PAYMENTS, TERMINAL_STATUSES, RETENTION_MS, transitionOrder, cleanupDecision };
