/**
 * api/info.js — Info Kontrakan API (Pengganti info.php)
 * GET    → List all info
 * POST   → Add new info (with optional Cloudinary image URL)
 * DELETE → Delete info
 */

const { getDB, setCors, jsonResponse, requireAuth, getBody, handleOptions } = require('../lib/db');
const { sendPushNotification } = require('../lib/webpush');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET')    return listInfo(req, res, user);
  if (req.method === 'POST')   return addInfo(req, res, user);
  if (req.method === 'DELETE') return deleteInfo(req, res, user);

  return jsonResponse(res, { error: 'Method not allowed' }, 405);
};

async function listInfo(req, res, user) {
  const db = getDB();
  const limit = parseInt(req.query.limit || '50');

  const result = await db.query(`
    SELECT i.*, u.display_name as author_name
    FROM info_kontrakan i
    JOIN users u ON i.user_id = u.id
    ORDER BY i.created_at DESC
    LIMIT $1
  `, [limit]);

  return jsonResponse(res, { info: result.rows });
}

async function addInfo(req, res, user) {
  const input = await getBody(req);
  const title      = input.title || '';
  const content    = input.content || '';
  const image_path = input.image_path || null; // Cloudinary URL dari frontend

  if (!title) return jsonResponse(res, { error: 'Title is required' }, 400);

  const db = getDB();
  const client = await db.connect();
  let infoId;
  const pushJobs = [];

  try {
    await client.query('BEGIN');

    const result = await client.query(
      'INSERT INTO info_kontrakan (user_id, title, content, image_path) VALUES ($1, $2, $3, $4) RETURNING id',
      [user.user_id, title, content, image_path]
    );
    infoId = result.rows[0].id;

    const users = await client.query('SELECT id FROM users WHERE id != $1', [user.user_id]);
    const message = content
      ? `${user.display_name || 'Teman kontrakan'} menambahkan info: ${String(content).slice(0, 120)}`
      : `${user.display_name || 'Teman kontrakan'} menambahkan info baru`;

    for (const row of users.rows) {
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, related_id)
         VALUES ($1, $2, $3, 'info', $4)`,
        [row.id, title, message, infoId]
      );
      pushJobs.push(
        sendPushNotification(row.id, 'Info Kontrakan Baru', title, '/dashboard.html')
          .catch(err => console.error('Failed to send info push notification:', err))
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return jsonResponse(res, { error: 'Failed to create info: ' + err.message }, 500);
  } finally {
    client.release();
  }

  await Promise.allSettled(pushJobs);

  return jsonResponse(res, { success: true, id: infoId }, 201);
}

async function deleteInfo(req, res, user) {
  const infoId = parseInt(req.query.id || '0');
  if (!infoId) return jsonResponse(res, { error: 'Info ID required' }, 400);

  const db = getDB();
  const result = await db.query('SELECT user_id, image_path FROM info_kontrakan WHERE id = $1', [infoId]);
  const info = result.rows[0];

  if (!info) return jsonResponse(res, { error: 'Info not found' }, 404);
  if (info.user_id !== user.user_id && user.role !== 'admin') {
    return jsonResponse(res, { error: 'Not authorized' }, 403);
  }

  // Note: Cloudinary images bisa dihapus via Cloudinary API jika perlu
  // Di sini hanya hapus record dari DB
  await db.query('DELETE FROM info_kontrakan WHERE id = $1', [infoId]);

  return jsonResponse(res, { success: true });
}
