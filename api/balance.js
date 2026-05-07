/**
 * api/balance.js — Balance API (Optimized: single JOIN query, no N+1)
 * GET → Calculate who owes whom (debt matrix + settlements)
 */

const { getDB, setCors, jsonResponse, requireAuth, handleOptions } = require('../lib/db');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  const user = requireAuth(req, res);
  if (!user) return;

  const db = getDB();

  // Run all queries in parallel (no N+1)
  const [usersResult, splitsResult, settlsResult] = await Promise.all([
    db.query('SELECT id, display_name FROM users ORDER BY id'),
    db.query(`
      SELECT e.paid_by as payer_id, es.user_id as ower_id, es.amount
      FROM expenses e
      JOIN expense_splits es ON es.expense_id = e.id
      WHERE e.category != 'Listrik'
        AND es.amount > 0
    `),
    db.query('SELECT from_user, to_user, amount FROM settlements'),
  ]);

  const users = usersResult.rows;
  const userMap = {};
  users.forEach(u => { userMap[u.id] = u.display_name; });

  // Init debt matrix
  const debtMatrix = {};
  users.forEach(u1 => {
    debtMatrix[u1.id] = {};
    users.forEach(u2 => {
      if (u1.id !== u2.id) debtMatrix[u1.id][u2.id] = 0;
    });
  });

  // Process splits (single query, no loop queries)
  for (const row of splitsResult.rows) {
    const { payer_id, ower_id, amount } = row;
    if (ower_id != payer_id && debtMatrix[ower_id]?.[payer_id] !== undefined) {
      debtMatrix[ower_id][payer_id] += parseFloat(amount);
    }
  }

  // Process settlements
  for (const s of settlsResult.rows) {
    if (debtMatrix[s.from_user]?.[s.to_user] !== undefined) {
      debtMatrix[s.from_user][s.to_user] -= parseFloat(s.amount);
    }
  }

  // Simplify to net debts
  const netDebts = [];
  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const u1 = users[i], u2 = users[j];
      const net = (debtMatrix[u1.id]?.[u2.id] ?? 0) - (debtMatrix[u2.id]?.[u1.id] ?? 0);
      if (Math.abs(net) > 0.01) {
        if (net > 0) {
          netDebts.push({ from_user_id: u1.id, from_name: userMap[u1.id], to_user_id: u2.id, to_name: userMap[u2.id], amount: Math.round(net * 100) / 100 });
        } else {
          netDebts.push({ from_user_id: u2.id, from_name: userMap[u2.id], to_user_id: u1.id, to_name: userMap[u1.id], amount: Math.round(Math.abs(net) * 100) / 100 });
        }
      }
    }
  }

  // Per-user balance
  const balances = users.map(u => {
    let owesToOthers = 0, owedByOthers = 0;
    netDebts.forEach(d => {
      if (d.from_user_id == u.id) owesToOthers += d.amount;
      if (d.to_user_id == u.id) owedByOthers += d.amount;
    });
    return { user_id: u.id, display_name: u.display_name, balance: Math.round((owedByOthers - owesToOthers) * 100) / 100 };
  });
  balances.sort((a, b) => b.balance - a.balance);

  return jsonResponse(res, { balances, settlement_suggestions: netDebts });
};
