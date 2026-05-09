const webpush = require('web-push');
const { getDB } = require('../../lib/db');

// Gunakan Env Vars jika ada, kalau tidak gunakan kunci default yang di-generate
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || 'BGUjYcMzjO44_TlXZzt7-H-FwFiOOcPOvrd6kt4PxpcfHyfrkMrgiYQXa2L7zCH-S-FIyW1cvi1AIZmnHBnmFFw';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || 'ICtQK62UwsqaAZyJ-ca1a20MtKQTYAd5Wsuws6YiRFM';

webpush.setVapidDetails(
  'mailto:hilman@example.com',
  vapidPublicKey,
  vapidPrivateKey
);

async function sendPushNotification(userId, title, body, url = '/') {
  const db = getDB();
  try {
    // Ambil semua subscription device dari user ini
    const result = await db.query('SELECT subscription FROM push_subscriptions WHERE user_id = $1', [userId]);
    
    if (result.rows.length === 0) return; // User belum mengaktifkan notif
    
    const payload = JSON.stringify({
      title: title,
      body: body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png', // Transparent badge icon recommended
      url: url
    });

    const promises = result.rows.map(row => {
      const sub = row.subscription;
      return webpush.sendNotification(sub, payload).catch(err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired or unsubscribed, hapus dari database
          console.log('Subscription expired, deleting from DB');
          return db.query('DELETE FROM push_subscriptions WHERE subscription->>\'endpoint\' = $1', [sub.endpoint]);
        }
        console.error('Push error:', err);
      });
    });

    await Promise.all(promises);
  } catch (err) {
    console.error('Failed to send push notification:', err);
  }
}

module.exports = { sendPushNotification, vapidPublicKey };
