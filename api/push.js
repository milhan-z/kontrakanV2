const { getDB, requireAuth, jsonResponse, getBody, setCors, handleOptions } = require('../lib/db');
const { vapidPublicKey, isPushConfigured, pushConfigError } = require('../lib/webpush');

module.exports = async (req, res) => {
  setCors(res);
  if (handleOptions(req, res)) return;

  if (req.method === 'GET') {
    if (!isPushConfigured()) {
      return jsonResponse(
        res,
        {
          error: pushConfigError
            ? `Konfigurasi push tidak valid: ${pushConfigError.message}`
            : 'Push notification belum dikonfigurasi. Isi VAPID_PUBLIC_KEY dan VAPID_PRIVATE_KEY.',
        },
        503
      );
    }
    return jsonResponse(res, { publicKey: vapidPublicKey });
  }

  const user = requireAuth(req, res);
  if (!user) return;

  const db = getDB();

  try {
    await ensurePushTable(db);
  } catch (err) {
    console.error('Failed to ensure push_subscriptions table:', err);
    return jsonResponse(res, { error: 'Push storage is not ready' }, 500);
  }

  if (req.method === 'POST') {
    const input = await getBody(req);
    let { subscription } = input || {};

    if (typeof subscription === 'string') {
      try { subscription = JSON.parse(subscription); } catch { subscription = null; }
    }

    if (!subscription || typeof subscription !== 'object' || !subscription.endpoint) {
      return jsonResponse(res, { error: 'Invalid subscription' }, 400);
    }

    try {
      await db.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, subscription, user_agent, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         ON CONFLICT (endpoint)
         DO UPDATE SET
           user_id = EXCLUDED.user_id,
           subscription = EXCLUDED.subscription,
           user_agent = EXCLUDED.user_agent,
           updated_at = NOW()`,
        [
          user.user_id,
          subscription.endpoint,
          JSON.stringify(subscription),
          req.headers['user-agent'] || null,
        ]
      );

      return jsonResponse(res, { success: true });
    } catch (err) {
      console.error('Failed to save push subscription:', err);
      return jsonResponse(res, { error: 'Failed to save subscription' }, 500);
    }
  }

  if (req.method === 'DELETE') {
    const input = await getBody(req);
    const endpoint = input?.endpoint || req.query.endpoint;

    if (!endpoint) {
      return jsonResponse(res, { error: 'Endpoint is required' }, 400);
    }

    await db.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [user.user_id, endpoint]
    );

    return jsonResponse(res, { success: true });
  }

  return jsonResponse(res, { error: 'Method not allowed' }, 405);
};

async function ensurePushTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      subscription JSONB NOT NULL,
      user_agent TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS endpoint TEXT`);
  await db.query(`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS user_agent TEXT NULL`);
  await db.query(`
    ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id)`);

  await db.query(`
    UPDATE push_subscriptions
    SET endpoint = subscription->>'endpoint',
        updated_at = COALESCE(updated_at, NOW())
    WHERE endpoint IS NULL
  `);

  await db.query(`DELETE FROM push_subscriptions WHERE endpoint IS NULL OR endpoint = ''`);
  await db.query(`ALTER TABLE push_subscriptions ALTER COLUMN endpoint SET NOT NULL`);

  await db.query(`
    DELETE FROM push_subscriptions a
    USING push_subscriptions b
    WHERE a.id < b.id
      AND a.endpoint = b.endpoint
  `);


  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'push_subscriptions_endpoint_key'
      ) THEN
        BEGIN
          ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);
        EXCEPTION WHEN duplicate_table OR duplicate_object THEN
          NULL;
        END;
      END IF;
    END $$;
  `);
}
