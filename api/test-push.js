const { requireAuth, jsonResponse, setCors, handleOptions } = require('../lib/db');
const { sendPushNotification } = require('./lib/webpush');

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method !== 'POST') {
    return jsonResponse(res, { error: 'Method not allowed' }, 405);
  }

  try {
    await sendPushNotification(
      user.user_id,
      'Tes Notifikasi',
      'Kalau ini muncul, push notification di HP kamu sudah aktif.',
      '/notifications.html'
    );

    return jsonResponse(res, { success: true, message: 'Push test sent' });
  } catch (err) {
    console.error('Failed to send test push:', err);
    return jsonResponse(res, { error: 'Failed to send test push' }, 500);
  }
};
