#!/usr/bin/env node
/**
 * Kanban SSE Watcher
 * Listens to /api/events SSE stream and triggers Clawdbot notifications
 *
 * Usage:
 *   npm run watcher                                    # Run in foreground
 *   nohup npm run watcher > watcher.log 2>&1 &         # Run in background with nohup
 *   KANBAN_SSE_URL=http://host:port/api/events npm run watcher  # Custom URL
 *
 * Systemd:
 *   sudo cp scripts/kanban-watcher.service /etc/systemd/system/
 *   sudo systemctl daemon-reload
 *   sudo systemctl enable --now kanban-watcher
 */

const { spawn } = require('child_process');
const EventSource = require('eventsource');

const SSE_URL = process.env.KANBAN_SSE_URL || 'http://localhost:3000/api/events';
const RECONNECT_DELAY_MS = 5000;

let eventSource = null;
let reconnectTimeout = null;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function notifyClawdbot(text) {
  log(`Notifying: ${text}`);

  const proc = spawn('clawdbot', ['system', 'event', '--text', text, '--mode', 'now'], {
    stdio: 'inherit'
  });

  proc.on('error', (err) => {
    log(`Failed to run clawdbot: ${err.message}`);
  });

  proc.on('exit', (code) => {
    if (code !== 0) {
      log(`clawdbot exited with code ${code}`);
    }
  });
}

function formatEventSummary(type, data) {
  switch (type) {
    case 'task:created':
      return `Task created: "${data.title}" (${data.assignee})`;
    case 'task:updated':
      return `Task updated: "${data.title}" -> ${data.status}`;
    case 'task:deleted':
      return `Task deleted: ID ${data.id}`;
    case 'comment:added':
      return `Comment on task #${data.taskId}: ${data.comment?.author || 'Unknown'} said "${truncate(data.comment?.content, 50)}"`;
    default:
      return `${type}`;
  }
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

function connect() {
  if (eventSource) {
    eventSource.close();
  }

  log(`Connecting to ${SSE_URL}...`);

  eventSource = new EventSource(SSE_URL);

  eventSource.onopen = () => {
    log('Connected to SSE stream');
  };

  eventSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      const { type, data } = payload;

      // Ignore connection/heartbeat events
      if (type === 'connected') {
        log('Received connection confirmation');
        return;
      }

      // Notify on task and comment events
      if (type && type.startsWith('task:') || type === 'comment:added') {
        const summary = formatEventSummary(type, data);
        notifyClawdbot(`ACTION REQUIRED - Kanban: ${summary}. Reply to Jin and take action if needed.`);
      }
    } catch (err) {
      // Ignore parse errors (e.g., heartbeat comments)
      if (event.data && !event.data.startsWith(':')) {
        log(`Failed to parse event: ${err.message}`);
      }
    }
  };

  eventSource.onerror = (err) => {
    log(`SSE error: ${err.message || 'Connection lost'}`);
    eventSource.close();
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  log(`Reconnecting in ${RECONNECT_DELAY_MS / 1000} seconds...`);
  reconnectTimeout = setTimeout(() => {
    connect();
  }, RECONNECT_DELAY_MS);
}

function shutdown() {
  log('Shutting down...');
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  if (eventSource) {
    eventSource.close();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start
log('Kanban SSE Watcher starting...');
connect();
