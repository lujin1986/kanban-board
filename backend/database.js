const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, '../data/kanban.db');
const db = new Database(dbPath);

// Initialize tables
// Note: checklist is added via ALTER TABLE below to support upgrading existing DBs.
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    assignee TEXT DEFAULT 'Jin',
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'backlog',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    task_id INTEGER,
    task_title TEXT,
    details TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp DESC);
`);

// --- DB upgrades / migrations (lightweight) ---
// Re-read table_info between ALTER TABLE statements.
function taskHasColumn(name) {
  const cols = db.prepare("PRAGMA table_info(tasks)").all();
  return cols.some(col => col.name === name);
}

function commentsHasColumn(name) {
  const cols = db.prepare("PRAGMA table_info(comments)").all();
  return cols.some(col => col.name === name);
}

if (!taskHasColumn('checklist')) {
  db.exec("ALTER TABLE tasks ADD COLUMN checklist TEXT DEFAULT '[]'");
}

if (!taskHasColumn('checklist_text')) {
  db.exec("ALTER TABLE tasks ADD COLUMN checklist_text TEXT DEFAULT ''");
}

// Comments attachments (JSON array)
if (!commentsHasColumn('attachments_json')) {
  db.exec("ALTER TABLE comments ADD COLUMN attachments_json TEXT DEFAULT '[]'");
}

// Hex ID field
if (!taskHasColumn('hex_id')) {
  db.exec("ALTER TABLE tasks ADD COLUMN hex_id TEXT DEFAULT NULL");
  // Backfill existing tasks with hex IDs in order of id
  const existingTasks = db.prepare('SELECT id FROM tasks ORDER BY id ASC').all();
  const backfillStmt = db.prepare('UPDATE tasks SET hex_id = ? WHERE id = ?');
  existingTasks.forEach((t, idx) => {
    const hexId = (idx + 1).toString(16).toUpperCase().padStart(4, '0');
    backfillStmt.run(hexId, t.id);
  });
}

// Helper: get next hex_id
function getNextHexId() {
  const row = db.prepare("SELECT hex_id FROM tasks WHERE hex_id IS NOT NULL ORDER BY hex_id DESC LIMIT 1").get();
  if (!row || !row.hex_id) return '0001';
  const next = parseInt(row.hex_id, 16) + 1;
  return next.toString(16).toUpperCase().padStart(4, '0');
}

// Insert default goals if not exists
const defaultGoals = `## Active Goals

### Proactive Kanban Workflow
- Maintain daily board hygiene
- Move tasks through columns promptly
- Keep backlog prioritized and groomed

### Implement Goals + DoD/Checklist
- Board-level goals for strategic context
- Per-task Definition of Done checklists

### Local-Agent Extractor Usage
- Integrate with local AI agents for task extraction
- Support clawdbot SSE integration
- Enable automated task creation from conversations

### SPU Fact-Sources Review Checklist
- [ ] Verify source authenticity
- [ ] Cross-reference with primary sources
- [ ] Document citation chain
- [ ] Flag uncertainty levels`;

db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run('goals_markdown', defaultGoals);

// Task operations
function getAllTasks() {
  return db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
}

function getTask(id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

function getTaskByHexId(hexId) {
  return db.prepare('SELECT * FROM tasks WHERE hex_id = ?').get(hexId);
}

function createTask({ title, description, checklist_text, assignee, priority, status }) {
  const hexId = getNextHexId();
  const stmt = db.prepare(`
    INSERT INTO tasks (title, description, checklist_text, assignee, priority, status, hex_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    title,
    description,
    checklist_text || '',
    assignee,
    priority,
    status,
    hexId
  );
  return getTask(result.lastInsertRowid);
}

