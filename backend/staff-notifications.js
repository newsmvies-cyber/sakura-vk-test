const { createHash } = require('node:crypto');
async function notifyStaff(order, env = process.env, send = fetch) {
  if (env.VK_STAFF_NOTIFICATIONS_ENABLED !== 'true' || !env.VK_GROUP_TOKEN) return false;
  const ids = [...new Set(String(env.VK_STAFF_USER_IDS || '').split(',').map(x => x.trim()).filter(x => /^[1-9]\d*$/.test(x)))];
  if (!ids.length) return false;
  const results = await Promise.all(ids.map(async userId => {
    const randomId = (createHash('sha256').update('new-order:' + order.id + ':' + userId).digest().readUInt32BE(0) & 0x7fffffff) || 1;
    try {
      const response = await send('https://api.vk.com/method/messages.send', {
        method: 'POST', signal: AbortSignal.timeout(4000),
        body: new URLSearchParams({access_token: env.VK_GROUP_TOKEN, v: '5.199', user_id: userId, random_id: String(randomId), message: 'Новая заявка №' + order.id + '. Ожидает подтверждения. Откройте админку: https://vk.ru/app54834346'})
      });
      const body = await response.json();
      return response.ok && !body.error && Number(body.response) > 0;
    } catch (_) { return false; }
  }));
  return results.every(Boolean);
}
module.exports = { notifyStaff };
