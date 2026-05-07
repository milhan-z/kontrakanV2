/**
 * lib/db.js
 * Database connection & helper utilities (Pengganti db.php)
 * Menggunakan: PostgreSQL via Supabase + pg driver
 */

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

// ── Database Connection ──────────────────────────────────────────
let pool;

function getDB() {
  if (!pool) {
    pool = new Pool({
      host:     process.env.SUPABASE_DB_HOST,
      port:     parseInt(process.env.SUPABASE_DB_PORT || '5432'),
      database: process.env.SUPABASE_DB_NAME || 'postgres',
      user:     process.env.SUPABASE_DB_USER || 'postgres',
      password: process.env.SUPABASE_DB_PASSWORD,
      ssl:      { rejectUnauthorized: false }, // Required for Supabase
      max:      10,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

// ── CORS Helper ──────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
}

// ── Response Helper ──────────────────────────────────────────────
function jsonResponse(res, data, code = 200) {
  res.status(code).json(data);
}

// ── JWT Auth ─────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_in_prod';
const JWT_EXPIRES = '30d'; // 30 hari

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function getTokenFromReq(req) {
  // Cek Authorization header: "Bearer <token>"
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Cek cookie
  const cookieHeader = req.headers['cookie'] || '';
  const match = cookieHeader.match(/token=([^;]+)/);
  if (match) return match[1];
  return null;
}

function requireAuth(req, res) {
  const token = getTokenFromReq(req);
  if (!token) {
    jsonResponse(res, { error: 'Unauthorized' }, 401);
    return null;
  }
  const payload = verifyToken(token);
  if (!payload) {
    jsonResponse(res, { error: 'Token invalid or expired' }, 401);
    return null;
  }
  return payload; // { user_id, role, display_name }
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    jsonResponse(res, { error: 'Admin access required' }, 403);
    return null;
  }
  return user;
}

// ── Body Parser ──────────────────────────────────────────────────
async function getBody(req) {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body);
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

// ── Handle OPTIONS preflight ─────────────────────────────────────
function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

module.exports = {
  getDB,
  setCors,
  jsonResponse,
  createToken,
  verifyToken,
  requireAuth,
  requireAdmin,
  getBody,
  handleOptions,
};