function updateTask(id, updates) {
  const task = getTask(id);
  if (!task) return null;

  const fields = ['title', 'description', 'checklist_text', 'assignee', 'priority', 'status', 'checklist'];
  const toUpdate = {};

  for (const field of fields) {
    toUpdate[field] = updates[field] !== undefined ? updates[field] : task[field];
  }

  const stmt = db.prepare(`
    UPDATE tasks
    SET title = ?, description = ?, checklist_text = ?, assignee = ?, priority = ?, status = ?, checklist = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(
    toUpdate.title,
    toUpdate.description,
    toUpdate.checklist_text || '',
    toUpdate.assignee,
    toUpdate.priority,
    toUpdate.status,
    toUpdate.checklist,
    id
  );
  return getTask(id);
}

function deleteTask(id) {
  db.prepare('DELETE FROM comments WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

// Comment operations
function getComments(taskId) {
  const rows = db.prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC').all(taskId);
  return rows.map(r => {
    let attachments = [];
    try {
      attachments = r.attachments_json ? JSON.parse(r.attachments_json) : [];
    } catch {
      attachments = [];
    }
    return { ...r, attachments };
  });
}

function addComment(taskId, { author, content, attachments = [] }) {
  const attachmentsJson = JSON.stringify(Array.isArray(attachments) ? attachments : []);
  const stmt = db.prepare(`
    INSERT INTO comments (task_id, author, content, attachments_json)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(taskId, author, content, attachmentsJson);
  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid);
  let parsed = [];
  try { parsed = row.attachments_json ? JSON.parse(row.attachments_json) : []; } catch { parsed = []; }
  return { ...row, attachments: parsed };
}

// Settings operations
function getSetting(key) {
  return db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
}

function updateSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, value);
  return getSetting(key);
}

// Checklist helpers
function parseChecklist(checklistText) {
  if (!checklistText) return [];
  try {
    const parsed = JSON.parse(checklistText);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getChecklist(taskId) {
  const task = getTask(taskId);
  if (!task) return null;
  return parseChecklist(task.checklist);
}

function setChecklist(taskId, checklist) {
  const json = JSON.stringify(Array.isArray(checklist) ? checklist : []);
  return updateTask(taskId, { checklist: json });
}

function addChecklistItem(taskId, text) {
  const task = getTask(taskId);
  if (!task) return null;

  const checklist = getChecklist(taskId) || [];
  const item = {
    id: crypto.randomUUID(),
    text,
    checked: false,
    created_at: new Date().toISOString()
  };
  checklist.push(item);
  setChecklist(taskId, checklist);
  return item;
}

function updateChecklistItem(taskId, itemId, updates) {
  const task = getTask(taskId);
  if (!task) return null;

  const checklist = getChecklist(taskId) || [];
  const item = checklist.find(i => i.id === itemId);
  if (!item) return undefined;

  if (updates.text !== undefined) item.text = updates.text;
  if (updates.checked !== undefined) item.checked = updates.checked;

  setChecklist(taskId, checklist);
  return item;
}

function deleteChecklistItem(taskId, itemId) {
  const task = getTask(taskId);
  if (!task) return null;

  const checklist = getChecklist(taskId) || [];
  const idx = checklist.findIndex(i => i.id === itemId);
  if (idx === -1) return undefined;

  const [removed] = checklist.splice(idx, 1);
  setChecklist(taskId, checklist);
  return removed;
}

// Activity log operations
function logActivity({ actor, action, task_id = null, task_title = null, details = null }) {
  const stmt = db.prepare(`
    INSERT INTO activity_log (actor, action, task_id, task_title, details)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(actor, action, task_id, task_title, details);
  return db.prepare('SELECT * FROM activity_log WHERE id = ?').get(result.lastInsertRowid);
}

function getActivityLog({ limit = 50, since = null, actor = null } = {}) {
  let sql = 'SELECT * FROM activity_log WHERE 1=1';
  const params = [];

  if (since) {
    sql += ' AND timestamp > ?';
    params.push(since);
  }
  if (actor) {
    sql += ' AND actor = ?';
    params.push(actor);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params);
}

module.exports = {
  getAllTasks,
  getTask,
  getTaskByHexId,
  createTask,
  updateTask,
  deleteTask,
  getChecklist,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  getComments,
  addComment,
  getSetting,
  updateSetting,
  logActivity,
  getActivityLog
};
