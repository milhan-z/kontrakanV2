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

// ==================== OCR Receipt (Gemini AI v1 API) ====================
async function ocrReceipt(req, res, user) {
  const input = await getBody(req);
  const { url } = input;
  if (!url) return jsonResponse(res, { error: 'Image URL required' }, 400);

  if (!process.env.GEMINI_API_KEY) {
    return jsonResponse(res, { error: 'GEMINI_API_KEY belum dikonfigurasi di Vercel.' }, 500);
  }

  // Model fallback list (sesuai dokumentasi Gemini API resmi)
  const modelList = [
    'gemini-1.5-flash',       // Best: unlimited quota pada free tier
    'gemini-2.5-flash-lite',  // Fallback 1: fast & efficient
    'gemini-2.0-flash',       // Fallback 2: reliable
  ];

  try {
    // Fetch image dan convert ke base64
    console.log('[OCR] Fetching image from:', url);
    const imgRes = await fetch(url);
    
    if (!imgRes.ok) {
      throw new Error(`Failed to fetch image: ${imgRes.statusText}`);
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

    console.log(`[OCR] Image loaded: ${base64Data.length} bytes, type: ${mimeType}`);

    // Prompt untuk OCR
    const promptText = `Kamu adalah asisten OCR struk belanja. Ekstrak data struk dengan format JSON PURE (tanpa markdown, tanpa formatting).

Struktur JSON yang HARUS dikembalikan:
{
  "items": [
    {"name": "string", "quantity": number, "price": number},
    ...
  ],
  "subtotal": number,
  "tax": number,
  "service": number,
  "discount": number,
  "grand_total": number
}

PENTING:
- Gunakan format JSON valid dan murni SAJA
- Jangan tambah markdown (```, #, dll)
- Quantity dan price HARUS number, bukan string
- Discount HARUS negatif jika ada
- Kembalikan HANYA JSON, tanpa penjelasan apapun`;

    let lastError = null;

    // Try each model
    for (const model of modelList) {
      try {
        console.log(`[OCR] Attempting model: ${model}`);

        // Gunakan v1 endpoint sesuai dokumentasi resmi Gemini API
        const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

        const requestPayload = {
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: promptText
                },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0,              // Deterministic output untuk JSON
            top_p: 1,                    // Use all probability mass
            top_k: 1,                    // No randomness
            response_mime_type: 'application/json',
            max_output_tokens: 2048
          },
          safetySettings: [
            {
              category: 'HARM_CATEGORY_UNSPECIFIED',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_DEROGATORY_CONTENT',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_VIOLENCE',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_SEXUAL_CONTENT',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_MEDICAL_CONTENT',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              threshold: 'BLOCK_NONE'
            }
          ]
        };

        const geminiRes = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestPayload)
        });

        const geminiData = await geminiRes.json();

        // Handle error response
        if (!geminiRes.ok) {
          const errorCode = geminiData?.error?.code;
          const errorMsg = geminiData?.error?.message || 'Unknown error';
          
          console.error(`[OCR] ${model} error (${geminiRes.status}):`, errorMsg);
          lastError = { code: errorCode, message: errorMsg, status: geminiRes.status };

          // Jika quota habis atau rate limit, lanjut ke model berikutnya
          if (geminiRes.status === 429 || errorCode === 'RESOURCE_EXHAUSTED' || errorMsg.includes('quota')) {
            console.log(`[OCR] Quota exceeded for ${model}, trying next model...`);
            continue;
          }

          // Jika error lain (credential, permission, dll), stop
          if (geminiRes.status === 401 || geminiRes.status === 403) {
            return jsonResponse(res, { error: 'Authentication failed: ' + errorMsg }, 401);
          }

          // Untuk error lain, lanjut ke model berikutnya
          continue;
        }

        // Parse response - sesuai dokumentasi v1 API
        const candidates = geminiData.candidates?.[0];
        if (!candidates || !candidates.content || !candidates.content.parts) {
          throw new Error('Invalid response structure from Gemini API');
        }

        const textContent = candidates.content.parts[0]?.text || '{}';
        console.log(`[OCR] Raw response from ${model}:`, textContent.substring(0, 200));

        let resultObj = { items: [], subtotal: 0, tax: 0, service: 0, discount: 0, grand_total: 0 };

        try {
          // Clean response jika ada markdown remnants
          let cleanedText = textContent.trim();
          if (cleanedText.startsWith('```')) {
            cleanedText = cleanedText.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
          }

          const parsed = JSON.parse(cleanedText);

          if (Array.isArray(parsed)) {
            // Jika response adalah array items langsung
            resultObj.items = parsed.map(item => ({
              name: String(item.name || item.item || ''),
              quantity: Number(item.quantity || item.qty || 1) || 1,
              price: Number(item.price || 0) || 0
            }));
            resultObj.grand_total = resultObj.items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            resultObj.subtotal = resultObj.grand_total;
          } else {
            // JSON object structure
            if (parsed.items && Array.isArray(parsed.items)) {
              resultObj.items = parsed.items.map(item => ({
                name: String(item.name || item.item || ''),
                quantity: Number(item.quantity || item.qty || 1) || 1,
                price: Number(item.price || 0) || 0
              }));
            }
            
            resultObj.subtotal = Number(parsed.subtotal) || 0;
            resultObj.tax = Number(parsed.tax) || 0;
            resultObj.service = Number(parsed.service) || 0;
            resultObj.discount = Number(parsed.discount) || 0;
            resultObj.grand_total = Number(parsed.grand_total) || 0;

            // Ensure discount is negative
            if (resultObj.discount > 0) resultObj.discount = -resultObj.discount;
          }

          // Validation
          if (!resultObj.items || resultObj.items.length === 0) {
            console.warn('[OCR] No items found in parsed JSON');
            lastError = { message: 'No items extracted from receipt', code: 'NO_ITEMS' };
            continue;
          }

          console.log(`[OCR] ✓ Success with ${model}:`, {
            itemCount: resultObj.items.length,
            grandTotal: resultObj.grand_total
          });

          return jsonResponse(res, resultObj);

        } catch (parseErr) {
          console.error(`[OCR] JSON parse failed for ${model}:`, parseErr.message);
          console.error('[OCR] Problematic text:', textContent);
          lastError = { message: 'JSON parse error: ' + parseErr.message, code: 'PARSE_ERROR' };
          continue;
        }

      } catch (err) {
        console.error(`[OCR] Exception with ${model}:`, err.message);
        lastError = { message: err.message, code: 'NETWORK_ERROR' };
        continue;
      }
    }

    // Semua model gagal
    const errorSummary = lastError ? `${lastError.code}: ${lastError.message}` : 'Unknown error';
    console.error('[OCR] All models exhausted. Last error:', errorSummary);

    return jsonResponse(res, {
      error: 'Gagal memproses struk dengan AI. Silakan coba lagi nanti.',
      details: errorSummary
    }, 503);

  } catch (err) {
    console.error('[OCR] Critical error:', err);
    return jsonResponse(res, {
      error: 'Terjadi kesalahan saat memproses OCR: ' + err.message
    }, 500);
  }
}
