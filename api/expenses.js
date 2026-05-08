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
  try { await db.query('ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS items JSONB DEFAULT NULL'); } catch(e){}
  
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
  const { amount, description, category, splits = [], receipt_image = null } = input;

  if (!amount || !description || !category) {
    return jsonResponse(res, { error: 'amount, description, category harus diisi' }, 400);
  }

  if (category !== 'Listrik' && category !== 'Galon' && splits.length === 0) {
    return jsonResponse(res, { error: "Field 'splits' is required" }, 400);
  }

  if (parseFloat(amount) <= 0) {
    return jsonResponse(res, { error: 'Amount must be greater than 0' }, 400);
  }

  const db = getDB();
  // Ensure qty column exists
  try { await db.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS qty INT DEFAULT 1'); await db.query('ALTER TABLE expense_splits ADD COLUMN IF NOT EXISTS items JSONB DEFAULT NULL'); } catch(e){}
  
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Insert expense
    const qty = input.qty ? parseInt(input.qty) : 1;
    const expResult = await client.query(
      'INSERT INTO expenses (paid_by, amount, description, category, receipt_image, qty) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [user.user_id, parseFloat(amount), description, category, receipt_image, qty]
    );
    const expenseId = expResult.rows[0].id;

    // Insert splits & notifications
    if (category !== 'Listrik' && category !== 'Galon') {
      for (const split of splits) {
        const splitUserId = parseInt(split.user_id);
        const splitAmount = parseFloat(split.amount);

        const itemsJson = split.items && split.items.length > 0 ? JSON.stringify(split.items) : null;
        await client.query(
          'INSERT INTO expense_splits (expense_id, user_id, amount, items) VALUES ($1, $2, $3, $4::jsonb)',
          [expenseId, splitUserId, splitAmount, itemsJson]
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

// Listrik rotation stats (served via /api/listrik → /api/expenses.js)
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
  const db = require('../lib/db').getDB();
  // Ensure qty exists
  try { await db.query('ALTER TABLE expenses ADD COLUMN IF NOT EXISTS qty INT DEFAULT 1'); } catch(e){}
  
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
  return require('../lib/db').jsonResponse(res, { stats: result.rows, next_payer: result.rows[0] || null });
}

// ==================== OCR Receipt (Gemini AI) ====================
async function ocrReceipt(req, res, user) {
  const input = await getBody(req);
  const { url } = input;
  if (!url) return jsonResponse(res, { error: 'Image URL required' }, 400);

  if (!process.env.GEMINI_API_KEY) {
    return jsonResponse(res, { error: 'GEMINI_API_KEY belum dikonfigurasi di Vercel.' }, 500);
  }

  try {
    const imgRes = await fetch(url);
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

    const promptText = "Kamu adalah asisten OCR struk belanja (seperti GoPay Split Bill). Ekstrak data struk dengan format JSON object murni. Property yang wajib ada: 1. 'items': array of objects, tiap object punya 'name' (string nama barang), 'qty' (number jumlah barang), dan 'price' (number total harga item tsb). 2. 'subtotal': number (jumlah harga semua barang sebelum pajak/diskon). 3. 'tax': number (pajak/PPN). 4. 'service': number (biaya layanan). 5. 'discount': number (total SEMUA diskon/potongan/hemat, HARUS bernilai negatif). 6. 'grand_total': number (total akhir yang ditagihkan/dibayarkan). JANGAN sertakan markdown atau teks apapun, murni JSON saja.";

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptText },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data
              }
            }
          ]
        }],
        generationConfig: {
            temperature: 0.1,
            response_mime_type: "application/json"
        }
      })
    });

    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) {
      console.error('Gemini error:', geminiData);
      return jsonResponse(res, { error: 'Gagal memproses struk dengan AI: ' + JSON.stringify(geminiData) }, 500);
    }

    const textRes = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let resultObj = { items: [], subtotal: 0, tax: 0, service: 0, discount: 0, grand_total: 0 };
    try {
      const parsed = JSON.parse(textRes);
      if (Array.isArray(parsed)) {
        resultObj.items = parsed;
        resultObj.grand_total = parsed.reduce((s, i) => s + (i.price || 0), 0);
        resultObj.subtotal = resultObj.grand_total;
      } else {
        resultObj = { ...resultObj, ...parsed };
      }
      
      // Ensure all numbers are safe
      resultObj.subtotal = Number(resultObj.subtotal) || 0;
      resultObj.tax = Number(resultObj.tax) || 0;
      resultObj.service = Number(resultObj.service) || 0;
      resultObj.discount = Number(resultObj.discount) || 0;
      if (resultObj.discount > 0) resultObj.discount = -resultObj.discount; // pastikan negatif
      resultObj.grand_total = Number(resultObj.grand_total) || 0;
      
    } catch (e) {
      console.error('Parse JSON failed:', textRes);
      return jsonResponse(res, { error: 'Format AI tidak valid' }, 500);
    }

    return jsonResponse(res, resultObj);
  } catch (err) {
    console.error('OCR Error:', err);
    return jsonResponse(res, { error: 'Terjadi kesalahan OCR: ' + err.message }, 500);
  }
}

