/**
 * api/auth.js — Authentication API (Pengganti auth.php)
 * POST ?action=login  → Login, return JWT token
 * POST ?action=logout → Logout (client-side token removal)
 * GET  ?action=me     → Get current user info
 */

const bcrypt = require('bcryptjs');
const { getDB, setCors, jsonResponse, requireAuth, createToken, getBody, handleOptions } = require('../lib/db');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const action = req.query.action || '';

  if (req.method === 'POST' && action === 'login') {
    return handleLogin(req, res);
  }
  if (req.method === 'POST' && action === 'logout') {
    return handleLogout(req, res);
  }
  if (req.method === 'GET' && action === 'me') {
    return handleMe(req, res);
  }

  return jsonResponse(res, { error: 'Invalid action' }, 400);
};

async function handleLogin(req, res) {
  const input = await getBody(req);
  const { username, password } = input;

  if (!username || !password) {
    return jsonResponse(res, { error: 'Username dan password harus diisi' }, 400);
  }

  const db = getDB();
  const result = await db.query(
    'SELECT id, username, password_hash, display_name, role, COALESCE(must_change_password, FALSE) AS must_change_password FROM users WHERE username = $1',
    [username]
  );
  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return jsonResponse(res, { error: 'Username atau password salah' }, 401);
  }

  // Buat JWT token
  const token = createToken({
    user_id: user.id,
    role: user.role,
    display_name: user.display_name,
  });

  // Set cookie sekaligus kirim token di body (flexible untuk client)
  res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60*60*24*30}`);

  return jsonResponse(res, {
    success: true,
    token, // Client bisa simpan di localStorage
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      must_change_password: user.must_change_password,
    },
  });
}

function handleLogout(req, res) {
  // Clear cookie di sisi server
  res.setHeader('Set-Cookie', 'token=; Path=/; HttpOnly; Max-Age=0');
  return jsonResponse(res, { success: true, message: 'Logged out' });
}

async function handleMe(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const db = getDB();
  const result = await db.query(
    'SELECT id, username, display_name, phone_wa, role, COALESCE(must_change_password, FALSE) AS must_change_password FROM users WHERE id = $1',
    [user.user_id]
  );
  const userData = result.rows[0];

  if (!userData) {
    return jsonResponse(res, { error: 'User not found' }, 404);
  }

  return jsonResponse(res, { user: userData });
}
