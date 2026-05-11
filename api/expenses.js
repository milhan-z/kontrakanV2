/**
 * api/expenses.js — Expenses API (Pengganti expenses.php)
 * GET    → List expenses (with splits)
 * POST   → Create new expense + splits + notifications
 * DELETE → Delete expense (owner or admin)
 */

const { getDB, setCors, jsonResponse, requireAuth, getBody, handleOptions } = require('../lib/db');
const { sendPushNotification } = require('../lib/webpush');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  // Route /api/listrik → listrik stats handler
  if ((req.url || '').includes('/listrik')) return listrikStats(req, res, user);
  if ((req.url || '').includes('/galon')) return galonStats(req, res, user);

  if (req.method === 'GET')    return listExpenses(req, res, user);
  if (req.method === 'POST' && (req.query.action === 'ocr' || (req.url || '').includes('action=ocr'))) return ocrReceipt(req, res, user);
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
  
  // Ensure items column exists before querying
  try { 
    await db.query('ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS items JSONB DEFAULT NULL'); 
  } catch(e) {
    // Silently ignore if column already exists
  }
  
  let splitsResult;
  try {
      splitsResult = await db.query(`
        SELECT es.expense_id, es.user_id, es.amount, es.items, u.display_name
        FROM expense_splits es
        JOIN users u ON es.user_id = u.id
        WHERE es.expense_id = ANY($1::int[])
      `, [expenseIds]);
  } catch (err) {
      // Fallback if items column fails to add or isn't available
      splitsResult = await db.query(`
        SELECT es.expense_id, es.user_id, es.amount, u.display_name
        FROM expense_splits es
        JOIN users u ON es.user_id = u.id
        WHERE es.expense_id = ANY($1::int[])
      `, [expenseIds]);
  }

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
  const amountValue = Number(input.amount);
  const description = String(input.description || '').trim();
  const category = String(input.category || '').trim();
  const receipt_image = input.receipt_image || null;
  const splits = Array.isArray(input.splits) ? input.splits : [];

  if (!amountValue || !description || !category) {
    return jsonResponse(res, { error: 'amount, description, category harus diisi' }, 400);
  }

  if (category !== 'Listrik' && category !== 'Galon' && splits.length === 0) {
    return jsonResponse(res, { error: "Field 'splits' is required" }, 400);
  }

  if (amountValue <= 0) {
    return jsonResponse(res, { error: 'Amount must be greater than 0' }, 400);
  }

  const normalizedSplits = [];
  if (category !== 'Listrik' && category !== 'Galon') {
    let splitTotal = 0;
    const seenUserIds = new Set();

    for (const split of splits) {
      const splitUserId = parseInt(split.user_id, 10);
      const splitAmount = Number(split.amount);

      if (!splitUserId || !Number.isFinite(splitAmount) || splitAmount <= 0) {
        return jsonResponse(res, { error: 'Setiap split harus punya user_id dan amount yang valid' }, 400);
      }
      if (seenUserIds.has(splitUserId)) {
        return jsonResponse(res, { error: 'User pada split tidak boleh duplikat' }, 400);
      }

      seenUserIds.add(splitUserId);
      splitTotal += splitAmount;
      normalizedSplits.push({
        user_id: splitUserId,
        amount: Math.round(splitAmount * 100) / 100,
        items: Array.isArray(split.items) ? split.items : [],
      });
    }

    const roundedTotal = Math.round(amountValue * 100) / 100;
    const roundedSplitTotal = Math.round(splitTotal * 100) / 100;
    if (Math.abs(roundedSplitTotal - roundedTotal) > 0.01) {
      return jsonResponse(
        res,
        { error: `Total split harus sama dengan total pengeluaran. Split: ${roundedSplitTotal}, total: ${roundedTotal}` },
        400
      );
    }
  }

  const db = getDB();
  
  // Ensure qty column exists
  try { 
    await db.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS qty INT DEFAULT 1');
    await db.query('ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS items JSONB DEFAULT NULL');
  } catch(e) {
    // Silently ignore if columns already exist
  }
  
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Insert expense
    const qty = input.qty ? parseInt(input.qty, 10) : 1;
    const expResult = await client.query(
      'INSERT INTO expenses (paid_by, amount, description, category, receipt_image, qty) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [user.user_id, amountValue, description, category, receipt_image, qty]
    );
    const expenseId = expResult.rows[0].id;

    // Insert splits & notifications
    if (category !== 'Listrik' && category !== 'Galon') {
      const splitUserIds = normalizedSplits.map(split => split.user_id);
      const usersResult = await client.query(
        'SELECT id FROM users WHERE id = ANY($1::int[])',
        [splitUserIds]
      );
      if (usersResult.rows.length !== splitUserIds.length) {
        throw new Error('Ada user split yang tidak ditemukan');
      }

      for (const split of normalizedSplits) {
        const splitUserId = split.user_id;
        const splitAmount = split.amount;

        const itemsJson = split.items && split.items.length > 0 ? JSON.stringify(split.items) : null;
        await client.query(
          'INSERT INTO expense_splits (expense_id, user_id, amount, items) VALUES ($1, $2, $3, $4::jsonb)',
          [expenseId, splitUserId, splitAmount, itemsJson]
        );

        // Notifikasi ke user lain (bukan payer)
        if (splitUserId !== user.user_id) {
          const amountFormatted = new Intl.NumberFormat('id-ID').format(splitAmount);
          const notificationTitle = 'Pengeluaran Baru';
          const notificationMessage = `${user.display_name} nalangin ${category}: ${description} sebesar Rp ${amountFormatted}`;

          await client.query(
            `INSERT INTO notifications (user_id, title, message, type, related_id)
             VALUES ($1, $2, $3, 'expense', $4)`,
            [
              splitUserId,
              notificationTitle,
              notificationMessage,
              expenseId,
            ]
          );

          sendPushNotification(splitUserId, notificationTitle, notificationMessage, '/notifications.html')
            .catch(err => {
              console.error('Failed to send expense push notification:', err);
            });
        }
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

// Listrik rotation stats
async function listrikStats(req, res, user) {
  const db = getDB();
  const result = await db.query(`
    SELECT u.id as user_id, u.display_name,
           COUNT(e.id) as payment_count,
           COALESCE(SUM(e.amount), 0) as total_amount,
           MAX(e.created_at) as last_payment
    FROM users u
    LEFT JOIN expenses e ON e.paid_by = u.id AND e.category = 'Listrik'
    WHERE u.role != 'admin'
    GROUP BY u.id, u.display_name
    ORDER BY payment_count ASC, last_payment ASC NULLS FIRST
  `);
  return jsonResponse(res, { stats: result.rows, next_payer: result.rows[0] || null });
}

// Galon rotation stats
async function galonStats(req, res, user) {
  const db = getDB();
  
  try { 
    await db.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS qty INT DEFAULT 1');
  } catch(e) {
    // Silently ignore
  }
  
  const result = await db.query(`
    SELECT u.id as user_id, u.display_name,
           COALESCE(SUM(e.qty), 0) as payment_count,
           COALESCE(SUM(e.amount), 0) as total_amount,
           MAX(e.created_at) as last_payment
    FROM users u
    LEFT JOIN expenses e ON e.paid_by = u.id AND e.category = 'Galon'
    WHERE u.role != 'admin'
    GROUP BY u.id, u.display_name
    ORDER BY payment_count ASC, last_payment ASC NULLS FIRST
  `);
  return jsonResponse(res, { stats: result.rows, next_payer: result.rows[0] || null });
}

// ==================== OCR Receipt (Groq Vision) ====================
async function ocrReceipt(req, res, user) {
  const input = await getBody(req);
  const { url } = input;
  if (!url) return jsonResponse(res, { error: 'Image URL required' }, 400);

  if (!process.env.GROQ_API_KEY) {
    return jsonResponse(res, { error: 'GROQ_API_KEY belum dikonfigurasi di Vercel.' }, 500);
  }

  try {
    console.log('[OCR Groq] Fetching image from:', url);
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`Gagal fetch gambar: ${imgRes.statusText}`);

    const arrayBuffer = await imgRes.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

    // Cek ukuran — Groq limit base64 = 4MB
    const sizeInMB = (base64Data.length * 0.75) / (1024 * 1024);
    console.log(`[OCR Groq] Image size: ~${sizeInMB.toFixed(2)} MB, type: ${mimeType}`);
    if (sizeInMB > 4) {
      return jsonResponse(res, { error: 'Ukuran gambar terlalu besar (max 4MB). Kompres dulu fotonya.' }, 400);
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Kamu adalah asisten OCR struk belanja. Ekstrak semua item dari struk ini.

Kembalikan HANYA JSON murni (tanpa markdown, tanpa backtick) dengan struktur ini:
{
  "items": [
    {"name": "nama item", "quantity": 1, "price": 15000}
  ],
  "subtotal": 0,
  "tax": 0,
  "service": 0,
  "discount": 0,
  "grand_total": 0
}

Aturan:
- price = harga TOTAL item tersebut (qty x harga satuan)
- quantity = jumlah item
- discount HARUS angka negatif jika ada
- Isi subtotal, tax, service, discount, grand_total dari struk jika ada
- Kembalikan HANYA JSON, tidak ada teks lain sama sekali`
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Data}`
                }
              }
            ]
          }
        ],
        temperature: 0,
        max_completion_tokens: 2048,
        response_format: { type: 'json_object' }
      })
    });

    const groqData = await groqRes.json();

    if (!groqRes.ok) {
      const errMsg = groqData.error?.message || 'Groq API error';
      console.error('[OCR Groq] API error:', errMsg);
      return jsonResponse(res, { error: 'Groq API error: ' + errMsg }, 500);
    }

    const textContent = groqData.choices?.[0]?.message?.content || '{}';
    console.log('[OCR Groq] Raw response:', textContent.substring(0, 300));

    // Parse JSON
    let parsed;
    try {
      // Bersihkan kalau masih ada markdown
      let clean = textContent.trim();
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      }
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      console.error('[OCR Groq] JSON parse error:', parseErr.message);
      return jsonResponse(res, { error: 'Gagal parse hasil OCR. Coba foto lebih jelas.' }, 422);
    }

    // Normalize items
    const items = (parsed.items || []).map(i => ({
      name: String(i.name || i.item || 'Unknown'),
      quantity: Number(i.quantity || i.qty || 1) || 1,
      price: Number(i.price || 0) || 0
    })).filter(i => i.name && i.price > 0);

    if (items.length === 0) {
      console.warn('[OCR Groq] No valid items found');
      return jsonResponse(res, { error: 'Tidak ada item yang terbaca. Coba foto lebih jelas.' }, 422);
    }

    const result = {
      items,
      subtotal: Number(parsed.subtotal) || 0,
      tax: Number(parsed.tax) || 0,
      service: Number(parsed.service) || 0,
      discount: Number(parsed.discount) || 0,
      grand_total: Number(parsed.grand_total) || 0
    };

    // Jika grand_total 0, hitung dari items
    if (result.grand_total === 0) {
      result.grand_total = items.reduce((sum, i) => sum + i.price, 0);
      result.subtotal = result.grand_total;
    }

    console.log(`[OCR Groq] ✓ Success: ${items.length} items, total: ${result.grand_total}`);
    return jsonResponse(res, result);

  } catch (err) {
    console.error('[OCR Groq] Critical error:', err.message);
    return jsonResponse(res, { error: 'Gagal memproses struk: ' + err.message }, 500);
  }
}
