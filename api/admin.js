/**
 * api/admin.js - Admin API
 * GET    ?action=stats              - Statistics
 * POST   ?action=add-user           - Add member
 * PUT    ?action=update-user        - Update member data
 * PUT    ?action=reset-password     - Reset password
 * DELETE ?action=delete-user&id=X   - Delete user
 * DELETE ?action=delete-jastip&id=X - Delete one jastip order
 * DELETE ?action=clear-expenses     - Clear finance data
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDB, setCors, jsonResponse, requireAdmin, getBody, handleOptions, createToken } = require('../lib/db');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAdmin(req, res);
  if (!user) return;

  const action = req.query.action || '';

  // Route /api/reset → reset handler (admin-only data wipe)
  if ((req.url || '').includes('/reset')) return resetData(req, res);

  if (req.method === 'GET'    && action === 'stats')          return getStats(req, res);
  if (req.method === 'POST'   && action === 'add-user')       return addUser(req, res);
  if (req.method === 'PUT'    && action === 'update-user')    return updateUser(req, res, user);
  if (req.method === 'PUT'    && action === 'reset-password') return resetPassword(req, res);
  if (req.method === 'DELETE' && action === 'delete-user')    return deleteUser(req, res);
  if (req.method === 'DELETE' && action === 'delete-jastip')  return deleteJastip(req, res);
  if (req.method === 'DELETE' && action === 'clear-expenses') return clearExpenses(req, res);

  return jsonResponse(res, { error: 'Invalid action' }, 400);
};

async function getStats(req, res) {
  const db = getDB();

  const [
    usersCount,
    totExp,
    totSettle,
    expCount,
    infoCount,
    notifCount,
    unreadNotifCount,
    pushCount,
    activeJastipCount,
    closedJastipCount,
    completedJastipCount,
    byCategory,
    byMonth,
  ] = await Promise.all([
    safeScalar(db, 'SELECT COUNT(*) AS value FROM users'),
    safeScalar(db, 'SELECT COALESCE(SUM(amount), 0) AS value FROM expenses'),
    safeScalar(db, 'SELECT COALESCE(SUM(amount), 0) AS value FROM settlements'),
    safeScalar(db, 'SELECT COUNT(*) AS value FROM expenses'),
    safeScalar(db, 'SELECT COUNT(*) AS value FROM info_kontrakan'),
    safeScalar(db, 'SELECT COUNT(*) AS value FROM notifications'),
    safeScalar(db, 'SELECT COUNT(*) AS value FROM notifications WHERE is_read = FALSE'),
    safeScalar(db, 'SELECT COUNT(*) AS value FROM push_subscriptions'),
    safeScalar(db, "SELECT COUNT(*) AS value FROM jastip_orders WHERE status = 'open'"),
    safeScalar(db, "SELECT COUNT(*) AS value FROM jastip_orders WHERE status = 'closed'"),
    safeScalar(db, "SELECT COUNT(*) AS value FROM jastip_orders WHERE status = 'completed'"),
    safeRows(db, `
      SELECT category, COUNT(*) as count, SUM(amount) as total
      FROM expenses GROUP BY category ORDER BY total DESC
    `),
    safeRows(db, `
      SELECT TO_CHAR(created_at, 'YYYY-MM') as month, SUM(amount) as total
      FROM expenses GROUP BY month ORDER BY month DESC LIMIT 6
    `),
  ]);

  return jsonResponse(res, {
    users_count:       parseInt(usersCount, 10) || 0,
    total_expenses:    parseFloat(totExp) || 0,
    total_settlements: parseFloat(totSettle) || 0,
    expense_count:     parseInt(expCount, 10) || 0,
    info_count:        parseInt(infoCount, 10) || 0,
    notifications_count: parseInt(notifCount, 10) || 0,
    unread_notifications_count: parseInt(unreadNotifCount, 10) || 0,
    push_subscriptions_count: parseInt(pushCount, 10) || 0,
    jastip: {
      open: parseInt(activeJastipCount, 10) || 0,
      closed: parseInt(closedJastipCount, 10) || 0,
      completed: parseInt(completedJastipCount, 10) || 0,
    },
    by_category:       byCategory,
    by_month:          byMonth,
  });
}

async function addUser(req, res) {
  const input = await getBody(req);
  const normalizedUsername = String(input.username || '').trim().toLowerCase();
  const normalizedDisplayName = String(input.display_name || '').trim();
  const password = String(input.password || '');

  if (!normalizedUsername || !normalizedDisplayName || !password) {
    return jsonResponse(res, { error: 'Username, display_name, dan password harus diisi' }, 400);
  }
  if (normalizedUsername.length < 3) return jsonResponse(res, { error: 'Username minimal 3 karakter' }, 400);
  if (password.length < 6) return jsonResponse(res, { error: 'Password minimal 6 karakter' }, 400);
  if (!/^[a-z0-9._-]+$/.test(normalizedUsername)) {
    return jsonResponse(res, { error: 'Username hanya boleh huruf kecil, angka, titik, underscore, atau strip' }, 400);
  }
  if (normalizedDisplayName.length > 100) {
    return jsonResponse(res, { error: 'Nama tampilan maksimal 100 karakter' }, 400);
  }

  const db = getDB();
  await ensureUserColumns(db);
  const existing = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [normalizedUsername]);
  if (existing.rows.length > 0) {
    return jsonResponse(res, { error: 'Username sudah digunakan' }, 400);
  }

  const hash = await bcrypt.hash(password, 10);
  const result = await db.query(
    "INSERT INTO users (username, password_hash, display_name, role, must_change_password) VALUES ($1, $2, $3, 'member', TRUE) RETURNING id",
    [normalizedUsername, hash, normalizedDisplayName]
  );

  return jsonResponse(res, {
    success: true,
    message: 'Member berhasil ditambahkan',
    user_id: result.rows[0].id,
  }, 201);
}

async function updateUser(req, res, adminUser) {
  const input = await getBody(req);
  const userId = parseInt(input.user_id || input.id || '0', 10);
  if (!userId) return jsonResponse(res, { error: 'User ID required' }, 400);

  const normalizedUsername = String(input.username || '').trim().toLowerCase();
  const normalizedDisplayName = String(input.display_name || '').trim();
  const phoneWa = String(input.phone_wa || '').trim() || null;
  const role = String(input.role || '').trim().toLowerCase();
  const mustChangePassword = Boolean(input.must_change_password);

  if (!normalizedUsername || !normalizedDisplayName || !role) {
    return jsonResponse(res, { error: 'Username, nama tampilan, dan role harus diisi' }, 400);
  }
  if (normalizedUsername.length < 3) return jsonResponse(res, { error: 'Username minimal 3 karakter' }, 400);
  if (!/^[a-z0-9._-]+$/.test(normalizedUsername)) {
    return jsonResponse(res, { error: 'Username hanya boleh huruf kecil, angka, titik, underscore, atau strip' }, 400);
  }
  if (normalizedDisplayName.length > 100) {
    return jsonResponse(res, { error: 'Nama tampilan maksimal 100 karakter' }, 400);
  }
  if (phoneWa && phoneWa.length > 20) {
    return jsonResponse(res, { error: 'Nomor WA maksimal 20 karakter' }, 400);
  }
  if (!['admin', 'member'].includes(role)) {
    return jsonResponse(res, { error: 'Role tidak valid' }, 400);
  }

  const db = getDB();
  await ensureUserColumns(db);

  const currentResult = await db.query(
    'SELECT id, username, display_name, phone_wa, role, COALESCE(must_change_password, FALSE) AS must_change_password FROM users WHERE id = $1',
    [userId]
  );
  const current = currentResult.rows[0];
  if (!current) return jsonResponse(res, { error: 'User tidak ditemukan' }, 404);

  const duplicate = await db.query(
    'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2 LIMIT 1',
    [normalizedUsername, userId]
  );
  if (duplicate.rows.length > 0) {
    return jsonResponse(res, { error: 'Username sudah digunakan user lain' }, 400);
  }

  if (userId === adminUser.user_id && role !== current.role) {
    return jsonResponse(res, { error: 'Tidak bisa mengubah role akun admin yang sedang dipakai' }, 400);
  }

  if (current.role === 'admin' && role !== 'admin') {
    const adminCount = await db.query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
    if (parseInt(adminCount.rows[0].count, 10) <= 1) {
      return jsonResponse(res, { error: 'Minimal harus ada satu admin' }, 400);
    }
  }

  const result = await db.query(
    `UPDATE users
     SET username = $1,
         display_name = $2,
         phone_wa = $3,
         role = $4,
         must_change_password = $5
     WHERE id = $6
     RETURNING id, username, display_name, phone_wa, role, COALESCE(must_change_password, FALSE) AS must_change_password`,
    [normalizedUsername, normalizedDisplayName, phoneWa, role, mustChangePassword, userId]
  );
  const updatedUser = result.rows[0];

  let token = null;
  if (userId === adminUser.user_id) {
    token = createToken({
      user_id: updatedUser.id,
      role: updatedUser.role,
      display_name: updatedUser.display_name,
    });
    res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60*60*24*30}`);
  }

  return jsonResponse(res, {
    success: true,
    message: 'User berhasil diperbarui',
    user: updatedUser,
    token,
  });
}

async function resetPassword(req, res) {
  const input = await getBody(req);
  const userId = parseInt(input.user_id || '0');
  if (!userId) return jsonResponse(res, { error: 'User ID required' }, 400);

  const db = getDB();
  await ensureUserColumns(db);

  const temporaryPassword = generateTemporaryPassword();
  const hash = await bcrypt.hash(temporaryPassword, 10);
  await db.query(
    'UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2',
    [hash, userId]
  );

  return jsonResponse(res, {
    success: true,
    message: 'Password berhasil direset',
    temporary_password: temporaryPassword,
    must_change_password: true,
  });
}

async function deleteUser(req, res) {
  const userId = parseInt(req.query.id || '0');
  if (!userId) return jsonResponse(res, { error: 'User ID required' }, 400);

  const db = getDB();
  const userRes = await db.query('SELECT id, role, display_name FROM users WHERE id = $1', [userId]);
  const user = userRes.rows[0];

  if (!user) return jsonResponse(res, { error: 'User tidak ditemukan' }, 404);
  if (user.role === 'admin') return jsonResponse(res, { error: 'Tidak bisa menghapus admin' }, 403);

  const [expCheck, splitCheck, settlCheck, openJastipCheck, pendingJastipItemCheck] = await Promise.all([
    db.query('SELECT COUNT(*) as count FROM expenses WHERE paid_by = $1', [userId]),
    db.query('SELECT COUNT(*) as count FROM expense_splits WHERE user_id = $1', [userId]),
    db.query('SELECT COUNT(*) as count FROM settlements WHERE from_user = $1 OR to_user = $1', [userId]),
    safeCount(db, "SELECT COUNT(*) AS count FROM jastip_orders WHERE opened_by = $1 AND status IN ('open', 'closed')", [userId]),
    safeCount(db, "SELECT COUNT(*) AS count FROM jastip_items ji JOIN jastip_orders jo ON jo.id = ji.jastip_id WHERE ji.user_id = $1 AND jo.status IN ('open', 'closed')", [userId]),
  ]);

  if (parseInt(expCheck.rows[0].count) > 0)
    return jsonResponse(res, { error: 'User masih punya transaksi. Hapus transaksi dulu.' }, 400);
  if (parseInt(splitCheck.rows[0].count) > 0)
    return jsonResponse(res, { error: 'User masih terlibat dalam pembagian biaya.' }, 400);
  if (parseInt(settlCheck.rows[0].count) > 0)
    return jsonResponse(res, { error: 'User masih punya riwayat pembayaran.' }, 400);
  if (parseInt(openJastipCheck) > 0)
    return jsonResponse(res, { error: 'User masih punya jastip aktif/ditutup.' }, 400);
  if (parseInt(pendingJastipItemCheck) > 0)
    return jsonResponse(res, { error: 'User masih punya nitipan di jastip aktif.' }, 400);

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

async function deleteJastip(req, res) {
  const id = parseInt(req.query.id || req.query.order_id || '0', 10);
  if (!id) return jsonResponse(res, { error: 'Jastip ID required' }, 400);

  const db = getDB();
  const existing = await safeRows(db, 'SELECT id, title FROM jastip_orders WHERE id = $1', [id]);
  if (!existing[0]) return jsonResponse(res, { error: 'Jastip tidak ditemukan' }, 404);

  await db.query('DELETE FROM jastip_orders WHERE id = $1', [id]);
  return jsonResponse(res, {
    success: true,
    message: `Jastip ${existing[0].title} berhasil dihapus`,
  });
}

// Reset specific data (served via /api/reset → /api/admin.js)
async function resetData(req, res) {
  const input = req.method === 'POST' ? await require('../lib/db').getBody(req) : {};
  const target = normalizeResetTarget(input.target || input.type);
  const db = getDB();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    if (target === 'all') {
      await deleteTable(client, 'jastip_items');
      await deleteTable(client, 'jastip_orders');
      await deleteTable(client, 'settlements');
      await deleteTable(client, 'expense_splits');
      await deleteTable(client, 'expenses');
      await deleteTable(client, 'notifications');
      await deleteTable(client, 'info_kontrakan');
      await client.query('COMMIT');
      return jsonResponse(res, { success: true, message: 'Semua data sistem berhasil direset' });
    }

    if (target === 'settlements') {
      await deleteTable(client, 'settlements');
      await client.query('COMMIT');
      return jsonResponse(res, { success: true, message: 'Riwayat pembayaran berhasil dihapus' });
    }

    if (target === 'expenses') {
      await deleteTable(client, 'expense_splits');
      await deleteTable(client, 'expenses');
      await client.query('COMMIT');
      return jsonResponse(res, { success: true, message: 'Transaksi berhasil dihapus' });
    }

    if (target === 'info') {
      await deleteTable(client, 'info_kontrakan');
      await client.query('COMMIT');
      return jsonResponse(res, { success: true, message: 'Info kontrakan berhasil dihapus' });
    }

    if (target === 'notifications') {
      await deleteTable(client, 'notifications');
      await client.query('COMMIT');
      return jsonResponse(res, { success: true, message: 'Notifikasi berhasil dihapus' });
    }

    if (target === 'jastip') {
      await deleteTable(client, 'jastip_items');
      await deleteTable(client, 'jastip_orders');
      await client.query('COMMIT');
      return jsonResponse(res, { success: true, message: 'Data jastip berhasil dihapus' });
    }

    await client.query('ROLLBACK');
    return jsonResponse(res, { error: 'Target reset tidak valid' }, 400);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    return jsonResponse(res, { error: err.message }, 500);
  } finally {
    client.release();
  }
}

async function ensureUserColumns(db) {
  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone_wa VARCHAR(20) DEFAULT NULL
  `);
}

function generateTemporaryPassword() {
  return crypto.randomBytes(6).toString('base64url');
}

function normalizeResetTarget(target) {
  const value = String(target || 'all').trim().toLowerCase();
  const aliases = {
    all: 'all',
    semua: 'all',
    transaksi: 'expenses',
    expense: 'expenses',
    expenses: 'expenses',
    settlements: 'settlements',
    settlement: 'settlements',
    payments: 'settlements',
    pembayaran: 'settlements',
    info: 'info',
    notifications: 'notifications',
    notification: 'notifications',
    notifikasi: 'notifications',
    jastip: 'jastip',
  };
  return aliases[value] || value;
}

async function safeRows(db, sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return result.rows;
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return [];
    throw err;
  }
}

async function safeScalar(db, sql, params = []) {
  const rows = await safeRows(db, sql, params);
  if (!rows[0]) return 0;
  if ('value' in rows[0]) return rows[0].value;
  if ('count' in rows[0]) return rows[0].count;
  if ('total' in rows[0]) return rows[0].total;
  return 0;
}

async function safeCount(db, sql, params = []) {
  return safeScalar(db, sql, params);
}

async function deleteTable(client, tableName) {
  const allowedTables = new Set([
    'expenses',
    'expense_splits',
    'settlements',
    'notifications',
    'info_kontrakan',
    'jastip_items',
    'jastip_orders',
  ]);
  if (!allowedTables.has(tableName)) throw new Error('Reset table tidak valid');

  const savepoint = `delete_${tableName}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(`DELETE FROM ${tableName}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    if (err.code === '42P01') return;
    throw err;
  }
}
