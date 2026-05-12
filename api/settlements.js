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

function toTimestamp(value) {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * Bidirectional debt details with reset detection.
 *
 * Positive running balance = debtor owes creditor.
 * Negative running balance = creditor owes debtor.
 *
 * UI semantics:
 * - total_settled is ONLY real transfer/payment settlements from debtor to creditor.
 * - reverse_expenses are shown as transaction offsets, not as "Sudah Dibayar".
 * - reverse_settlements are payments in the opposite direction. They are shown
 *   explicitly as "Pembayaran Balik" because they add to the currently viewed
 *   direction after debts flip again.
 * - remaining = forward expenses - real settlements - reverse expenses + reverse settlements.
 */
async function getDebtDetailsSummary(db, debtorId, creditorId) {
  const [expenseResult, settlementResult] = await Promise.all([
    db.query(`
      SELECT e.id, e.description, e.category, e.created_at,
             es.amount as split_amount,
             e.paid_by as creditor,
             es.user_id as debtor
      FROM expenses e
      JOIN expense_splits es ON e.id = es.expense_id
      WHERE ((e.paid_by = $1 AND es.user_id = $2) OR (e.paid_by = $2 AND es.user_id = $1))
        AND e.category != 'Listrik'
      ORDER BY e.created_at ASC
    `, [creditorId, debtorId]),
    db.query(`
      SELECT id, from_user, to_user, amount, created_at, receipt_image
      FROM settlements
      WHERE (from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1)
      ORDER BY created_at ASC
    `, [creditorId, debtorId]),
  ]);

  const transactions = [];

  for (const e of expenseResult.rows) {
    const creditor = parseInt(e.creditor, 10);
    const debtor = parseInt(e.debtor, 10);
    const amount = parseFloat(e.split_amount) || 0;
    const creditorPaid = creditor === creditorId && debtor === debtorId;

    transactions.push({
      date: e.created_at,
      timestamp: toTimestamp(e.created_at),
      type: 'expense',
      direction: creditorPaid ? 'creditor_paid' : 'debtor_paid',
      net_effect: creditorPaid ? amount : -amount,
      amount,
      data: e,
    });
  }

  for (const s of settlementResult.rows) {
    const fromUser = parseInt(s.from_user, 10);
    const toUser = parseInt(s.to_user, 10);
    const amount = parseFloat(s.amount) || 0;
    const debtorPaid = fromUser === debtorId && toUser === creditorId;

    transactions.push({
      date: s.created_at,
      timestamp: toTimestamp(s.created_at),
      type: 'settlement',
      direction: debtorPaid ? 'debtor_paid' : 'creditor_paid',
      net_effect: debtorPaid ? -amount : amount,
      amount,
      data: s,
    });
  }

  transactions.sort((a, b) => {
    const diff = a.timestamp - b.timestamp;
    if (diff !== 0) return diff;
    if (a.type === 'expense' && b.type === 'settlement') return -1;
    if (a.type === 'settlement' && b.type === 'expense') return 1;
    return 0;
  });

  let runningBalance = 0;
  let lastResetIndex = -1;
  let lastResetDate = null;
  const debugLog = [];

  transactions.forEach((t, index) => {
    const before = runningBalance;
    runningBalance += t.net_effect;
    const isReset = Math.abs(runningBalance) < 0.01;

    debugLog.push({
      idx: index,
      type: t.type,
      direction: t.direction,
      amount: roundMoney(t.amount),
      net_effect: roundMoney(t.net_effect),
      date: t.date,
      before: roundMoney(before),
      after: roundMoney(runningBalance),
      is_reset: isReset,
    });

    if (isReset) {
      lastResetIndex = index;
      lastResetDate = t.date;
      runningBalance = 0;
    }
  });

  const activeExpenses = [];
  const activeSettlements = [];
  const activeReverseExpenses = [];
  const activeReverseSettlements = [];
  let totalExpenses = 0;
  let totalSettled = 0;
  let totalOffset = 0;
  let totalReverseSettled = 0;

  for (let i = lastResetIndex + 1; i < transactions.length; i++) {
    const t = transactions[i];

    if (t.type === 'expense' && t.direction === 'creditor_paid') {
      const row = { ...t.data, remaining_amount: t.amount };
      activeExpenses.push(row);
      totalExpenses += t.amount;
    } else if (t.type === 'settlement' && t.direction === 'debtor_paid') {
      activeSettlements.push(t.data);
      totalSettled += t.amount;
    } else if (t.type === 'expense' && t.direction === 'debtor_paid') {
      const row = { ...t.data, offset_amount: t.amount };
      activeReverseExpenses.push(row);
      totalOffset += t.amount;
    } else if (t.type === 'settlement' && t.direction === 'creditor_paid') {
      activeReverseSettlements.push(t.data);
      totalReverseSettled += t.amount;
    }
  }

  activeExpenses.reverse();
  activeSettlements.reverse();
  activeReverseExpenses.reverse();
  activeReverseSettlements.reverse();

  const netRemaining = roundMoney(totalExpenses - totalSettled - totalOffset + totalReverseSettled);

  return {
    expenses: activeExpenses.slice(0, 10),
    settlements: activeSettlements.slice(0, 5),
    reverse_expenses: activeReverseExpenses.slice(0, 10),
    reverse_settlements: activeReverseSettlements.slice(0, 5),
    total_expenses: roundMoney(totalExpenses),
    total_settled: roundMoney(totalSettled),
    total_offset: roundMoney(totalOffset),
    total_reverse_settled: roundMoney(totalReverseSettled),
    remaining: roundMoney(Math.max(0, netRemaining)),
    is_clear: netRemaining <= 0.01,
    last_reset_date: lastResetDate,
    debug: {
      last_reset_index: lastResetIndex,
      last_reset_date: lastResetDate,
      total_transactions: transactions.length,
      active_expense_count: activeExpenses.length,
      active_settlement_count: activeSettlements.length,
      active_reverse_expense_count: activeReverseExpenses.length,
      active_reverse_settlement_count: activeReverseSettlements.length,
      log: debugLog,
    },
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

  // Keep settlement creation aligned with the visible debt detail rules.
  const pairSummary = await getDebtDetailsSummary(db, fromUser, toUser);
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
  const debug = String(req.query.debug || '') === '1';

  if (!creditorId || !debtorId) {
    return jsonResponse(res, { error: 'creditor_id and debtor_id required' }, 400);
  }

  const db = getDB();
  const summary = await getDebtDetailsSummary(db, debtorId, creditorId);
  if (!debug) delete summary.debug;

  return jsonResponse(res, summary);
}
