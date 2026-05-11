/**
 * api/payment_info.js — Payment Info API (Pengganti payment_info.php)
 * GET    ?user_id=X → Get payment info for a user
 * POST              → Add/remove/update payment methods
 * DELETE            → Remove payment method
 */

const { getDB, setCors, jsonResponse, requireAuth, getBody, handleOptions } = require('../lib/db');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET')    return getPaymentInfo(req, res, user);
  if (req.method === 'POST')   return handlePaymentAction(req, res, user);
  if (req.method === 'DELETE') return removePaymentMethod(req, res, user);

  return jsonResponse(res, { error: 'Method not allowed' }, 405);
};

async function getPaymentInfo(req, res, user) {
  const userId = parseInt(req.query.user_id || '0', 10);
  if (!userId) return jsonResponse(res, { error: 'user_id required' }, 400);

  const db = getDB();
  const result = await db.query(`
    SELECT id, display_name, phone_wa, payment_methods,
           bank_name, bank_account, ewallet_type, ewallet_number, qris_image
    FROM users WHERE id = $1
  `, [userId]);

  const u = result.rows[0];
  if (!u) return jsonResponse(res, { error: 'User not found' }, 404);

  // Parse payment_methods JSON atau gunakan legacy fields
  let paymentMethods;
  if (u.payment_methods) {
    paymentMethods = typeof u.payment_methods === 'string'
      ? JSON.parse(u.payment_methods)
      : u.payment_methods;
  } else {
    paymentMethods = { banks: [], ewallets: [], qris: [] };
    if (u.bank_name) paymentMethods.banks.push({ name: u.bank_name, account: u.bank_account || '' });
    if (u.ewallet_type) paymentMethods.ewallets.push({ type: u.ewallet_type, number: u.ewallet_number || '' });
    if (u.qris_image) paymentMethods.qris.push(u.qris_image);
  }

  u.payment_methods_parsed = paymentMethods;
  return jsonResponse(res, { payment_info: u });
}

async function handlePaymentAction(req, res, user) {
  const input = await getBody(req);
  const { action, type } = input;
  const db = getDB();

  // Get current payment_methods
  const row = await db.query('SELECT payment_methods FROM users WHERE id = $1', [user.user_id]);
  let methods = row.rows[0]?.payment_methods;
  methods = methods
    ? (typeof methods === 'string' ? JSON.parse(methods) : methods)
    : { banks: [], ewallets: [], qris: [] };

  if (action === 'add') {
    if (type === 'bank') {
      const name = String(input.name || '').trim();
      const account = String(input.account || '').trim();
      if (!name || !account) return jsonResponse(res, { error: 'Nama bank dan nomor rekening wajib diisi' }, 400);
      methods.banks.push({ name, account });
    } else if (type === 'ewallet') {
      const ewalletType = String(input.ewallet_type || '').trim();
      const number = String(input.number || '').trim();
      if (!ewalletType || !number) return jsonResponse(res, { error: 'Jenis dan nomor e-wallet wajib diisi' }, 400);
      methods.ewallets.push({ type: ewalletType, number });
    } else if (type === 'qris' && input.qris_url) {
      const qrisUrl = String(input.qris_url || '').trim();
      if (!/^https?:\/\//i.test(qrisUrl)) {
        return jsonResponse(res, { error: 'URL QRIS tidak valid' }, 400);
      }
      methods.qris.push(qrisUrl);
    } else {
      return jsonResponse(res, { error: 'Data payment method tidak valid' }, 400);
    }
  } else if (action === 'remove') {
    const index = parseInt(input.index ?? -1);
    if (index >= 0) {
      if (type === 'bank' && methods.banks[index]) methods.banks.splice(index, 1);
      else if (type === 'ewallet' && methods.ewallets[index]) methods.ewallets.splice(index, 1);
      else if (type === 'qris' && methods.qris[index]) methods.qris.splice(index, 1);
    }
  } else {
    // Legacy single update
    const updates = [];
    const params = [];
    let i = 1;
    if (input.bank_name !== undefined)      { updates.push(`bank_name=$${i++}`);      params.push(input.bank_name || null); }
    if (input.bank_account !== undefined)   { updates.push(`bank_account=$${i++}`);   params.push(input.bank_account || null); }
    if (input.ewallet_type !== undefined)   { updates.push(`ewallet_type=$${i++}`);   params.push(input.ewallet_type || null); }
    if (input.ewallet_number !== undefined) { updates.push(`ewallet_number=$${i++}`); params.push(input.ewallet_number || null); }

    if (updates.length === 0) return jsonResponse(res, { error: 'No fields to update' }, 400);
    params.push(user.user_id);
    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${i}`, params);
    return jsonResponse(res, { success: true, message: 'Payment info updated' });
  }

  await db.query('UPDATE users SET payment_methods = $1 WHERE id = $2', [JSON.stringify(methods), user.user_id]);
  return jsonResponse(res, { success: true, payment_methods: methods });
}

async function removePaymentMethod(req, res, user) {
  const input = await getBody(req);
  const { type, index } = input;

  if (!type || index === undefined || parseInt(index) < 0) {
    return jsonResponse(res, { error: 'type and index required' }, 400);
  }

  const db = getDB();
  const row = await db.query('SELECT payment_methods FROM users WHERE id = $1', [user.user_id]);
  let methods = row.rows[0]?.payment_methods;
  methods = methods
    ? (typeof methods === 'string' ? JSON.parse(methods) : methods)
    : { banks: [], ewallets: [], qris: [] };

  const i = parseInt(index);
  if (type === 'bank' && methods.banks[i])        methods.banks.splice(i, 1);
  else if (type === 'ewallet' && methods.ewallets[i]) methods.ewallets.splice(i, 1);
  else if (type === 'qris' && methods.qris[i])    methods.qris.splice(i, 1);

  await db.query('UPDATE users SET payment_methods = $1 WHERE id = $2', [JSON.stringify(methods), user.user_id]);
  return jsonResponse(res, { success: true, payment_methods: methods });
}
