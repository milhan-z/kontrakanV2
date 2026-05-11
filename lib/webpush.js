const webpush = require('web-push');
const { getDB } = require('./db');

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@kontrakan.local';
let pushConfigError = null;

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

    if (result.rows.length === 0) {
      return { sent: 0, failed: 0, removed: 0, skipped: true, reason: 'no_subscription' };
    }

    const payload = JSON.stringify({
      title,
      body,
      icon: '/icons/icon-512.png',
      badge: '/apple-touch-icon.png',
      url,
      tag: `kontrakan-${userId}-${Date.now()}`
    });

    const summary = { sent: 0, failed: 0, removed: 0, skipped: false };
    const tasks = result.rows.map(async (row) => {
      const sub = row.subscription;

      try {
        await webpush.sendNotification(sub, payload);
        summary.sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
          summary.removed += 1;
          return;
        }

        summary.failed += 1;
        console.error('Push error:', {
          endpoint: row.endpoint,
          statusCode: err.statusCode,
          body: err.body || err.message
        });
      }
    });

    await Promise.allSettled(tasks);
    return summary;
  } catch (err) {
    console.error('Failed to send push notification:', err);
    return { sent: 0, failed: 1, removed: 0, skipped: false, error: err.message };
  }
}

module.exports = {
  sendPushNotification,
  vapidPublicKey,
  isPushConfigured,
  pushConfigError,
};
