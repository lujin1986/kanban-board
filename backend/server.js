const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./database');
const notify = require('./notify');
const matrixNotify = require('./matrix-notify');

const app = express();
const PORT = process.env.PORT || 3000;
const NOTIFY_FOR_ACTORS = (process.env.NOTIFY_FOR_ACTORS || 'Jin').split(',').map(s => s.trim());

// Initialize Matrix notifications
const matrixConfigPath = path.join(__dirname, '../config/matrix.json');
if (fs.existsSync(matrixConfigPath)) {
  try {
    const matrixConfig = JSON.parse(fs.readFileSync(matrixConfigPath, 'utf8'));
    matrixNotify.init(matrixConfig.accessToken, matrixConfig.roomId);
    console.log('[server] Matrix notifications enabled');
  } catch (err) {
    console.error('[server] Failed to load Matrix config:', err.message);
  }
}

// Queue notification for watched actors (file-based + Matrix real-time)
function queueNotification(activity) {
  const notification = {
    actor: activity.actor,
    action: activity.action,
    task_id: activity.task_id,
    task_title: activity.task_title,
    details: activity.details,
    summary: `${activity.actor} ${activity.action}${activity.task_title ? ` "${activity.task_title}"` : ''}${activity.details ? ` (${activity.details})` : ''}`
  };
  
  // File-based notification (for polling)
  notify.addNotification(notification);
  
  // Real-time Matrix notification
  matrixNotify.notifyKanban(notification).catch(err => {
    console.error('[server] Matrix notification error:', err.message);
  });
}

// SSE connected clients
const sseClients = new Set();

function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  for (const res of sseClients) {
    res.write(`data: ${message}\n\n`);
  }
}

// Uploads
const uploadsDir = path.join(__dirname, '../data/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 10) || '';
      const name = `${Date.now()}-${crypto.randomUUID()}${ext}`;
      cb(null, name);
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
    files: 20
  },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error(`Unsupported file type: ${file.mimetype}`), ok);
  }
});

app.use(cors());
app.use(express.json());

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// === SSE Endpoint ===
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

  sseClients.add(res);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// === Task Routes ===

