/**
 * api/listrik.js — Listrik Rotation Stats API
 * GET → Returns payment count per user for Listrik category (for rotation tracking)
 */

const { getDB, setCors, jsonResponse, requireAuth, handleOptions } = require('../lib/db');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method !== 'GET') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  const db = getDB();

  // Count how many times each user paid for Listrik
  const result = await db.query(`
    SELECT u.id as user_id, u.display_name,
           COUNT(e.id) as payment_count,
           COALESCE(SUM(e.amount), 0) as total_amount,
           MAX(e.created_at) as last_payment
    FROM users u
    LEFT JOIN expenses e ON e.paid_by = u.id AND e.category = 'Listrik'
    WHERE u.role = 'member' OR u.role = 'admin'
    GROUP BY u.id, u.display_name
    ORDER BY payment_count ASC, last_payment ASC NULLS FIRST
  `);

  return jsonResponse(res, {
    stats: result.rows,
    next_payer: result.rows[0] || null,
  });
};
