const { getDB, requireAuth, jsonResponse, getBody } = require('../lib/db');
const { vapidPublicKey } = require('./lib/webpush');

module.exports = async (req, res) => {
  // Hanya beri VAPID public key jika method GET
  if (req.method === 'GET') {
    return jsonResponse(res, { publicKey: vapidPublicKey });
  }

  // Handle pembuatan subscription baru
  const user = await requireAuth(req, res);
  if (!user) return;

  if (req.method === 'POST') {
    const input = await getBody(req);
    const { subscription } = input;

    if (!subscription || !subscription.endpoint) {
      return jsonResponse(res, { error: 'Invalid subscription' }, 400);
    }

    const db = getDB();
    try {
      // Pastikan tabel ada
      await db.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          subscription JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, subscription->>'endpoint')
        )
      `);

      // Cek apakah subscription sudah ada
      const existing = await db.query(
        'SELECT id FROM push_subscriptions WHERE user_id = $1 AND subscription->>\'endpoint\' = $2',
        [user.user_id, subscription.endpoint]
      );

      if (existing.rows.length === 0) {
        await db.query(
          'INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1, $2)',
          [user.user_id, JSON.stringify(subscription)]
        );
      }
      
      return jsonResponse(res, { success: true });
    } catch (err) {
      console.error(err);
      return jsonResponse(res, { error: 'Failed to save subscription' }, 500);
    }
  }

  return jsonResponse(res, { error: 'Method not allowed' }, 405);
};
