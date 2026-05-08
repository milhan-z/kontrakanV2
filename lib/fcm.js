/**
 * lib/fcm.js — Firebase Cloud Messaging Helper
 * Send push notifications to users via FCM
 */

async function getAccessToken() {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (!privateKey || !clientEmail || !projectId) {
    console.log('FCM credentials not configured');
    return null;
  }

  try {
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const crypto = require('crypto');
    const jwt = Buffer.from(JSON.stringify(header)).toString('base64').replace(/=/g, '')
      + '.' + Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=/g, '');

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(jwt);
    const signature = sign.sign(privateKey, 'base64').replace(/=/g, '');
    const token = jwt + '.' + signature;

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${token}`
    });

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('Error getting FCM access token:', error);
    return null;
  }
}

/**
 * Send push notification via FCM V1 API
 * @param {string} fcmToken - User's FCM token
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data
 */
async function sendPushNotification(fcmToken, title, body, data = {}) {
  if (!fcmToken) {
    console.log('FCM token missing');
    return null;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.log('Firebase project ID not configured');
    return null;
  }

  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      console.log('Failed to get FCM access token');
      return null;
    }

    const message = {
      message: {
        token: fcmToken,
        notification: {
          title,
          body
        },
        data: {
          url: data.url || '/',
          timestamp: new Date().toISOString(),
          ...data
        },
        webpush: {
          fcmOptions: {
            link: data.url || '/'
          }
        }
      }
    };

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(message)
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('FCM error:', result);
      return null;
    }

    console.log('Push notification sent:', result.name);
    return result;
  } catch (error) {
    console.error('Error sending push notification:', error);
    return null;
  }
}

/**
 * Send push notification to specific user
 * @param {object} db - Database connection
 * @param {number} userId - Target user ID
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data
 */
async function sendPushToUser(db, userId, title, body, data = {}) {
  try {
    const result = await db.query(
      'SELECT fcm_token FROM users WHERE id = $1 AND fcm_token IS NOT NULL',
      [userId]
    );

    if (result.rows.length && result.rows[0].fcm_token) {
      return await sendPushNotification(result.rows[0].fcm_token, title, body, data);
    }
    return null;
  } catch (error) {
    console.error('Error sending push to user:', error);
    return null;
  }
}

/**
 * Send push to multiple users
 * @param {object} db - Database connection
 * @param {array} userIds - Array of user IDs
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data
 */
async function sendPushToUsers(db, userIds, title, body, data = {}) {
  const results = [];
  for (const userId of userIds) {
    const result = await sendPushToUser(db, userId, title, body, data);
    results.push(result);
  }
  return results;
}

module.exports = {
  sendPushNotification,
  sendPushToUser,
  sendPushToUsers,
  getAccessToken
};
