/**
 * api/info.js — Info Kontrakan API (Pengganti info.php)
 * GET    → List all info
 * POST   → Add new info (with optional Cloudinary image URL)
 * DELETE → Delete info
 */

const { getDB, setCors, jsonResponse, requireAuth, getBody, handleOptions } = require('../lib/db');

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
  const result = await db.query(
    'INSERT INTO info_kontrakan (user_id, title, content, image_path) VALUES ($1, $2, $3, $4) RETURNING id',
    [user.user_id, title, content, image_path]
  );

  return jsonResponse(res, { success: true, id: result.rows[0].id }, 201);
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
