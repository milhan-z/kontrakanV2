/**
 * api/notifications.js — Notifications API (Pengganti notifications.php)
 * GET → Get user notifications
 * PUT → Mark as read (single or all)
 */

const { getDB, setCors, jsonResponse, requireAuth, getBody, handleOptions } = require('../lib/db');

module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === 'GET') return getNotifications(req, res, user);
  if (req.method === 'PUT') return markAsRead(req, res, user);

  return jsonResponse(res, { error: 'Method not allowed' }, 405);
};

async function getNotifications(req, res, user) {
  const db = getDB();
  const unreadOnly = 'unread' in req.query;

  let sql = 'SELECT * FROM notifications WHERE user_id = $1';
  if (unreadOnly) sql += ' AND is_read = FALSE';
  sql += ' ORDER BY created_at DESC LIMIT 50';

  const result = await db.query(sql, [user.user_id]);

  const countResult = await db.query(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
    [user.user_id]
  );
  const unreadCount = parseInt(countResult.rows[0].count);

  return jsonResponse(res, { notifications: result.rows, unread_count: unreadCount });
}

async function markAsRead(req, res, user) {
  const action = req.query.action || '';
  const db = getDB();

  if (action === 'read-all') {
    await db.query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [user.user_id]);
    return jsonResponse(res, { success: true, message: 'All notifications marked as read' });
  }

  const input = await getBody(req);
  const notifId = parseInt(input.id || '0');
  if (!notifId) return jsonResponse(res, { error: 'Notification ID required' }, 400);

  await db.query(
    'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2',
    [notifId, user.user_id]
  );

  return jsonResponse(res, { success: true });
}
