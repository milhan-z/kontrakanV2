const { getDB, setCors, jsonResponse, requireAuth, getBody, handleOptions } = require('../lib/db');
const { sendPushNotification } = require('../lib/webpush');

const ORDER_STATUSES = new Set(['open', 'closed', 'completed', 'cancelled']);
const ITEM_STATUSES = new Set(['requested', 'bought', 'unavailable', 'cancelled']);

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const db = getDB();
  await ensureJastipTables(db);

  if (req.method === 'GET') return listJastip(req, res, user, db);
  if (req.method === 'POST') return handlePost(req, res, user, db);
  if (req.method === 'PUT') return handlePut(req, res, user, db);
  if (req.method === 'DELETE') return deleteItem(req, res, user, db);

  return jsonResponse(res, { error: 'Method not allowed' }, 405);
};

async function handlePost(req, res, user, db) {
  const action = req.query.action || 'create';
  if (action === 'create') return createOrder(req, res, user, db);
  if (action === 'item') return addItem(req, res, user, db);
  return jsonResponse(res, { error: 'Invalid action' }, 400);
}

async function handlePut(req, res, user, db) {
  const action = req.query.action || '';
  if (action === 'close') return closeOrder(req, res, user, db);
  if (action === 'cancel') return cancelOrder(req, res, user, db);
  if (action === 'item') return updateItem(req, res, user, db);
  if (action === 'complete') return completeOrder(req, res, user, db);
  return jsonResponse(res, { error: 'Invalid action' }, 400);
}

