const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// This file is a real outbox:
// - enqueue notifications to pending.json
// - a sender worker removes items ONLY after successful delivery
const NOTIFY_FILE = path.join(__dirname, '../data/notifications/pending.json');

function ensureDir() {
  const dir = path.dirname(NOTIFY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Migration: the old implementation used pending.json as an append-only feed.
// The new implementation treats it as a real outbox.
// To avoid re-sending historical notifications, we archive legacy files on startup.
function migrateLegacyIfNeeded() {
  ensureDir();
  if (!fs.existsSync(NOTIFY_FILE)) return;

  let arr;
  try {
    arr = JSON.parse(fs.readFileSync(NOTIFY_FILE, 'utf8'));
  } catch {
    return; // unreadable; leave as-is
  }
  if (!Array.isArray(arr) || arr.length === 0) return;

  const looksLegacy = arr.some(x => x && (x.attempts === undefined || x.last_attempt_at === undefined || x.last_error === undefined));
  if (!looksLegacy) return;

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const archived = path.join(path.dirname(NOTIFY_FILE), `pending.legacy.${ts}.json`);
  try {
    fs.renameSync(NOTIFY_FILE, archived);
    fs.writeFileSync(NOTIFY_FILE, '[]');
    console.log('[notify] Archived legacy pending.json to', archived);
  } catch (e) {
    console.error('[notify] Failed to archive legacy pending.json:', e?.message || e);
  }
}

migrateLegacyIfNeeded();

function readAll() {
  ensureDir();
  try {
    if (fs.existsSync(NOTIFY_FILE)) {
      const raw = fs.readFileSync(NOTIFY_FILE, 'utf8');
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    }
  } catch (e) {
    // ignore parse errors (treat as empty)
  }
  return [];
}

function writeAll(notifications) {
  ensureDir();
  fs.writeFileSync(NOTIFY_FILE, JSON.stringify(notifications, null, 2));
}

function addNotification(notification) {
  const notifications = readAll();
  const item = {
    ...notification,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    attempts: 0,
    last_attempt_at: null,
    last_error: null
  };
  notifications.push(item);
  writeAll(notifications);
  return item;
}

function getNotifications() {
  return readAll();
}

function clearNotifications() {
  writeAll([]);
}

function markSent(id) {
  const notifications = readAll();
  const next = notifications.filter(n => n.id !== id);
  writeAll(next);
  return next.length !== notifications.length;
}

function markAttempt(id, errorText) {
  const notifications = readAll();
  let changed = false;
  const now = new Date().toISOString();
  const next = notifications.map(n => {
    if (n.id !== id) return n;
    changed = true;
    return {
      ...n,
      attempts: (Number(n.attempts) || 0) + 1,
      last_attempt_at: now,
      last_error: (typeof errorText === 'string' && errorText.trim()) ? errorText.slice(0, 1000) : 'send failed'
    };
  });
  if (changed) writeAll(next);
  return changed;
}

module.exports = {
  addNotification,
  getNotifications,
  clearNotifications,
  markSent,
  markAttempt,
  NOTIFY_FILE
};
