const webpush = require('web-push');
const { getDB } = require('./db');

const legacyVapidPublicKey = 'BGUjYcMzjO44_TlXZzt7-H-FwFiOOcPOvrd6kt4PxpcfHyfrkMrgiYQXa2L7zCH-S-FIyW1cvi1AIZmnHBnmFFw';
const legacyVapidPrivateKey = 'ICtQK62UwsqaAZyJ-ca1a20MtKQTYAd5Wsuws6YiRFM';
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || legacyVapidPublicKey;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || legacyVapidPrivateKey;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@kontrakan.local';
let pushConfigError = null;
const usesFallbackKeys = !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY;

function isPushConfigured() {
  return Boolean(vapidPublicKey && vapidPrivateKey && !pushConfigError);
}

if (isPushConfigured()) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  } catch (error) {
    pushConfigError = error;
    console.error('Invalid web push configuration:', error.message);
  }
}

async function sendPushNotification(userId, title, body, url = '/') {
  if (!isPushConfigured()) {
    return { skipped: true, reason: 'missing_vapid_keys' };
  }

  const db = getDB();

  try {
    const result = await db.query(
      'SELECT id, endpoint, subscription FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) return;

    const payload = JSON.stringify({
      title,
      body,
      icon: '/icons/icon-512.png',
      badge: '/apple-touch-icon.png',
      url
    });

    const tasks = result.rows.map(async (row) => {
      const sub = row.subscription;

      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
          return;
        }

        console.error('Push error:', {
          endpoint: row.endpoint,
          statusCode: err.statusCode,
          body: err.body || err.message
        });
      }
    });

    await Promise.allSettled(tasks);
  } catch (err) {
    console.error('Failed to send push notification:', err);
  }
}

module.exports = {
  sendPushNotification,
  vapidPublicKey,
  isPushConfigured,
  pushConfigError,
  usesFallbackKeys,
};