async function ensureJastipTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS jastip_orders (
      id SERIAL PRIMARY KEY,
      opened_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(120) NOT NULL,
      note TEXT DEFAULT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      closes_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
      expense_id INT REFERENCES expenses(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      closed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
      completed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS jastip_items (
      id SERIAL PRIMARY KEY,
      jastip_id INT NOT NULL REFERENCES jastip_orders(id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_name VARCHAR(160) NOT NULL,
      requested_qty INT NOT NULL DEFAULT 1,
      note TEXT DEFAULT NULL,
      estimated_price DECIMAL(12,2) DEFAULT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'requested',
      final_qty INT DEFAULT NULL,
      final_price DECIMAL(12,2) DEFAULT NULL,
      final_note TEXT DEFAULT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_jastip_orders_status ON jastip_orders(status, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_jastip_items_order ON jastip_items(jastip_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_jastip_items_user ON jastip_items(user_id)`);
  await db.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS qty INT DEFAULT 1`);
  await db.query(`ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS items JSONB DEFAULT NULL`);
}

async function listJastip(req, res, user, db) {
  const status = String(req.query.status || '').trim();
  const params = [];
  let where = '';

  if (status && ORDER_STATUSES.has(status)) {
    params.push(status);
    where = `WHERE jo.status = $${params.length}`;
  }

  params.push(parseInt(req.query.limit || '30', 10) || 30);
  const ordersResult = await db.query(
    `
      SELECT jo.*, u.display_name AS opened_by_name
      FROM jastip_orders jo
      JOIN users u ON u.id = jo.opened_by
      ${where}
      ORDER BY
        CASE jo.status WHEN 'open' THEN 0 WHEN 'closed' THEN 1 ELSE 2 END,
        jo.created_at DESC
      LIMIT $${params.length}
    `,
    params
  );

  const orders = ordersResult.rows;
  if (orders.length === 0) return jsonResponse(res, { orders: [] });

  const ids = orders.map(order => order.id);
  const itemsResult = await db.query(
    `
      SELECT ji.*, u.display_name AS user_name
      FROM jastip_items ji
      JOIN users u ON u.id = ji.user_id
      WHERE ji.jastip_id = ANY($1::int[])
      ORDER BY ji.created_at ASC, ji.id ASC
    `,
    [ids]
  );

  const itemsByOrder = {};
  itemsResult.rows.forEach(item => {
    if (!itemsByOrder[item.jastip_id]) itemsByOrder[item.jastip_id] = [];
    itemsByOrder[item.jastip_id].push(item);
  });

  orders.forEach(order => {
    order.items = itemsByOrder[order.id] || [];
    order.can_manage = order.opened_by === user.user_id || user.role === 'admin';
  });

  return jsonResponse(res, { orders });
}

async function createOrder(req, res, user, db) {
  const input = await getBody(req);
  const title = String(input.title || '').trim();
  const note = String(input.note || '').trim() || null;
  const closesAt = input.closes_at ? new Date(input.closes_at) : null;

  if (!title || title.length > 120) {
    return jsonResponse(res, { error: 'Judul jastip wajib diisi maksimal 120 karakter' }, 400);
  }

  const result = await db.query(
    `INSERT INTO jastip_orders (opened_by, title, note, closes_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [user.user_id, title, note, closesAt && !Number.isNaN(closesAt.getTime()) ? closesAt : null]
  );
  const order = result.rows[0];

  await notifyUsers(
    db,
    user.user_id,
    'Jastip Dibuka',
    `${user.display_name} buka jastip ${title}. Mau nitip?`,
    order.id
  );

  return jsonResponse(res, { success: true, order }, 201);
}

async function addItem(req, res, user, db) {
  const input = await getBody(req);
  const jastipId = parseInt(input.jastip_id || '0', 10);
  const itemName = String(input.item_name || '').trim();
  const requestedQty = Math.max(1, parseInt(input.requested_qty || '1', 10) || 1);
  const note = String(input.note || '').trim() || null;
  const estimatedPrice = input.estimated_price === '' || input.estimated_price == null
    ? null
    : Number(input.estimated_price);

  if (!jastipId || !itemName || itemName.length > 160) {
    return jsonResponse(res, { error: 'Jastip dan nama barang wajib diisi' }, 400);
  }
  if (estimatedPrice !== null && (!Number.isFinite(estimatedPrice) || estimatedPrice < 0)) {
    return jsonResponse(res, { error: 'Estimasi harga tidak valid' }, 400);
  }

  const order = await getOrder(db, jastipId);
  if (!order) return jsonResponse(res, { error: 'Jastip tidak ditemukan' }, 404);
  if (order.status !== 'open') return jsonResponse(res, { error: 'Jastip sudah ditutup' }, 409);
  if (order.opened_by === user.user_id && user.role !== 'admin') {
    return jsonResponse(res, { error: 'Pembuka jastip tidak perlu titip ke diri sendiri' }, 403);
  }

  const result = await db.query(
    `INSERT INTO jastip_items (jastip_id, user_id, item_name, requested_qty, note, estimated_price)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [jastipId, user.user_id, itemName, requestedQty, note, estimatedPrice]
  );

  if (order.opened_by !== user.user_id) {
    await createNotification(
      db,
      order.opened_by,
      'Nitipan Baru',
      `${user.display_name} nitip ${itemName} di jastip ${order.title}`,
      order.id
    );
    await sendPushNotification(order.opened_by, 'Nitipan Baru', `${user.display_name} nitip ${itemName}`, '/jastip.html')
      .catch(err => console.error('Failed to send jastip item push:', err));
  }

  return jsonResponse(res, { success: true, item: result.rows[0] }, 201);
}

async function closeOrder(req, res, user, db) {
  const input = await getBody(req);
  const id = parseInt(input.id || '0', 10);
  const order = await requireManageableOrder(db, id, user);
  if (!order) return jsonResponse(res, { error: 'Jastip tidak ditemukan atau tidak boleh diubah' }, 404);
  if (order.status !== 'open') return jsonResponse(res, { error: 'Jastip tidak sedang open' }, 409);

  await db.query(
    `UPDATE jastip_orders SET status = 'closed', closed_at = NOW() WHERE id = $1`,
    [id]
  );

  await notifyParticipants(db, id, user.user_id, 'Jastip Ditutup', `Jastip ${order.title} sudah ditutup. Menunggu hasil belanja.`);
  return jsonResponse(res, { success: true });
}

async function cancelOrder(req, res, user, db) {
  const input = await getBody(req);
  const id = parseInt(input.id || '0', 10);
  const order = await requireManageableOrder(db, id, user);
  if (!order) return jsonResponse(res, { error: 'Jastip tidak ditemukan atau tidak boleh diubah' }, 404);
  if (order.status === 'completed') return jsonResponse(res, { error: 'Jastip yang selesai tidak bisa dibatalkan' }, 409);

  await db.query(`UPDATE jastip_orders SET status = 'cancelled' WHERE id = $1`, [id]);
  await notifyParticipants(db, id, user.user_id, 'Jastip Dibatalkan', `Jastip ${order.title} dibatalkan.`);
  return jsonResponse(res, { success: true });
}

async function updateItem(req, res, user, db) {
  const input = await getBody(req);
  const itemId = parseInt(input.item_id || '0', 10);
  const item = await getItemWithOrder(db, itemId);
  if (!item) return jsonResponse(res, { error: 'Item tidak ditemukan' }, 404);
  if (item.opened_by !== user.user_id && user.role !== 'admin') {
    return jsonResponse(res, { error: 'Hanya pembuka jastip yang bisa mengisi hasil belanja' }, 403);
  }
  if (!['open', 'closed'].includes(item.order_status)) {
    return jsonResponse(res, { error: 'Item tidak bisa diubah pada status jastip ini' }, 409);
  }

  const status = String(input.status || item.status || 'requested').trim();
  if (!ITEM_STATUSES.has(status)) return jsonResponse(res, { error: 'Status item tidak valid' }, 400);

  const finalQty = input.final_qty === '' || input.final_qty == null
    ? null
    : Math.max(0, parseInt(input.final_qty, 10) || 0);
  const finalPrice = input.final_price === '' || input.final_price == null
    ? null
    : Number(input.final_price);
  const finalNote = String(input.final_note || '').trim() || null;

  if (status === 'bought') {
    if (!finalQty || finalQty <= 0) return jsonResponse(res, { error: 'Qty final wajib diisi untuk barang ada' }, 400);
    if (!Number.isFinite(finalPrice) || finalPrice < 0) return jsonResponse(res, { error: 'Harga final wajib valid untuk barang ada' }, 400);
  }

  const result = await db.query(
    `UPDATE jastip_items
     SET status = $1, final_qty = $2, final_price = $3, final_note = $4
     WHERE id = $5
     RETURNING *`,
    [status, finalQty, finalPrice, finalNote, itemId]
  );

  return jsonResponse(res, { success: true, item: result.rows[0] });
}

async function deleteItem(req, res, user, db) {
  const itemId = parseInt(req.query.item_id || '0', 10);
  const item = await getItemWithOrder(db, itemId);
  if (!item) return jsonResponse(res, { error: 'Item tidak ditemukan' }, 404);
  if (item.order_status !== 'open') return jsonResponse(res, { error: 'Nitipan hanya bisa dihapus saat jastip masih open' }, 409);
  if (item.user_id !== user.user_id && item.opened_by !== user.user_id && user.role !== 'admin') {
    return jsonResponse(res, { error: 'Tidak boleh menghapus nitipan ini' }, 403);
  }

  await db.query('DELETE FROM jastip_items WHERE id = $1', [itemId]);
  return jsonResponse(res, { success: true });
}

async function completeOrder(req, res, user, db) {
  const input = await getBody(req);
  const id = parseInt(input.id || '0', 10);
  const order = await requireManageableOrder(db, id, user);
  if (!order) return jsonResponse(res, { error: 'Jastip tidak ditemukan atau tidak boleh diubah' }, 404);
  if (order.status === 'completed') return jsonResponse(res, { error: 'Jastip sudah selesai' }, 409);
  if (order.status === 'cancelled') return jsonResponse(res, { error: 'Jastip sudah dibatalkan' }, 409);

  const client = await db.connect();
  const pushJobs = [];
  try {
    await client.query('BEGIN');

    const lockedOrder = await client.query(
      `SELECT * FROM jastip_orders WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const currentOrder = lockedOrder.rows[0];
    if (!currentOrder || currentOrder.status === 'completed') {
      throw new Error('Jastip sudah selesai');
    }

    const itemsResult = await client.query(
      `
        SELECT ji.*, u.display_name AS user_name
        FROM jastip_items ji
        JOIN users u ON u.id = ji.user_id
        WHERE ji.jastip_id = $1
        ORDER BY ji.id ASC
      `,
      [id]
    );
    const uncheckedItem = itemsResult.rows.find(item => item.status === 'requested');
    if (uncheckedItem) {
      throw new Error(`Masih ada nitipan yang belum dicek: ${uncheckedItem.item_name}`);
    }

    const boughtItems = itemsResult.rows.filter(item => item.status === 'bought');
    if (boughtItems.length === 0) {
      await client.query(
        `UPDATE jastip_orders
         SET status = 'completed', completed_at = NOW(), closed_at = COALESCE(closed_at, NOW()), expense_id = NULL
         WHERE id = $1`,
        [id]
      );

      const participantIds = [...new Set(itemsResult.rows.map(item => item.user_id).filter(id => id !== currentOrder.opened_by))];
      for (const participantId of participantIds) {
        await client.query(
          `INSERT INTO notifications (user_id, title, message, type, related_id)
           VALUES ($1, 'Jastip Selesai', $2, 'info', $3)`,
          [participantId, `Jastip ${currentOrder.title} selesai. Tidak ada barang yang terbeli, jadi tidak ada tagihan.`, currentOrder.id]
        );
        pushJobs.push(
          sendPushNotification(participantId, 'Jastip Selesai', `Tidak ada tagihan untuk jastip ${currentOrder.title}`, '/jastip.html')
            .catch(err => console.error('Failed to send empty jastip push:', err))
        );
      }

      await client.query('COMMIT');
      await Promise.allSettled(pushJobs);
      return jsonResponse(res, { success: true, expense_id: null, amount: 0 });
    }

    const splitMap = new Map();
    let totalAmount = 0;

    for (const item of boughtItems) {
      const price = Number(item.final_price);
      if (!Number.isFinite(price) || price < 0) throw new Error(`Harga final ${item.item_name} belum valid`);

      totalAmount += price;
      const existing = splitMap.get(item.user_id) || { user_id: item.user_id, amount: 0, items: [] };
      existing.amount += price;
      existing.items.push({
        item: item.item_name,
        qty: item.final_qty || item.requested_qty,
        price,
        note: item.final_note || undefined,
      });
      splitMap.set(item.user_id, existing);
    }

    if (totalAmount <= 0) throw new Error('Total jastip harus lebih dari 0');

    const expenseResult = await client.query(
      `INSERT INTO expenses (paid_by, amount, description, category, qty)
       VALUES ($1, $2, $3, 'Jastip', 1)
       RETURNING id`,
      [currentOrder.opened_by, Math.round(totalAmount * 100) / 100, `Jastip ${currentOrder.title}`]
    );
    const expenseId = expenseResult.rows[0].id;

    const splits = Array.from(splitMap.values()).map(split => ({
      ...split,
      amount: Math.round(split.amount * 100) / 100,
    }));
    const roundedTotal = Math.round(totalAmount * 100) / 100;
    const roundedSplitTotal = Math.round(splits.reduce((sum, split) => sum + split.amount, 0) * 100) / 100;
    if (splits.length > 0 && Math.abs(roundedTotal - roundedSplitTotal) > 0) {
      splits[0].amount = Math.round((splits[0].amount + roundedTotal - roundedSplitTotal) * 100) / 100;
    }

    for (const split of splits) {
      const amount = Math.round(split.amount * 100) / 100;
      await client.query(
        `INSERT INTO expense_splits (expense_id, user_id, amount, items)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [expenseId, split.user_id, amount, JSON.stringify(split.items)]
      );

      if (split.user_id !== currentOrder.opened_by) {
        const formatted = new Intl.NumberFormat('id-ID').format(amount);
        await client.query(
          `INSERT INTO notifications (user_id, title, message, type, related_id)
           VALUES ($1, 'Jastip Selesai', $2, 'expense', $3)`,
          [split.user_id, `Jastip ${currentOrder.title} selesai. Tagihan kamu Rp ${formatted}`, expenseId]
        );
        pushJobs.push(
          sendPushNotification(split.user_id, 'Jastip Selesai', `Tagihan jastip kamu Rp ${formatted}`, '/history.html')
            .catch(err => console.error('Failed to send completed jastip push:', err))
        );
      }
    }

    await client.query(
      `UPDATE jastip_orders
       SET status = 'completed', completed_at = NOW(), closed_at = COALESCE(closed_at, NOW()), expense_id = $2
       WHERE id = $1`,
      [id, expenseId]
    );

    await client.query('COMMIT');
    await Promise.allSettled(pushJobs);
    return jsonResponse(res, { success: true, expense_id: expenseId, amount: Math.round(totalAmount * 100) / 100 });
  } catch (err) {
    await client.query('ROLLBACK');
    return jsonResponse(res, { error: err.message || 'Gagal menyelesaikan jastip' }, 400);
  } finally {
    client.release();
  }
}

async function getOrder(db, id) {
  const result = await db.query('SELECT * FROM jastip_orders WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function requireManageableOrder(db, id, user) {
  if (!id) return null;
  const order = await getOrder(db, id);
  if (!order) return null;
  if (order.opened_by !== user.user_id && user.role !== 'admin') return null;
  return order;
}

async function getItemWithOrder(db, itemId) {
  if (!itemId) return null;
  const result = await db.query(
    `
      SELECT ji.*, jo.opened_by, jo.status AS order_status, jo.title AS order_title
      FROM jastip_items ji
      JOIN jastip_orders jo ON jo.id = ji.jastip_id
      WHERE ji.id = $1
    `,
    [itemId]
  );
  return result.rows[0] || null;
}

async function createNotification(db, userId, title, message, relatedId) {
  await db.query(
    `INSERT INTO notifications (user_id, title, message, type, related_id)
     VALUES ($1, $2, $3, 'info', $4)`,
    [userId, title, message, relatedId]
  );
}

async function notifyUsers(db, exceptUserId, title, message, relatedId) {
  const users = await db.query('SELECT id FROM users WHERE id != $1', [exceptUserId]);
  await Promise.all(users.rows.map(async (row) => {
    await createNotification(db, row.id, title, message, relatedId);
    await sendPushNotification(row.id, title, message, '/jastip.html')
      .catch(err => console.error('Failed to send jastip broadcast push:', err));
  }));
}

async function notifyParticipants(db, jastipId, exceptUserId, title, message) {
  const result = await db.query(
    `SELECT DISTINCT user_id FROM jastip_items WHERE jastip_id = $1 AND user_id != $2`,
    [jastipId, exceptUserId]
  );
  await Promise.all(result.rows.map(async (row) => {
    await createNotification(db, row.user_id, title, message, jastipId);
    await sendPushNotification(row.user_id, title, message, '/jastip.html')
      .catch(err => console.error('Failed to send jastip participant push:', err));
  }));
}
