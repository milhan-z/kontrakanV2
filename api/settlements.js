/**
 * api/settlements.js — Settlements API (Pengganti settlements.php)
 * GET    - List settlements
 * POST   - Create settlement + notification
 * DELETE - Delete settlement
 */

const { getDB, setCors, jsonResponse, requireAuth, getBody, handleOptions } = require('../lib/db');
const { sendPushNotification } = require('../lib/webpush');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  // Route /api/debt_details → debt details between 2 users
  if ((req.url || '').includes('/debt_details')) return debtDetails(req, res, user);

  if (req.method === 'GET')    return listSettlements(req, res, user);
  if (req.method === 'POST')   return createSettlement(req, res, user);
  if (req.method === 'DELETE') return deleteSettlement(req, res, user);

  return jsonResponse(res, { error: 'Method not allowed' }, 405);
};

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

async function getPairSummary(db, debtorId, creditorId) {
  const [forwardExpResult, forwardSetResult, reverseExpResult, reverseSetResult] = await Promise.all([
    db.query(`
      SELECT e.id, e.description, e.category, e.amount as total_amount,
             es.amount as split_amount, e.created_at
      FROM expenses e
      JOIN expense_splits es ON es.expense_id = e.id
      WHERE e.paid_by = $1 AND es.user_id = $2 AND e.category != 'Listrik'
      ORDER BY e.created_at DESC
    `, [creditorId, debtorId]),
    db.query(`
      SELECT id, amount, created_at, receipt_image
      FROM settlements
      WHERE from_user = $1 AND to_user = $2
      ORDER BY created_at DESC
    `, [debtorId, creditorId]),
    db.query(`
      SELECT e.id, e.description, e.category, e.amount as total_amount,
             es.amount as split_amount, e.created_at
      FROM expenses e
      JOIN expense_splits es ON es.expense_id = e.id
      WHERE e.paid_by = $1 AND es.user_id = $2 AND e.category != 'Listrik'
      ORDER BY e.created_at DESC
    `, [debtorId, creditorId]),
    db.query(`
      SELECT id, amount, created_at, receipt_image
      FROM settlements
      WHERE from_user = $1 AND to_user = $2
      ORDER BY created_at DESC
    `, [creditorId, debtorId]),
  ]);

  const forwardExpenses = forwardExpResult.rows.reduce((s, e) => s + parseFloat(e.split_amount), 0);
  const forwardSettled  = forwardSetResult.rows.reduce((s, r) => s + parseFloat(r.amount), 0);
  const reverseExpenses = reverseExpResult.rows.reduce((s, e) => s + parseFloat(e.split_amount), 0);
  const reverseSettled  = reverseSetResult.rows.reduce((s, r) => s + parseFloat(r.amount), 0);

  // Net debt from debtor → creditor.
  // Example:
  // - creditor paid 100 split debtor 50 = debtor owes creditor 50
  // - debtor paid 10 split creditor 5 = creditor owes debtor 5
  // Net debtor owes creditor = 50 - 5 = 45
  const forwardOutstanding = forwardExpenses - forwardSettled;
  const reverseOutstanding = reverseExpenses - reverseSettled;
  const netRemaining = roundMoney(forwardOutstanding - reverseOutstanding);

  return {
    expenses: forwardExpResult.rows,
    settlements: forwardSetResult.rows,
    reverse_expenses: reverseExpResult.rows,
    reverse_settlements: reverseSetResult.rows,
    raw_forward_expenses: roundMoney(forwardExpenses),
    raw_forward_settled: roundMoney(forwardSettled),
    raw_reverse_expenses: roundMoney(reverseExpenses),
    raw_reverse_settled: roundMoney(reverseSettled),
    net_offset: roundMoney(reverseOutstanding),
    remaining: netRemaining > 0 ? netRemaining : 0,
  };
}

async function listSettlements(req, res, user) {
  const db = getDB();
  const limit = parseInt(req.query.limit || '50');
  const userId = req.query.user_id ? parseInt(req.query.user_id) : null;

  let sql = `
    SELECT s.*,
           fu.display_name as from_name,
           tu.display_name as to_name
    FROM settlements s
    JOIN users fu ON s.from_user = fu.id
    JOIN users tu ON s.to_user = tu.id
  `;
  const params = [];

  if (userId) {
    params.push(userId, userId);
    sql += ` WHERE (s.from_user = $1 OR s.to_user = $2)`;
  }

  params.push(limit);
  sql += ` ORDER BY s.created_at DESC LIMIT $${params.length}`;

  const result = await db.query(sql, params);
  return jsonResponse(res, { settlements: result.rows });
}

