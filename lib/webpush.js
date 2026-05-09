const webpush = require('web-push');
const { getDB } = require('../../lib/db');

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || 'BGUjYcMzjO44_TlXZzt7-H-FwFiOOcPOvrd6kt4PxpcfHyfrkMrgiYQXa2L7zCH-S-FIyW1cvi1AIZmnHBnmFFw';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || 'ICtQK62UwsqaAZyJ-ca1a20MtKQTYAd5Wsuws6YiRFM';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:hilman@example.com',
  vapidPublicKey,
  vapidPrivateKey
);

async function sendPushNotification(userId, title, body, url = '/') {
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

module.exports = { sendPushNotification, vapidPublicKey };
