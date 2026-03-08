/**
 * Matrix notification module for Kanban board
 * Sends real-time notifications to a Matrix room via bot account
 */

const https = require('https');
const http = require('http');

// Configuration - can be overridden via environment variables
const CONFIG = {
  homeserver: process.env.MATRIX_HOMESERVER || 'https://matrix.org',
  accessToken: process.env.MATRIX_BOT_TOKEN || '',
  roomId: process.env.MATRIX_ROOM_ID || '!gzVUTfUUHCscSdbDkb:matrix.org',
  enabled: true
};

// Action emoji mapping
const ACTION_EMOJI = {
  'created task': '📝',
  'updated task': '✏️',
  'moved task': '📦',
  'deleted task': '🗑️',
  'commented on task': '💬',
  'updated goals': '🎯'
};

/**
 * Send a message to the Matrix room
 */
async function sendMatrixMessage(text, html = null, opts = {}) {
  if (!CONFIG.enabled || !CONFIG.accessToken) {
    console.log('[matrix-notify] Disabled or no token, skipping:', text);
    return null;
  }

  const maxAttempts = Number.isFinite(opts.maxAttempts) ? opts.maxAttempts : 4;
  const baseDelayMs = Number.isFinite(opts.baseDelayMs) ? opts.baseDelayMs : 800;

  const txnId = `kanban_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const roomId = encodeURIComponent(CONFIG.roomId);
  const url = `${CONFIG.homeserver}/_matrix/client/v3/rooms/${roomId}/send/m.room.message/${txnId}`;

  const body = {
    msgtype: 'm.text',
    body: text
  };

  // Add HTML formatting if provided
  if (html) {
    body.format = 'org.matrix.custom.html';
    body.formatted_body = html;
  }

  const urlObj = new URL(url);
  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname,
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${CONFIG.accessToken}`,
      'Content-Type': 'application/json'
    }
  };

  const transport = urlObj.protocol === 'https:' ? https : http;

  function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function attemptSend(attempt) {
    const result = await new Promise((resolve) => {
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[matrix-notify] Message sent successfully');
            try {
              resolve({ ok: true, data: JSON.parse(data) });
            } catch {
              resolve({ ok: true, data: null });
            }
            return;
          }
          resolve({ ok: false, status: res.statusCode, data });
        });
      });

      req.on('error', (err) => {
        resolve({ ok: false, status: 0, data: err?.message || 'request error' });
      });

      req.write(JSON.stringify(body));
      req.end();
    });

    if (result.ok) return result.data;

    const status = result.status || 0;
    const bodyText = result.data || '';
    const shouldRetry = (status === 0) || status === 429 || (status >= 500 && status <= 599);

    if (!shouldRetry || attempt >= maxAttempts) {
      console.error('[matrix-notify] Failed:', status, bodyText);
      return null;
    }

    const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), 15000);
    console.warn(`[matrix-notify] Send failed (status=${status}), retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
    await wait(delay);
    return attemptSend(attempt + 1);
  }

  return attemptSend(1);
}

/**
 * Format and send a Kanban notification
 */
async function notifyKanban(notification) {
  const emoji = ACTION_EMOJI[notification.action] || '📋';
  
  // Plain text version
  let text = `${emoji} Kanban: ${notification.actor} ${notification.action}`;
  if (notification.task_title) {
    text += ` "${notification.task_title}"`;
  }
  if (notification.details) {
    text += `\n   └ ${notification.details}`;
  }

  // HTML version (optional enhancement)
  let html = `${emoji} <b>Kanban:</b> ${notification.actor} ${notification.action}`;
  if (notification.task_title) {
    html += ` <i>"${notification.task_title}"</i>`;
  }
  if (notification.details) {
    html += `<br>&nbsp;&nbsp;&nbsp;└ ${notification.details}`;
  }

  return sendMatrixMessage(text, html);
}

/**
 * Initialize with token (call once at startup)
 */
function init(token, roomId = null) {
  if (token) CONFIG.accessToken = token;
  if (roomId) CONFIG.roomId = roomId;
  CONFIG.enabled = !!CONFIG.accessToken;
  console.log(`[matrix-notify] Initialized, enabled: ${CONFIG.enabled}`);
}

/**
 * Test the connection by sending a startup message
 */
async function testConnection() {
  return sendMatrixMessage('🤖 Kanban notification bot connected!');
}

module.exports = {
  init,
  sendMatrixMessage,
  notifyKanban,
  testConnection,
  CONFIG
};
