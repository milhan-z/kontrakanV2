const { requireAuth, jsonResponse, setCors, handleOptions } = require('../lib/db');
const { sendPushNotification } = require('../lib/webpush');

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method !== 'POST') {
    return jsonResponse(res, { error: 'Method not allowed' }, 405);
  }

  try {
    const result = await sendPushNotification(
      user.user_id,
      'Tes Notifikasi',
      'Kalau ini muncul, push notification di HP kamu sudah aktif.',
      '/notifications.html'
    );

    if (!result || result.skipped || result.sent === 0) {
      return jsonResponse(
        res,
        {
          error: result?.reason === 'no_subscription'
            ? 'Belum ada perangkat yang terdaftar untuk push notification'
            : 'Push notification belum siap dikirim',
          detail: result || null,
        },
        409
      );
    }

    return jsonResponse(res, { success: true, message: 'Push test sent', result });
  } catch (err) {
    console.error('Failed to send test push:', err);
    return jsonResponse(res, { error: 'Failed to send test push' }, 500);
  }
};
