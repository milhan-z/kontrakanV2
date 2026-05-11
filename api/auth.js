/**
 * api/auth.js — Authentication API (Pengganti auth.php)
 * POST ?action=login  → Login, return JWT token
 * POST ?action=logout → Logout (client-side token removal)
 * GET  ?action=me     → Get current user info
 */

const bcrypt = require('bcryptjs');
const { getDB, setCors, jsonResponse, requireAuth, createToken, isAuthConfigured, getBody, handleOptions } = require('../lib/db');
const PASSWORD_RESET_VERSION = '2026-05-11-v2';
const ADMIN_PASSWORD_HASH = '$2a$10$MN7Wy0PwAT5yCCMVID.b4uOj5EcA90/n7ezHEVBu3t4YUKsiIvmfC';
const MEMBER_PASSWORD_HASH = '$2a$10$shj1n0fgpSesySekx7B0ueQPQbcQ5zYuMs81wvy0a1vEusOnGiQk2';

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

  if (!isAuthConfigured()) {
    return jsonResponse(res, { error: 'Auth belum dikonfigurasi. Isi JWT_SECRET di environment.' }, 503);
  }

  const db = getDB();
  await ensureAuthBootstrap(db);
  const result = await db.query(
    `SELECT id, username, password_hash, display_name, role,
            COALESCE(must_change_password, FALSE) AS must_change_password
     FROM users
     WHERE LOWER(username) = LOWER($1)`,
    [String(username).trim()]
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
  await ensureAuthBootstrap(db);
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

async function ensureAuthBootstrap(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE
  `);

  const versionRow = await db.query(
    'SELECT value FROM app_settings WHERE key = $1',
    ['password_reset_version']
  );
  if (versionRow.rows[0]?.value === PASSWORD_RESET_VERSION) {
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const adminByUsername = await client.query(
      `SELECT id FROM users WHERE LOWER(username) = 'admin' LIMIT 1`
    );

    if (adminByUsername.rows[0]) {
      await client.query(
        `UPDATE users
         SET role = 'admin',
             password_hash = $1,
             must_change_password = FALSE
         WHERE id = $2`,
        [ADMIN_PASSWORD_HASH, adminByUsername.rows[0].id]
      );
    } else {
      const adminByRole = await client.query(
        `SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`
      );

      if (adminByRole.rows[0]) {
        await client.query(
          `UPDATE users
           SET username = 'admin',
               password_hash = $1,
               must_change_password = FALSE
           WHERE id = $2`,
          [ADMIN_PASSWORD_HASH, adminByRole.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO users (username, password_hash, display_name, role, must_change_password)
           VALUES ('admin', $1, 'Admin', 'admin', FALSE)`,
          [ADMIN_PASSWORD_HASH]
        );
      }
    }

    await client.query(
      `UPDATE users
       SET password_hash = $1,
           must_change_password = FALSE
       WHERE role = 'admin'`,
      [ADMIN_PASSWORD_HASH]
    );

    await client.query(
      `UPDATE users
       SET password_hash = $1,
           must_change_password = FALSE
       WHERE role != 'admin'`,
      [MEMBER_PASSWORD_HASH]
    );

    await client.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      ['password_reset_version', PASSWORD_RESET_VERSION]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
