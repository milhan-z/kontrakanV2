/**
 * api/debt_details.js — Detail hutang antara 2 user (untuk settle.html)
 * GET ?creditor_id=X&debtor_id=Y
 * Returns: { expenses, settlements, total_expenses, total_settled }
 */

const { getDB, setCors, jsonResponse, requireAuth, handleOptions } = require('../lib/db');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method !== 'GET') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  const creditorId = parseInt(req.query.creditor_id || '0');
  const debtorId   = parseInt(req.query.debtor_id   || '0');

  if (!creditorId || !debtorId) {
    return jsonResponse(res, { error: 'creditor_id and debtor_id required' }, 400);
  }

  const db = getDB();

  // Get expenses where creditor paid AND debtor is in splits
  const expResult = await db.query(`
    SELECT e.id, e.description, e.category, e.amount as total_amount,
           es.amount as split_amount, e.created_at
    FROM expenses e
    JOIN expense_splits es ON es.expense_id = e.id
    WHERE e.paid_by = $1
      AND es.user_id = $2
      AND e.category != 'Listrik'
    ORDER BY e.created_at DESC
  `, [creditorId, debtorId]);

  // Get settlements between these two users
  const setResult = await db.query(`
    SELECT id, amount, created_at, receipt_image
    FROM settlements
    WHERE from_user = $1 AND to_user = $2
    ORDER BY created_at DESC
  `, [debtorId, creditorId]);

  const totalExpenses = expResult.rows.reduce((sum, e) => sum + parseFloat(e.split_amount), 0);
  const totalSettled  = setResult.rows.reduce((sum, s) => sum + parseFloat(s.amount), 0);

  return jsonResponse(res, {
    expenses:       expResult.rows,
    settlements:    setResult.rows,
    total_expenses: Math.round(totalExpenses * 100) / 100,
    total_settled:  Math.round(totalSettled  * 100) / 100,
    remaining:      Math.round((totalExpenses - totalSettled) * 100) / 100,
  });
};