async function createSettlement(req, res, user) {
  const input = await getBody(req);

  const fromUser = parseInt(input.from_user || user.user_id);
  const toUser   = parseInt(input.to_user || 0);
  const amount   = parseFloat(input.amount || 0);
  const receiptImage = input.receipt_image || null; // Cloudinary URL dari frontend

  if (!toUser || amount <= 0) {
    return jsonResponse(res, { error: 'Invalid to_user or amount' }, 400);
  }
  if (toUser === fromUser) {
    return jsonResponse(res, { error: 'Cannot settle to yourself' }, 400);
  }
  if (user.user_id !== fromUser && user.user_id !== toUser) {
    return jsonResponse(res, { error: 'Not authorized to record this settlement' }, 403);
  }

  const db = getDB();

  // Verify both users exist
  const usersResult = await db.query(
    'SELECT id, display_name FROM users WHERE id = ANY($1)',
    [[fromUser, toUser]]
  );
  if (usersResult.rows.length < 2) {
    return jsonResponse(res, { error: 'User not found' }, 404);
  }
  const userMap = {};
  usersResult.rows.forEach(u => { userMap[u.id] = u.display_name; });

  const pairSummary = await getPairSummary(db, fromUser, toUser);
  const remaining = pairSummary.remaining;
  if (remaining <= 0) {
    return jsonResponse(res, { error: 'Tidak ada sisa hutang yang perlu dibayar' }, 400);
  }
  if (amount > remaining + 0.01) {
    return jsonResponse(res, { error: `Nominal melebihi sisa hutang Rp ${remaining.toLocaleString('id-ID')}` }, 400);
  }

  const client = await db.connect();
  const pushJobs = [];
  try {
    await client.query('BEGIN');

    const settlResult = await client.query(
      'INSERT INTO settlements (from_user, to_user, amount, receipt_image) VALUES ($1, $2, $3, $4) RETURNING id',
      [fromUser, toUser, amount, receiptImage]
    );
    const settlementId = settlResult.rows[0].id;

    const amountFormatted = new Intl.NumberFormat('id-ID').format(amount);

    if (user.user_id === fromUser) {
      // Debtor recorded → notify creditor
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, related_id)
         VALUES ($1, 'Pembayaran Diterima', $2, 'settlement', $3)`,
        [toUser, `${userMap[fromUser]} sudah membayar Rp ${amountFormatted} ke kamu`, settlementId]
      );
      pushJobs.push(
        sendPushNotification(toUser, 'Pembayaran Diterima', `${userMap[fromUser]} sudah membayar Rp ${amountFormatted} ke kamu`, '/settle.html')
      );
    } else {
      // Creditor confirmed → notify debtor
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, related_id)
         VALUES ($1, 'Pembayaran Dikonfirmasi', $2, 'settlement', $3)`,
        [fromUser, `${userMap[toUser]} mengkonfirmasi pembayaran Rp ${amountFormatted} dari kamu`, settlementId]
      );
      pushJobs.push(
        sendPushNotification(fromUser, 'Pembayaran Dikonfirmasi', `${userMap[toUser]} mengkonfirmasi pembayaran Rp ${amountFormatted} dari kamu`, '/settle.html')
      );
    }

    await client.query('COMMIT');
    await Promise.allSettled(pushJobs);
    return jsonResponse(res, { success: true, message: 'Settlement recorded', settlement_id: settlementId }, 201);

  } catch (err) {
    await client.query('ROLLBACK');
    return jsonResponse(res, { error: 'Failed to create settlement: ' + err.message }, 500);
  } finally {
    client.release();
  }
}

async function deleteSettlement(req, res, user) {
  const id = parseInt(req.query.id || '0', 10);
  if (!id) return jsonResponse(res, { error: 'Settlement ID required' }, 400);

  const db = getDB();
  const result = await db.query(
    'SELECT id, from_user, to_user FROM settlements WHERE id = $1',
    [id]
  );
  const settlement = result.rows[0];
  if (!settlement) return jsonResponse(res, { error: 'Pembayaran tidak ditemukan' }, 404);

  if (user.role !== 'admin') {
    return jsonResponse(res, { error: 'Tidak boleh menghapus pembayaran ini' }, 403);
  }

  await db.query('DELETE FROM settlements WHERE id = $1', [id]);
  return jsonResponse(res, { success: true, message: 'Pembayaran berhasil dihapus' });
}

// Debt details between 2 users (served via /api/debt_details → /api/settlements.js)
async function debtDetails(req, res, user) {
  const creditorId = parseInt(req.query.creditor_id || '0');
  const debtorId   = parseInt(req.query.debtor_id   || '0');
  if (!creditorId || !debtorId)
    return jsonResponse(res, { error: 'creditor_id and debtor_id required' }, 400);

  const db = getDB();
  const summary = await getPairSummary(db, debtorId, creditorId);

  // Keep old frontend fields compatible, but make the math net-aware.
  // total_settled here means "paid/offset", so reverse outstanding debt is counted as offset.
  const totalExpenses = summary.raw_forward_expenses;
  const totalSettledOrOffset = roundMoney(totalExpenses - summary.remaining);

  return jsonResponse(res, {
    expenses: summary.expenses,
    settlements: summary.settlements,
    reverse_expenses: summary.reverse_expenses,
    reverse_settlements: summary.reverse_settlements,
    total_expenses: totalExpenses,
    total_settled: totalSettledOrOffset < 0 ? 0 : totalSettledOrOffset,
    net_offset: summary.net_offset,
    remaining: summary.remaining,
  });
}