// List all tasks
app.get('/api/tasks', (req, res) => {
  try {
    const tasks = db.getAllTasks();
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get task by hex_id
app.get('/api/tasks/hex/:hexId', (req, res) => {
  try {
    const task = db.getTaskByHexId(req.params.hexId.toUpperCase());
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const comments = db.getComments(task.id);
    res.json({ ...task, comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single task with comments
app.get('/api/tasks/:id', (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const comments = db.getComments(req.params.id);
    res.json({ ...task, comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create task
app.post('/api/tasks', (req, res) => {
  try {
    const { title, description, checklist_text, assignee, priority, status, actor } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    const task = db.createTask({
      title,
      description: description || '',
      checklist_text: checklist_text || '',
      assignee: assignee || 'Jin',
      priority: priority || 'medium',
      status: status || 'backlog'
    });
    const activity = {
      actor: actor || assignee || 'Jin',
      action: 'created task',
      task_id: task.id,
      task_title: task.title
    };
    db.logActivity(activity);
    if (NOTIFY_FOR_ACTORS.includes(activity.actor)) {
      queueNotification(activity);
    }
    broadcast('task:created', task);
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update task
app.put('/api/tasks/:id', (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const { actor, ...updates } = req.body;
    const updated = db.updateTask(req.params.id, updates);
    
    // Build details about what changed
    const changes = [];
    if (updates.status && updates.status !== task.status) changes.push(`status → ${updates.status}`);
    if (updates.title && updates.title !== task.title) changes.push(`title → "${updates.title}"`);
    if (updates.priority && updates.priority !== task.priority) changes.push(`priority → ${updates.priority}`);
    if (updates.assignee && updates.assignee !== task.assignee) changes.push(`assignee → ${updates.assignee}`);
    if (updates.description !== undefined && updates.description !== task.description) changes.push('description updated');
    if (updates.checklist_text !== undefined && updates.checklist_text !== task.checklist_text) changes.push('checklist updated');
    
    const activity = {
      actor: actor || task.assignee || 'unknown',
      action: 'updated task',
      task_id: task.id,
      task_title: task.title,
      details: changes.length ? changes.join(', ') : null
    };
    db.logActivity(activity);
    if (NOTIFY_FOR_ACTORS.includes(activity.actor)) {
      queueNotification(activity);
    }
    broadcast('task:updated', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update task status (convenience endpoint)
app.patch('/api/tasks/:id/status', (req, res) => {
  try {
    const { status, actor } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const updated = db.updateTask(req.params.id, { status });
    const activity = {
      actor: actor || task.assignee || 'unknown',
      action: 'moved task',
      task_id: task.id,
      task_title: task.title,
      details: `${task.status} → ${status}`
    };
    db.logActivity(activity);
    if (NOTIFY_FOR_ACTORS.includes(activity.actor)) {
      queueNotification(activity);
    }
    broadcast('task:updated', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete task
app.delete('/api/tasks/:id', (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const actor = req.body?.actor || task.assignee || 'unknown';
    db.deleteTask(req.params.id);
    const activity = {
      actor,
      action: 'deleted task',
      task_id: null, // task is gone
      task_title: task.title
    };
    db.logActivity(activity);
    if (NOTIFY_FOR_ACTORS.includes(activity.actor)) {
      queueNotification(activity);
    }
    broadcast('task:deleted', { id: parseInt(req.params.id) });
    res.json({ message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Checklist Routes ===

// Get checklist for a task
app.get('/api/tasks/:id/checklist', (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const checklist = db.getChecklist(req.params.id) || [];
    res.json({ taskId: parseInt(req.params.id), checklist });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add checklist item
app.post('/api/tasks/:id/checklist', (req, res) => {
  try {
    const { text } = req.body;
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const item = db.addChecklistItem(req.params.id, text.trim());
    const updated = db.getTask(req.params.id);
    broadcast('task:updated', updated);

    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update checklist item (toggle / edit)
app.patch('/api/tasks/:id/checklist/:itemId', (req, res) => {
  try {
    const { checked, text } = req.body;

    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const hasChecked = checked !== undefined;
    const hasText = text !== undefined;
    if (!hasChecked && !hasText) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    if (hasChecked && typeof checked !== 'boolean') {
      return res.status(400).json({ error: 'checked must be a boolean' });
    }
    if (hasText && typeof text !== 'string') {
      return res.status(400).json({ error: 'text must be a string' });
    }

    const item = db.updateChecklistItem(req.params.id, req.params.itemId, {
      checked: hasChecked ? checked : undefined,
      text: hasText ? text : undefined
    });

    if (item === undefined) {
      return res.status(404).json({ error: 'Checklist item not found' });
    }

    const updated = db.getTask(req.params.id);
    broadcast('task:updated', updated);

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete checklist item
app.delete('/api/tasks/:id/checklist/:itemId', (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const removed = db.deleteChecklistItem(req.params.id, req.params.itemId);
    if (removed === undefined) {
      return res.status(404).json({ error: 'Checklist item not found' });
    }

    const updated = db.getTask(req.params.id);
    broadcast('task:updated', updated);

    res.json({ message: 'Deleted', item: removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Goals Routes ===

// Get goals
app.get('/api/goals', (req, res) => {
  try {
    const setting = db.getSetting('goals_markdown');
    res.json({
      key: 'goals_markdown',
      content: setting ? setting.value : '',
      updated_at: setting ? setting.updated_at : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update goals
app.put('/api/goals', (req, res) => {
  try {
    const { content, actor } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }
    const setting = db.updateSetting('goals_markdown', content);
    
    const activity = {
      actor: actor || 'unknown',
      action: 'updated goals',
      task_id: null,
      task_title: null
    };
    db.logActivity(activity);
    if (NOTIFY_FOR_ACTORS.includes(activity.actor)) {
      queueNotification(activity);
    }
    
    broadcast('goals:updated', { key: 'goals_markdown', content: setting.value, updated_at: setting.updated_at });
    res.json({
      key: 'goals_markdown',
      content: setting.value,
      updated_at: setting.updated_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Strategy Map Routes ===

// Get strategy map
app.get('/api/strategy-map', (req, res) => {
  try {
    const setting = db.getSetting('strategy_map');
    const descSetting = db.getSetting('strategy_map_description');
    res.json({
      content: setting ? setting.value : '',
      description: descSetting ? descSetting.value : '',
      updated_at: setting ? setting.updated_at : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update strategy map
app.put('/api/strategy-map', (req, res) => {
  try {
    const { content, description, actor } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be a string' });
    }
    const setting = db.updateSetting('strategy_map', content);
    if (typeof description === 'string') {
      db.updateSetting('strategy_map_description', description);
    }
    const descSetting = db.getSetting('strategy_map_description');

    const activity = {
      actor: actor || 'unknown',
      action: 'updated strategy map',
      task_id: null,
      task_title: null
    };
    db.logActivity(activity);
    if (NOTIFY_FOR_ACTORS.includes(activity.actor)) {
      queueNotification(activity);
    }

    broadcast('strategymap:updated', {
      content: setting.value,
      description: descSetting ? descSetting.value : '',
      updated_at: setting.updated_at
    });
    res.json({
      content: setting.value,
      description: descSetting ? descSetting.value : '',
      updated_at: setting.updated_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Comment Routes ===

// Add comment to task (supports multipart uploads)
app.post('/api/tasks/:id/comments', upload.array('images', 20), (req, res) => {
  try {
    const { author, content } = req.body;
    const files = req.files || [];

    // Allow "image-only" comments, but require at least content or one image
    if ((!content || !String(content).trim()) && files.length === 0) {
      return res.status(400).json({ error: 'Content or at least one image is required' });
    }

    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const attachments = files.map(f => ({
      type: 'image',
      url: `/uploads/${f.filename}`,
      filename: f.originalname,
      mime: f.mimetype,
      size: f.size
    }));

    const comment = db.addComment(req.params.id, {
      author: author || 'Jin',
      content: content ? String(content) : '',
      attachments
    });

    const activity = {
      actor: author || 'Jin',
      action: 'commented on task',
      task_id: task.id,
      task_title: task.title
    };
    db.logActivity(activity);

    // Queue notification if comment is from a watched actor (e.g. Jin)
    if (NOTIFY_FOR_ACTORS.includes(activity.actor)) {
      const preview = (content ? String(content) : '').slice(0, 200);
      const details = preview || (attachments.length ? `[${attachments.length} image(s)]` : null);
      queueNotification({ ...activity, details });
    }

    broadcast('comment:added', { taskId: parseInt(req.params.id), comment });
    res.status(201).json(comment);
  } catch (err) {
    // Multer/file validation errors
    const msg = err?.message || 'Unknown error';

    // Multer-specific errors
    if (err && err.name === 'MulterError') {
      // https://github.com/expressjs/multer#error-handling
      const code = err.code;
      if (code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large (max 5MB per image)' });
      }
      if (code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files' });
      }
      if (code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: 'Unexpected file field (use images[])' });
      }
      return res.status(400).json({ error: msg });
    }

    // Our fileFilter uses a generic Error for unsupported mimetypes
    if (typeof msg === 'string' && msg.startsWith('Unsupported file type:')) {
      return res.status(400).json({ error: msg });
    }

    res.status(500).json({ error: msg });
  }
});

// Get comments for task
app.get('/api/tasks/:id/comments', (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const comments = db.getComments(req.params.id);
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Notification Routes ===

// Get pending notifications (for Clawdbot polling)
app.get('/api/notifications', (req, res) => {
  try {
    const notifications = notify.getNotifications();
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear notifications after processing
app.delete('/api/notifications', (req, res) => {
  try {
    notify.clearNotifications();
    res.json({ message: 'Notifications cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Activity Log Routes ===

// Get activity log
app.get('/api/activity', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const since = req.query.since || null;
    const actor = req.query.actor || null;
    
    const activities = db.getActivityLog({ limit, since, actor });
    
    // Format for human readability
    const formatted = activities.map(a => ({
      id: a.id,
      timestamp: a.timestamp,
      summary: formatActivitySummary(a),
      actor: a.actor,
      action: a.action,
      task_id: a.task_id,
      task_title: a.task_title,
      details: a.details
    }));
    
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function formatActivitySummary(activity) {
  const { actor, action, task_id, task_title, details } = activity;
  let summary = `${actor} ${action}`;
  if (task_title) {
    summary += task_id ? ` #${task_id} "${task_title}"` : ` "${task_title}"`;
  }
  if (details) {
    summary += ` (${details})`;
  }
  return summary;
}

// === Mindmap Routes ===
const mindmapsDir = path.join(__dirname, '../data/mindmaps');
if (!fs.existsSync(mindmapsDir)) {
  fs.mkdirSync(mindmapsDir, { recursive: true });
}

function getMindmapPath(id) {
  return path.join(mindmapsDir, `${id}.json`);
}

function readMindmap(id) {
  const p = getMindmapPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeMindmap(data) {
  fs.writeFileSync(getMindmapPath(data.id), JSON.stringify(data, null, 2), 'utf8');
}

// List all mindmaps
app.get('/api/mindmaps', (req, res) => {
  try {
    const files = fs.readdirSync(mindmapsDir).filter(f => f.endsWith('.json'));
    const list = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(mindmapsDir, f), 'utf8'));
      return { id: data.id, title: data.title, tag: data.tag || 'knowledge', updated_at: data.updated_at };
    }).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create mindmap
app.post('/api/mindmaps', (req, res) => {
  try {
    const { title, tag } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const validTag = (tag === 'execution') ? 'execution' : 'knowledge';
    const mindmap = {
      id,
      title,
      tag: validTag,
      data: {
        data: { text: title, children: [] }
      },
      notes: '',
      created_at: now,
      updated_at: now
    };
    writeMindmap(mindmap);
    res.status(201).json(mindmap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single mindmap
app.get('/api/mindmaps/:id', (req, res) => {
  try {
    const mindmap = readMindmap(req.params.id);
    if (!mindmap) return res.status(404).json({ error: 'Mindmap not found' });
    // Ensure tag field exists for backward compatibility
    if (!mindmap.tag) mindmap.tag = 'knowledge';
    res.json(mindmap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Shared update logic for PUT and POST
function applyMindmapUpdate(mindmap, body) {
  const { title, data, notes, history, tag } = body;
  if (title !== undefined) mindmap.title = title;
  if (tag !== undefined) mindmap.tag = (tag === 'execution') ? 'execution' : 'knowledge';
  if (data !== undefined) mindmap.data = data;
  if (notes !== undefined) mindmap.notes = notes;
  // Persist undo/redo history (capped at 20 steps to keep file size reasonable)
  if (history !== undefined) {
    const maxSteps = 20;
    mindmap.history = {
      undo: (history.undo || []).slice(-maxSteps),
      redo: (history.redo || []).slice(-maxSteps),
    };
  }
  // Bump revision counter
  mindmap.revision = (mindmap.revision || 0) + 1;
  mindmap.updated_at = new Date().toISOString();
  return mindmap;
}

// Update mindmap
app.put('/api/mindmaps/:id', (req, res) => {
  try {
    const mindmap = readMindmap(req.params.id);
    if (!mindmap) return res.status(404).json({ error: 'Mindmap not found' });
    const source = req.body.source || 'api';
    applyMindmapUpdate(mindmap, req.body);
    writeMindmap(mindmap);
    // Notify all SSE clients about the update
    broadcast('mindmap:updated', {
      id: mindmap.id,
      source,
      revision: mindmap.revision,
      title: mindmap.title,
      tag: mindmap.tag || 'knowledge',
      updated_at: mindmap.updated_at
    });
    res.json(mindmap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update mindmap (POST — for sendBeacon compatibility)
app.post('/api/mindmaps/:id', (req, res) => {
  try {
    const mindmap = readMindmap(req.params.id);
    if (!mindmap) return res.status(404).json({ error: 'Mindmap not found' });
    const source = req.body.source || 'frontend';
    applyMindmapUpdate(mindmap, req.body);
    writeMindmap(mindmap);
    broadcast('mindmap:updated', {
      id: mindmap.id,
      source,
      revision: mindmap.revision,
      title: mindmap.title,
      tag: mindmap.tag || 'knowledge',
      updated_at: mindmap.updated_at
    });
    res.json(mindmap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete mindmap
app.delete('/api/mindmaps/:id', (req, res) => {
  try {
    const p = getMindmapPath(req.params.id);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'Mindmap not found' });
    fs.unlinkSync(p);
    res.json({ message: 'Mindmap deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`Kanban Board running at http://localhost:${PORT}`);
});
