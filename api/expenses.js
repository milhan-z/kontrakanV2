/**
 * api/expenses.js — Expenses API (Pengganti expenses.php)
 * GET    → List expenses (with splits)
 * POST   → Create new expense + splits + notifications
 * DELETE → Delete expense (owner or admin)
 */

const { getDB, setCors, jsonResponse, requireAuth, getBody, handleOptions } = require('../lib/db');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET')    return listExpenses(req, res, user);
  if (req.method === 'POST')   return createExpense(req, res, user);
  if (req.method === 'DELETE') return deleteExpense(req, res, user);

  return jsonResponse(res, { error: 'Method not allowed' }, 405);
};

async function listExpenses(req, res, user) {
  const db = getDB();
  const category = req.query.category || null;
  const limit = parseInt(req.query.limit || '50');

  let sql = `
    SELECT e.*, u.display_name as paid_by_name
    FROM expenses e
    JOIN users u ON e.paid_by = u.id
  `;
  const params = [];

  if (category) {
    params.push(category);
    sql += ` WHERE e.category = $${params.length}`;
  }

  params.push(limit);
  sql += ` ORDER BY e.created_at DESC LIMIT $${params.length}`;

  const result = await db.query(sql, params);
  const expenses = result.rows;

  if (expenses.length === 0) return jsonResponse(res, { expenses: [] });

  // Get ALL splits in ONE query using JSON aggregation (no N+1)
  const expenseIds = expenses.map(e => e.id);
  const splitsResult = await db.query(`
    SELECT es.expense_id, es.user_id, es.amount, u.display_name
    FROM expense_splits es
    JOIN users u ON es.user_id = u.id
    WHERE es.expense_id = ANY($1::int[])
  `, [expenseIds]);

  // Group splits by expense_id
  const splitsMap = {};
  for (const s of splitsResult.rows) {
    if (!splitsMap[s.expense_id]) splitsMap[s.expense_id] = [];
    splitsMap[s.expense_id].push(s);
  }
  expenses.forEach(e => { e.splits = splitsMap[e.id] || []; });

  return jsonResponse(res, { expenses });
}

async function createExpense(req, res, user) {
  const input = await getBody(req);
  const { amount, description, category, splits = [], receipt_image = null } = input;

  if (!amount || !description || !category) {
    return jsonResponse(res, { error: 'amount, description, category harus diisi' }, 400);
  }

  if (category !== 'Listrik' && splits.length === 0) {
    return jsonResponse(res, { error: "Field 'splits' is required" }, 400);
  }

  if (parseFloat(amount) <= 0) {
    return jsonResponse(res, { error: 'Amount must be greater than 0' }, 400);
  }

  const db = getDB();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Insert expense
    const expResult = await client.query(
      'INSERT INTO expenses (paid_by, amount, description, category, receipt_image) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [user.user_id, parseFloat(amount), description, category, receipt_image]
    );
    const expenseId = expResult.rows[0].id;

    // Insert splits & notifications
    for (const split of splits) {
      const splitUserId = parseInt(split.user_id);
      const splitAmount = parseFloat(split.amount);

      await client.query(
        'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)',
        [expenseId, splitUserId, splitAmount]
      );

      // Notifikasi ke user lain (bukan payer)
      if (splitUserId !== user.user_id) {
        const amountFormatted = new Intl.NumberFormat('id-ID').format(splitAmount);
        await client.query(
          `INSERT INTO notifications (user_id, title, message, type, related_id)
           VALUES ($1, $2, $3, 'expense', $4)`,
          [
            splitUserId,
            'Pengeluaran Baru',
            `${user.display_name} nalangin ${category}: ${description} sebesar Rp ${amountFormatted}`,
            expenseId,
          ]
        );
      }
    }

    await client.query('COMMIT');
    return jsonResponse(res, { success: true, message: 'Expense created', expense_id: expenseId }, 201);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return jsonResponse(res, { error: 'Failed to create expense: ' + err.message }, 500);
  } finally {
    client.release();
  }
}

async function deleteExpense(req, res, user) {
  const expenseId = parseInt(req.query.id || '0');
  if (!expenseId) return jsonResponse(res, { error: 'Expense ID required' }, 400);

  const db = getDB();
  const result = await db.query('SELECT paid_by FROM expenses WHERE id = $1', [expenseId]);
  const expense = result.rows[0];

  if (!expense) return jsonResponse(res, { error: 'Expense not found' }, 404);

  if (expense.paid_by !== user.user_id && user.role !== 'admin') {
    return jsonResponse(res, { error: 'Not authorized to delete this expense' }, 403);
  }

  await db.query('DELETE FROM expenses WHERE id = $1', [expenseId]);
  return jsonResponse(res, { success: true, message: 'Expense deleted' });
}
