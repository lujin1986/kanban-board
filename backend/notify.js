const fs = require('fs');
const path = require('path');

const NOTIFY_FILE = path.join(__dirname, '../data/notifications/pending.json');

function ensureDir() {
  const dir = path.dirname(NOTIFY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function addNotification(notification) {
  ensureDir();
  let notifications = [];
  try {
    if (fs.existsSync(NOTIFY_FILE)) {
      notifications = JSON.parse(fs.readFileSync(NOTIFY_FILE, 'utf8'));
    }
  } catch (e) {
    notifications = [];
  }
  notifications.push({
    ...notification,
    id: Date.now(),
    created_at: new Date().toISOString()
  });
  fs.writeFileSync(NOTIFY_FILE, JSON.stringify(notifications, null, 2));
}

function getNotifications() {
  ensureDir();
  try {
    if (fs.existsSync(NOTIFY_FILE)) {
      return JSON.parse(fs.readFileSync(NOTIFY_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function clearNotifications() {
  ensureDir();
  fs.writeFileSync(NOTIFY_FILE, '[]');
}

module.exports = { addNotification, getNotifications, clearNotifications };
