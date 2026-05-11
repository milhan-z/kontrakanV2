/**
 * api/users.js — Users API (Pengganti users.php)
 * GET  → List all users
 * PUT  → Update current user profile / password
 */

const bcrypt = require('bcryptjs');
const { getDB, setCors, jsonResponse, requireAuth, getBody, handleOptions } = require('../lib/db');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') return listUsers(req, res, user);
  if (req.method === 'PUT') return updateProfile(req, res, user);

  return jsonResponse(res, { error: 'Method not allowed' }, 405);
};

async function listUsers(req, res, user) {
  const db = getDB();
  let result;

  if (user.role === 'admin') {
    result = await db.query(
      "SELECT id, username, display_name, role FROM users ORDER BY role DESC, display_name"
    );
  } else {
    result = await db.query(
      "SELECT id, username, display_name, role FROM users WHERE role != 'admin' ORDER BY display_name"
    );
  }

  return jsonResponse(res, { users: result.rows });
}

async function updateProfile(req, res, user) {
  const input = await getBody(req);
  const db = getDB();

  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE
  `);

  if (input.display_name !== undefined) {
    await db.query('UPDATE users SET display_name = $1 WHERE id = $2', [String(input.display_name || '').trim(), user.user_id]);
  }

  if (input.phone_wa !== undefined) {
    await db.query('UPDATE users SET phone_wa = $1 WHERE id = $2', [String(input.phone_wa || '').trim(), user.user_id]);
  }

  if (input.new_password && input.new_password.length > 0) {
    const hash = await bcrypt.hash(input.new_password, 10);
    await db.query(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
      [hash, user.user_id]
    );
  }

  return jsonResponse(res, { success: true, message: 'Profile updated' });
}
