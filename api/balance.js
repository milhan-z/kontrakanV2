/**
 * api/balance.js — Balance API (Pengganti balance.php)
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

  // Get all users
  const usersResult = await db.query('SELECT id, display_name FROM users');
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

  // Process all expenses (EXCLUDE Listrik)
  const expensesResult = await db.query(`
    SELECT e.id, e.paid_by, e.amount, e.category
    FROM expenses e
    WHERE e.category != 'Listrik'
  `);

  for (const expense of expensesResult.rows) {
    const payerId = expense.paid_by;
    const splitsResult = await db.query(
      'SELECT user_id, amount FROM expense_splits WHERE expense_id = $1',
      [expense.id]
    );
    for (const split of splitsResult.rows) {
      const owerId = split.user_id;
      const splitAmount = parseFloat(split.amount);
      if (owerId != payerId && splitAmount > 0) {
        if (debtMatrix[owerId] && debtMatrix[owerId][payerId] !== undefined) {
          debtMatrix[owerId][payerId] += splitAmount;
        }
      }
    }
  }

  // Process settlements (reduce debt)
  const settlsResult = await db.query('SELECT from_user, to_user, amount FROM settlements');
  for (const s of settlsResult.rows) {
    const fromUser = s.from_user;
    const toUser = s.to_user;
    const amount = parseFloat(s.amount);
    if (debtMatrix[fromUser] && debtMatrix[fromUser][toUser] !== undefined) {
      debtMatrix[fromUser][toUser] -= amount;
    }
  }

  // Simplify debts (net)
  const netDebts = [];
  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const u1 = users[i], u2 = users[j];
      const debt1to2 = debtMatrix[u1.id]?.[u2.id] ?? 0;
      const debt2to1 = debtMatrix[u2.id]?.[u1.id] ?? 0;
      const net = debt1to2 - debt2to1;

      if (Math.abs(net) > 0.01) {
        if (net > 0) {
          netDebts.push({ from_user_id: u1.id, from_name: userMap[u1.id], to_user_id: u2.id, to_name: userMap[u2.id], amount: Math.round(net * 100) / 100 });
        } else {
          netDebts.push({ from_user_id: u2.id, from_name: userMap[u2.id], to_user_id: u1.id, to_name: userMap[u1.id], amount: Math.round(Math.abs(net) * 100) / 100 });
        }
      }
    }
  }

  // Calculate overall balance per user
  const balances = users.map(u => {
    const userId = u.id;
    let owesToOthers = 0, owedByOthers = 0;
    netDebts.forEach(d => {
      if (d.from_user_id == userId) owesToOthers += d.amount;
      if (d.to_user_id == userId) owedByOthers += d.amount;
    });
    return {
      user_id: userId,
      display_name: u.display_name,
      balance: Math.round((owedByOthers - owesToOthers) * 100) / 100,
    };
  });

  balances.sort((a, b) => b.balance - a.balance);

  return jsonResponse(res, { balances, settlement_suggestions: netDebts });
};
