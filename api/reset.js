/**
 * api/reset.js — Reset Data API (Admin only)
 * POST { type: 'transaksi'|'info'|'settlements'|'notifications'|'all' }
 */

const { getDB, setCors, jsonResponse, requireAdmin, getBody, handleOptions } = require('../lib/db');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAdmin(req, res);
  if (!user) return;

  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  const { type } = await getBody(req);
  const db = getDB();

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    switch (type) {
      case 'transaksi':
        await client.query('DELETE FROM expense_splits');
        await client.query('DELETE FROM expenses');
        break;
      case 'info':
        await client.query('DELETE FROM info_kontrakan');
        break;
      case 'settlements':
        await client.query('DELETE FROM settlements');
        break;
      case 'notifications':
        await client.query('DELETE FROM notifications');
        break;
      case 'all':
        await client.query('DELETE FROM notifications');
        await client.query('DELETE FROM settlements');
        await client.query('DELETE FROM info_kontrakan');
        await client.query('DELETE FROM expense_splits');
        await client.query('DELETE FROM expenses');
        break;
      default:
        await client.query('ROLLBACK');
        return jsonResponse(res, { error: 'Tipe reset tidak valid' }, 400);
    }

    await client.query('COMMIT');
    return jsonResponse(res, { success: true, message: 'Data berhasil direset' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reset error:', err);
    return jsonResponse(res, { error: 'Reset gagal: ' + err.message }, 500);
  } finally {
    client.release();
  }
};
