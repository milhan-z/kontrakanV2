/**
 * api/admin.js — Admin API (Pengganti admin.php)
 * GET  ?action=stats          → Statistics
 * POST ?action=add-user       → Add member
 * PUT  ?action=reset-password → Reset password
 * DELETE ?action=delete-user&id=X    → Delete user
 * DELETE ?action=clear-expenses      → Clear all data
 */

const bcrypt = require('bcryptjs');
const { getDB, setCors, jsonResponse, requireAdmin, getBody, handleOptions } = require('../lib/db');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAdmin(req, res);
  if (!user) return;

  const action = req.query.action || '';

  if (req.method === 'GET'    && action === 'stats')          return getStats(req, res);
  if (req.method === 'POST'   && action === 'add-user')       return addUser(req, res);
  if (req.method === 'PUT'    && action === 'reset-password') return resetPassword(req, res);
  if (req.method === 'DELETE' && action === 'delete-user')    return deleteUser(req, res);
  if (req.method === 'DELETE' && action === 'clear-expenses') return clearExpenses(req, res);

  return jsonResponse(res, { error: 'Invalid action' }, 400);
};

async function getStats(req, res) {
  const db = getDB();

  const [totExp, totSettle, expCount, byCategory, byMonth] = await Promise.all([
    db.query("SELECT COALESCE(SUM(amount), 0) as total FROM expenses"),
    db.query("SELECT COALESCE(SUM(amount), 0) as total FROM settlements"),
    db.query("SELECT COUNT(*) as count FROM expenses"),
    db.query(`
      SELECT category, COUNT(*) as count, SUM(amount) as total
      FROM expenses GROUP BY category ORDER BY total DESC
    `),
    db.query(`
      SELECT TO_CHAR(created_at, 'YYYY-MM') as month, SUM(amount) as total
      FROM expenses GROUP BY month ORDER BY month DESC LIMIT 6
    `),
  ]);

  return jsonResponse(res, {
    total_expenses:    parseFloat(totExp.rows[0].total),
    total_settlements: parseFloat(totSettle.rows[0].total),
    expense_count:     parseInt(expCount.rows[0].count),
    by_category:       byCategory.rows,
    by_month:          byMonth.rows,
  });
}

async function addUser(req, res) {
  const input = await getBody(req);
  const { username, display_name, password } = input;

  if (!username || !display_name || !password) {
    return jsonResponse(res, { error: 'Username, display_name, dan password harus diisi' }, 400);
  }
  if (username.length < 3) return jsonResponse(res, { error: 'Username minimal 3 karakter' }, 400);
  if (password.length < 6) return jsonResponse(res, { error: 'Password minimal 6 karakter' }, 400);

  const db = getDB();
  const existing = await db.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rows.length > 0) {
    return jsonResponse(res, { error: 'Username sudah digunakan' }, 400);
  }

  const hash = await bcrypt.hash(password, 10);
  const result = await db.query(
    "INSERT INTO users (username, password_hash, display_name, role) VALUES ($1, $2, $3, 'member') RETURNING id",
    [username, hash, display_name]
  );

  return jsonResponse(res, {
    success: true,
    message: 'Member berhasil ditambahkan',
    user_id: result.rows[0].id,
  }, 201);
}

async function resetPassword(req, res) {
  const input = await getBody(req);
  const userId = parseInt(input.user_id || '0');
  if (!userId) return jsonResponse(res, { error: 'User ID required' }, 400);

  const hash = await bcrypt.hash('kontrakan123', 10);
  const db = getDB();
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);

  return jsonResponse(res, { success: true, message: 'Password reset to: kontrakan123' });
}

async function deleteUser(req, res) {
  const userId = parseInt(req.query.id || '0');
  if (!userId) return jsonResponse(res, { error: 'User ID required' }, 400);

  const db = getDB();
  const userRes = await db.query('SELECT id, role, display_name FROM users WHERE id = $1', [userId]);
  const user = userRes.rows[0];

  if (!user) return jsonResponse(res, { error: 'User tidak ditemukan' }, 404);
  if (user.role === 'admin') return jsonResponse(res, { error: 'Tidak bisa menghapus admin' }, 403);

  const [expCheck, splitCheck, settlCheck] = await Promise.all([
    db.query('SELECT COUNT(*) as count FROM expenses WHERE paid_by = $1', [userId]),
    db.query('SELECT COUNT(*) as count FROM expense_splits WHERE user_id = $1', [userId]),
    db.query('SELECT COUNT(*) as count FROM settlements WHERE from_user = $1 OR to_user = $1', [userId]),
  ]);

  if (parseInt(expCheck.rows[0].count) > 0)
    return jsonResponse(res, { error: 'User masih punya transaksi. Hapus transaksi dulu.' }, 400);
  if (parseInt(splitCheck.rows[0].count) > 0)
    return jsonResponse(res, { error: 'User masih terlibat dalam pembagian biaya.' }, 400);
  if (parseInt(settlCheck.rows[0].count) > 0)
    return jsonResponse(res, { error: 'User masih punya riwayat pembayaran.' }, 400);

  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  return jsonResponse(res, { success: true, message: `Member ${user.display_name} berhasil dihapus` });
}

async function clearExpenses(req, res) {
  const db = getDB();
  await db.query('DELETE FROM expenses');
  await db.query('DELETE FROM settlements');
  await db.query('DELETE FROM notifications');
  return jsonResponse(res, { success: true, message: 'All expenses, settlements, and notifications cleared' });
}
