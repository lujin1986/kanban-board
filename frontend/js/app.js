const API_URL = '/api';

// DOM Elements
const board = document.querySelector('.board');
const addTaskBtn = document.getElementById('add-task-btn');
const taskModal = document.getElementById('task-modal');
const taskForm = document.getElementById('task-form');
const modalTitle = document.getElementById('modal-title');
const closeBtn = document.querySelector('.close-btn');
const deleteBtn = document.getElementById('delete-task-btn');
const checklistField = document.getElementById('checklist');

const commentsSection = document.getElementById('comments-section');
const commentsList = document.getElementById('comments-list');
const commentForm = document.getElementById('comment-form');

// Navigation + Goals DOM Elements
const navLinks = document.querySelectorAll('.nav-link');
const boardView = document.getElementById('board-view');
const goalsView = document.getElementById('goals-view');
const strategyView = document.getElementById('strategy-view');
const activityView = document.getElementById('activity-view');
const mindmapsView = document.getElementById('mindmaps-view');

// Activity DOM Elements
const activityList = document.getElementById('activity-list');
const activityActorFilter = document.getElementById('activity-actor-filter');
const activityLimitFilter = document.getElementById('activity-limit-filter');
const refreshActivityBtn = document.getElementById('refresh-activity-btn');

const goalsDisplay = document.getElementById('goals-display');
const goalsEditor = document.getElementById('goals-editor');
const goalsError = document.getElementById('goals-error');
const goalsUpdated = document.getElementById('goals-updated');

const editGoalsBtn = document.getElementById('edit-goals-btn');
const saveGoalsBtn = document.getElementById('save-goals-btn');
const cancelGoalsBtn = document.getElementById('cancel-goals-btn');

// State
let tasks = [];
let currentTaskId = null;
let eventSource = null;
let reconnectAttempts = 0;

// Comment attachments (client-side draft)
let pendingCommentFiles = []; // Array<{file: File, previewUrl: string}>

// Goals state
let goalsLoaded = false;
let goalsLoading = false;
let goalsIsEditing = false;
let goalsLoadSeq = 0; // prevents out-of-order async overwrites
let goalsSaveInFlight = false;
let goalsContent = '';
let goalsUpdatedAt = null;

// Activity state
let activityLoaded = false;
let activityData = [];
let usePreciseTime = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupGoals();
  setupActivity();
  loadTasks();
  setupEventListeners();
  setupDragAndDrop();
  setupSSE();
});

// SSE Connection
function setupSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`${API_URL}/events`);

  eventSource.onopen = () => {
    console.log('SSE connected');
    reconnectAttempts = 0;
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'connected') {
        return; // Initial connection event
      }
      // Reload tasks on any change
      if (data.type.startsWith('task:') || data.type.startsWith('comment:')) {
        loadTasks();
      }

      // Refresh strategy map when it changes
      if (data.type.startsWith('strategymap:')) {
        window.dispatchEvent(new CustomEvent('strategy-data-changed'));
      }

      // Refresh goals when they change
      if (data.type.startsWith('goals:')) {
        // Don't clobber the editor while the user is editing; just mark stale
        if (goalsIsEditing) {
          goalsLoaded = false;
        } else if (goalsView && goalsView.classList.contains('active')) {
          loadGoals();
        } else {
          goalsLoaded = false; // mark stale
        }
        // Also notify strategy map (it renders goals as markmap)
        window.dispatchEvent(new CustomEvent('goals-data-changed'));
      }
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    // Reconnect with exponential backoff (max 30s)
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;
    console.log(`SSE disconnected, reconnecting in ${delay}ms...`);
    setTimeout(setupSSE, delay);
  };
}

// Event Listeners
function setupEventListeners() {
  addTaskBtn.addEventListener('click', () => openModal());
  closeBtn.addEventListener('click', closeModal);
  taskModal.addEventListener('click', (e) => {
    if (e.target === taskModal) closeModal();
  });
  taskForm.addEventListener('submit', handleTaskSubmit);
  deleteBtn.addEventListener('click', handleDelete);
  commentForm.addEventListener('submit', handleCommentSubmit);

  // Comment attachments UI
  const attachBtn = document.getElementById('comment-attach-btn');
  const fileInput = document.getElementById('comment-files');
  const contentEl = document.getElementById('comment-content');

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      addPendingFiles(files);
      fileInput.value = ''; // allow re-selecting the same file
    });
  }

  if (contentEl) {
    contentEl.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const files = items
        .filter(it => it.kind === 'file')
        .map(it => it.getAsFile())
        .filter(Boolean);
      if (files.length) {
        addPendingFiles(files);
        // prevent pasting large base64 text blobs in some browsers
        e.preventDefault();
      }
    });
  }

  // Image modal
  const modal = document.getElementById('image-modal');
  const close = document.getElementById('image-modal-close');
  const backdrop = modal?.querySelector('.image-modal-backdrop');
  if (close) close.addEventListener('click', closeImageModal);
  if (backdrop) backdrop.addEventListener('click', closeImageModal);
}

// API Functions
async function loadTasks() {
  try {
    const res = await fetch(`${API_URL}/tasks`);
    tasks = await res.json();
    renderTasks();
    return tasks;
  } catch (err) {
    console.error('Failed to load tasks:', err);
    return tasks;
  }
}

async function createTask(data) {
  // Frontend actions are always by Jin
  const res = await fetch(`${API_URL}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, actor: 'Jin' })
  });
  return res.json();
}

async function updateTask(id, data) {
  // Frontend actions are always by Jin (Felix uses the API directly)
  const res = await fetch(`${API_URL}/tasks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, actor: 'Jin' })
  });
  return res.json();
}

async function deleteTask(id) {
  await fetch(`${API_URL}/tasks/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor: 'Jin' })
  });
}

async function getTaskWithComments(id) {
  const res = await fetch(`${API_URL}/tasks/${id}`);
  return res.json();
}

async function getTaskByHexId(hexId) {
  const hex = String(hexId || '').trim().toUpperCase();
  if (!hex) return null;
  const res = await fetch(`${API_URL}/tasks/hex/${encodeURIComponent(hex)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET /api/tasks/hex/${hex} failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function addComment(taskId, { author, content, files = [] }) {
  const form = new FormData();
  form.append('author', author);
  form.append('content', content || '');
  for (const f of files) {
    form.append('images', f);
  }

  const res = await fetch(`${API_URL}/tasks/${taskId}/comments`, {
    method: 'POST',
    body: form
  });
  return res.json();
}

// Goals API
async function getGoals() {
  const res = await fetch(`${API_URL}/goals`, {
    cache: 'no-store'
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET /api/goals failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function updateGoals(content) {
  const res = await fetch(`${API_URL}/goals`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, actor: 'Jin' })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PUT /api/goals failed: ${res.status} ${body}`);
  }
  return res.json();
}

// Render Functions
function renderTasks() {
  // Clear all columns
  document.querySelectorAll('.task-list').forEach(list => list.innerHTML = '');

  // Group tasks by status
  const columns = {
    'backlog': document.querySelector('[data-status="backlog"] .task-list'),
    'in-progress': document.querySelector('[data-status="in-progress"] .task-list'),
    'review': document.querySelector('[data-status="review"] .task-list'),
    'done': document.querySelector('[data-status="done"] .task-list')
  };

  tasks.forEach(task => {
    const card = createTaskCard(task);
    const column = columns[task.status];
    if (column) {
      column.appendChild(card);
    }
  });
}

function createTaskCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.draggable = true;
  card.dataset.id = task.id;

  const avatarClass = task.assignee.toLowerCase();
  const initials = task.assignee === 'Jin' ? 'J' : 'F';

  const hexLabel = task.hex_id ? `<span class="hex-id">#${escapeHtml(task.hex_id)}</span>` : '';

  card.innerHTML = `
    <div class="title">${hexLabel}${escapeHtml(task.title)}</div>
    <div class="meta">
      <span class="assignee">
        <span class="avatar ${avatarClass}">${initials}</span>
        ${task.assignee}
      </span>
      <span class="priority ${task.priority}">${task.priority}</span>
    </div>
  `;

  card.addEventListener('click', () => openModal(task.id));
  return card;
}

function renderComments(comments) {
  commentsList.innerHTML = (comments || []).map(c => {
    const attachments = Array.isArray(c.attachments) ? c.attachments : [];
    const imgs = attachments.filter(a => a && a.type === 'image' && a.url);

    const imagesHtml = imgs.length
      ? `<div class="comment-images">${imgs.map(a => {
          const url = escapeHtml(a.url);
          return `<img src="${url}" data-full="${url}" alt="" />`;
        }).join('')}</div>`
      : '';

    return `
      <div class="comment">
        <div class="comment-header">
          <span class="author">${escapeHtml(c.author)}</span>
          <span class="time">${formatTime(c.created_at)}</span>
        </div>
        <div class="content">${escapeHtml(c.content || '')}</div>
        ${imagesHtml}
      </div>
    `;
  }).join('');

  // bind modal clicks
  commentsList.querySelectorAll('.comment-images img').forEach(img => {
    img.addEventListener('click', () => openImageModal(img.dataset.full || img.src));
  });
}

function openImageModal(url) {
  const modal = document.getElementById('image-modal');
  const img = document.getElementById('image-modal-img');
  if (!modal || !img) return;
  img.src = url;
  modal.classList.remove('hidden');
}

function closeImageModal() {
  const modal = document.getElementById('image-modal');
  const img = document.getElementById('image-modal-img');
  if (!modal || !img) return;
  img.src = '';
  modal.classList.add('hidden');
}

function renderPendingFiles() {
  const container = document.getElementById('comment-attachments');
  if (!container) return;
  container.innerHTML = pendingCommentFiles.map((x, idx) => {
    const url = escapeHtml(x.previewUrl);
    return `
      <div class="attachment-thumb" data-idx="${idx}">
        <img src="${url}" alt="" />
        <button type="button" class="attachment-remove" title="Remove">×</button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.attachment-thumb').forEach(el => {
    const idx = parseInt(el.dataset.idx, 10);
    const btn = el.querySelector('.attachment-remove');
    if (btn) {
      btn.addEventListener('click', () => {
        removePendingFile(idx);
      });
    }
  });
}

function addPendingFiles(files) {
  const allowed = ['image/png', 'image/jpeg', 'image/webp'];
  for (const f of files) {
    if (!f) continue;
    if (!allowed.includes(f.type)) {
      alert(`Unsupported image type: ${f.type || '(unknown)'}`);
      continue;
    }
    if (f.size > 5 * 1024 * 1024) {
      alert(`Image too large (max 5MB): ${f.name || 'clipboard image'}`);
      continue;
    }
    const previewUrl = URL.createObjectURL(f);
    pendingCommentFiles.push({ file: f, previewUrl });
  }
  renderPendingFiles();
}

function removePendingFile(idx) {
  const item = pendingCommentFiles[idx];
  if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  pendingCommentFiles.splice(idx, 1);
  renderPendingFiles();
}

function clearPendingFiles() {
  for (const x of pendingCommentFiles) {
    if (x.previewUrl) URL.revokeObjectURL(x.previewUrl);
  }
  pendingCommentFiles = [];
  renderPendingFiles();
}

// Modal Functions
async function openModal(taskId = null) {
  currentTaskId = taskId;
  taskForm.reset();
  clearPendingFiles();

  if (taskId) {
    // Edit mode
    deleteBtn.classList.remove('hidden');
    commentsSection.classList.remove('hidden');

    const task = await getTaskWithComments(taskId);
    modalTitle.textContent = task.hex_id ? `Edit Task #${task.hex_id}` : 'Edit Task';
    document.getElementById('task-id').value = task.id;
    document.getElementById('title').value = task.title;
    document.getElementById('description').value = task.description;
    document.getElementById('assignee').value = task.assignee;
    document.getElementById('priority').value = task.priority;
    document.getElementById('status').value = task.status;
    renderComments(task.comments || []);

    // Checklist (text)
    if (checklistField) {
      checklistField.value = task.checklist_text || '';
    }
  } else {
    // Create mode
    modalTitle.textContent = 'New Task';
    deleteBtn.classList.add('hidden');
    commentsSection.classList.add('hidden');

    if (checklistField) {
      checklistField.value = '';
    }
  }

  taskModal.classList.remove('hidden');
}

function closeModal() {
  taskModal.classList.add('hidden');
  currentTaskId = null;
}

// Form Handlers
async function handleTaskSubmit(e) {
  e.preventDefault();

  const data = {
    title: document.getElementById('title').value,
    description: document.getElementById('description').value,
    checklist_text: checklistField ? checklistField.value : '',
    assignee: document.getElementById('assignee').value,
    priority: document.getElementById('priority').value,
    status: document.getElementById('status').value
  };

  try {
    if (currentTaskId) {
      await updateTask(currentTaskId, data);
    } else {
      await createTask(data);
    }
    closeModal();
    loadTasks();
  } catch (err) {
    console.error('Failed to save task:', err);
  }
}

async function handleDelete() {
  if (!currentTaskId) return;
  if (!confirm('Delete this task?')) return;

  try {
    await deleteTask(currentTaskId);
    closeModal();
    loadTasks();
  } catch (err) {
    console.error('Failed to delete task:', err);
  }
}

async function handleCommentSubmit(e) {
  e.preventDefault();
  if (!currentTaskId) return;

  const author = document.getElementById('comment-author').value;
  const contentEl = document.getElementById('comment-content');
  const content = contentEl ? contentEl.value : '';

  try {
    const files = pendingCommentFiles.map(x => x.file);
    const resp = await addComment(currentTaskId, { author, content, files });
    if (resp?.error) {
      alert(`Failed to add comment: ${resp.error}`);
      return;
    }

    if (contentEl) contentEl.value = '';
    clearPendingFiles();

    const task = await getTaskWithComments(currentTaskId);
    renderComments(task.comments || []);
  } catch (err) {
    console.error('Failed to add comment:', err);
    alert('Failed to add comment. See console for details.');
  }
}

// Drag and Drop
function setupDragAndDrop() {
  board.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('task-card')) {
      e.target.classList.add('dragging');
      e.dataTransfer.setData('text/plain', e.target.dataset.id);
    }
  });

  board.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('task-card')) {
      e.target.classList.remove('dragging');
    }
  });

  document.querySelectorAll('.column').forEach(column => {
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      column.classList.add('drag-over');
    });

    column.addEventListener('dragleave', () => {
      column.classList.remove('drag-over');
    });

    column.addEventListener('drop', async (e) => {
      e.preventDefault();
      column.classList.remove('drag-over');

      const taskId = e.dataTransfer.getData('text/plain');
      const newStatus = column.dataset.status;

      try {
        await updateTask(taskId, { status: newStatus });
        loadTasks();
      } catch (err) {
        console.error('Failed to update task status:', err);
      }
    });
  });
}

// Navigation + Views
function setActiveView(viewName) {
  // Cancel strategy edit mode when navigating away
  if (viewName !== 'strategy') {
    window.dispatchEvent(new CustomEvent('strategy-cancel-edit'));
  }

  // Hide all views first
  if (boardView) boardView.classList.remove('active');
  if (goalsView) goalsView.classList.remove('active');
  if (strategyView) strategyView.classList.remove('active');
  if (activityView) activityView.classList.remove('active');
  if (mindmapsView) mindmapsView.classList.remove('active');

  // Show selected view
  if (viewName === 'board' && boardView) boardView.classList.add('active');
  if (viewName === 'goals' && goalsView) goalsView.classList.add('active');
  if (viewName === 'strategy' && strategyView) strategyView.classList.add('active');
  if (viewName === 'activity' && activityView) activityView.classList.add('active');
  if (viewName === 'mindmaps' && mindmapsView) mindmapsView.classList.add('active');

  navLinks.forEach(link => {
    link.classList.toggle('active', link.dataset.view === viewName);
  });

  // Show/hide add task button based on view
  if (addTaskBtn) {
    addTaskBtn.classList.toggle('hidden', viewName === 'mindmaps');
  }

  // Lazily load data when entering views
  if (viewName === 'goals' && !goalsLoaded && !goalsLoading) {
    loadGoals();
  }
  if (viewName === 'strategy') {
    // Notify the strategy map module to load
    window.dispatchEvent(new CustomEvent('strategy-view-activated'));
  }
  if (viewName === 'activity' && !activityLoaded) {
    loadActivity();
  }
  if (viewName === 'mindmaps') {
    window.dispatchEvent(new CustomEvent('mindmaps-view-activated'));
  }
}

function setupNavigation() {
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = link.dataset.view;
      if (!view) return;
      setActiveView(view);
      window.location.hash = view;
    });
  });

  // initial view
  const hash = (window.location.hash || '#board').replace('#', '');
  const validViews = ['board', 'goals', 'strategy', 'activity', 'mindmaps'];
  setActiveView(validViews.includes(hash) ? hash : 'board');
}

function syncGoalsInteractivity() {
  const busy = goalsLoading || goalsSaveInFlight;
  if (editGoalsBtn) editGoalsBtn.disabled = busy || !goalsLoaded;
  if (saveGoalsBtn) saveGoalsBtn.disabled = busy;
  if (cancelGoalsBtn) cancelGoalsBtn.disabled = busy;
}

function setGoalsEditMode(editing) {
  goalsIsEditing = !!editing;
  if (!goalsEditor || !goalsDisplay || !editGoalsBtn || !saveGoalsBtn || !cancelGoalsBtn) return;

  goalsEditor.classList.toggle('hidden', !editing);
  goalsDisplay.classList.toggle('hidden', editing);

  editGoalsBtn.classList.toggle('hidden', editing);
  saveGoalsBtn.classList.toggle('hidden', !editing);
  cancelGoalsBtn.classList.toggle('hidden', !editing);

  if (goalsError) goalsError.classList.add('hidden');
  syncGoalsInteractivity();
}

function renderGoalsDisplay(content) {
  if (!goalsDisplay) return;
  // Simple display: preformatted text; no external markdown lib
  goalsDisplay.innerHTML = `<pre class="goals-pre">${escapeHtml(content || '')}</pre>`;
}

function renderGoalsMeta(updatedAt) {
  if (!goalsUpdated) return;
  if (!updatedAt) {
    goalsUpdated.textContent = '';
    return;
  }
  goalsUpdated.textContent = `Last updated: ${formatTime(updatedAt)}`;
}

async function loadGoals() {
  const seq = ++goalsLoadSeq;
  goalsLoading = true;
  syncGoalsInteractivity();

  try {
    const data = await getGoals();
    // Ignore out-of-order results
    if (seq !== goalsLoadSeq) return;

    goalsContent = (typeof data.content === 'string') ? data.content : '';
    goalsUpdatedAt = data.updated_at || null;
    goalsLoaded = true;

    // Never clobber the editor while the user is typing
    if (!goalsIsEditing) {
      if (goalsEditor) goalsEditor.value = goalsContent;
      renderGoalsDisplay(goalsContent);
      renderGoalsMeta(goalsUpdatedAt);
      setGoalsEditMode(false);
    } else {
      renderGoalsMeta(goalsUpdatedAt);
    }
  } catch (err) {
    console.error('Failed to load goals:', err);
    if (goalsError) {
      goalsError.textContent = 'Failed to load goals.';
      goalsError.classList.remove('hidden');
    }
  } finally {
    // Only the latest request clears the loading flag
    if (seq === goalsLoadSeq) {
      goalsLoading = false;
    }
    syncGoalsInteractivity();
  }
}

async function saveGoals() {
  if (!goalsEditor) return;
  if (goalsSaveInFlight) return;

  goalsSaveInFlight = true;
  // Invalidate any in-flight GET that might overwrite the saved state
  goalsLoadSeq++;
  syncGoalsInteractivity();

  const newContent = goalsEditor.value;

  try {
    const data = await updateGoals(newContent);
    goalsContent = (typeof data.content === 'string') ? data.content : '';
    goalsUpdatedAt = data.updated_at || null;
    goalsLoaded = true;

    if (goalsEditor) goalsEditor.value = goalsContent;
    renderGoalsDisplay(goalsContent);
    renderGoalsMeta(goalsUpdatedAt);
    setGoalsEditMode(false);
  } catch (err) {
    console.error('Failed to save goals:', err);
    if (goalsError) {
      goalsError.textContent = 'Failed to save goals.';
      goalsError.classList.remove('hidden');
    }
  } finally {
    goalsSaveInFlight = false;
    syncGoalsInteractivity();
  }
}

function setupGoals() {
  if (!editGoalsBtn || !saveGoalsBtn || !cancelGoalsBtn) return;

  syncGoalsInteractivity();

  editGoalsBtn.addEventListener('click', async () => {
    // Avoid entering edit mode with stale/empty state while a load is in flight
    if (!goalsLoaded && !goalsLoading) {
      await loadGoals();
    }
    if (!goalsLoaded) return;

    if (goalsEditor) goalsEditor.value = goalsContent;
    setGoalsEditMode(true);
  });

  cancelGoalsBtn.addEventListener('click', () => {
    if (goalsEditor) goalsEditor.value = goalsContent;
    setGoalsEditMode(false);
  });

  saveGoalsBtn.addEventListener('click', async () => {
    await saveGoals();
  });
}

// Strategy Map → Kanban task lookup helpers (Phase 1: click a node to open a task modal)
function extractHexIdFromText(text) {
  const s = String(text || '');
  // Prefer explicit "#0016" style.
  const hash = s.match(/#([0-9a-fA-F]{4})(?![0-9a-fA-F])/);
  if (hash?.[1]) return hash[1].toUpperCase();

  // Also allow plain "0016" (guarded to reduce false positives like "2026").
  const plain = s.match(/(?:^|[^0-9a-fA-F])([0-9a-fA-F]{4})(?![0-9a-fA-F])/);
  if (plain?.[1] && plain[1][0] === '0') return plain[1].toUpperCase();

  return null;
}

function normalizeTextForTaskMatch(text) {
  let s = String(text || '').trim();
  // Strip common list markers / bullets.
  s = s.replace(/^[\-*•]\s+/, '');
  // Strip a leading "#0016 " or "0016: " label if present.
  s = s.replace(/^#?[0-9a-fA-F]{4}(?![0-9a-fA-F])\s*[-–:：]?\s*/, '');
  // Collapse whitespace for more stable comparisons.
  s = s.replace(/\s+/g, ' ').trim();
  return s.toLowerCase();
}

function pickBestContainsMatch(queryNorm, taskList) {
  const scored = [];
  for (const t of taskList) {
    const titleNorm = normalizeTextForTaskMatch(t?.title || '');
    if (!titleNorm) continue;

    let score = Infinity;
    if (titleNorm.includes(queryNorm)) {
      // Prefer tighter matches (closest length).
      score = Math.abs(titleNorm.length - queryNorm.length);
    } else if (queryNorm.includes(titleNorm)) {
      // Query contains the full title (still a good match; slightly worse than the above).
      score = 50 + Math.abs(queryNorm.length - titleNorm.length);
    }

    if (Number.isFinite(score)) scored.push({ t, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored[0]?.t || null;
}

async function openTaskFromStrategyNodeText(nodeText) {
  const raw = String(nodeText || '').trim();
  if (!raw) return false;

  // (a) Hex id match
  const hex = extractHexIdFromText(raw);
  if (hex) {
    try {
      const byHex = await getTaskByHexId(hex);
      if (byHex?.id != null) {
        await openModal(byHex.id);
        return true;
      }
    } catch (err) {
      console.error('StrategyMap click: failed hex lookup', { hex, raw, err });
    }
  }

  // Ensure we have a tasks list for title matching.
  if (!Array.isArray(tasks) || tasks.length === 0) {
    await loadTasks();
  }

  const list = Array.isArray(tasks) ? tasks : [];
  const queryNorm = normalizeTextForTaskMatch(raw);
  if (!queryNorm) {
    console.warn('StrategyMap click: no usable title text after normalization', { raw, hex });
    alert(`No matching Kanban task found for:\n${raw}`);
    return false;
  }

  // (b) Exact title match
  const exact = list.find(t => normalizeTextForTaskMatch(t?.title || '') === queryNorm);
  if (exact?.id != null) {
    await openModal(exact.id);
    return true;
  }

  // (c) Contains match with a simple "closest length" heuristic
  const best = pickBestContainsMatch(queryNorm, list);
  if (best?.id != null) {
    await openModal(best.id);
    return true;
  }

  // No match
  console.warn('StrategyMap click: no matching task found', { raw, hex, queryNorm, taskCount: list.length });
  alert(`No matching Kanban task found for:\n${raw}`);
  return false;
}

// Expose functions for other modules (strategy-map.js)
window.kanban = {
  openModal,
  setActiveView,
  getTasks: () => tasks,
  openTaskFromStrategyNodeText
};

// Utilities
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Activity Functions
async function loadActivity() {
  if (!activityList) return;
  
  const actor = activityActorFilter?.value || '';
  const limit = activityLimitFilter?.value || 50;
  
  try {
    let url = `${API_URL}/activity?limit=${limit}`;
    if (actor) url += `&actor=${encodeURIComponent(actor)}`;
    
    const res = await fetch(url);
    activityData = await res.json();
    activityLoaded = true;
    renderActivity(activityData);
  } catch (err) {
    console.error('Failed to load activity:', err);
    activityList.innerHTML = '<div class="activity-empty">Failed to load activity log</div>';
  }
}

function renderActivity(activities) {
  if (!activityList) return;
  
  if (!activities || activities.length === 0) {
    activityList.innerHTML = '<div class="activity-empty">No activity yet</div>';
    return;
  }
  
  activityList.innerHTML = activities.map(a => {
    const actorClass = a.actor?.toLowerCase() || '';
    const time = formatActivityTime(a.timestamp, usePreciseTime);
    
    return `
      <div class="activity-item">
        <span class="activity-time">${escapeHtml(time)}</span>
        <div class="activity-content">
          <div class="activity-summary">
            <span class="activity-actor ${actorClass}">${escapeHtml(a.actor)}</span>
            ${escapeHtml(a.action)}
            ${a.task_title ? `<span class="activity-task-title">"${escapeHtml(a.task_title)}"</span>` : ''}
          </div>
          ${a.details ? `<div class="activity-details">${escapeHtml(a.details)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function formatActivityTime(timestamp, precise = false) {
  if (!timestamp) return '';
  const date = new Date(timestamp.includes('T') ? timestamp : timestamp.replace(' ', 'T') + 'Z');
  
  if (precise) {
    // 精确时间: 2026-02-02 15:30:45
    return date.toLocaleString('sv-SE', {
      year: 'numeric',
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).replace('T', ' ');
  }
  
  // 相对时间
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function setupActivity() {
  if (refreshActivityBtn) {
    refreshActivityBtn.addEventListener('click', loadActivity);
  }
  if (activityActorFilter) {
    activityActorFilter.addEventListener('change', loadActivity);
  }
  if (activityLimitFilter) {
    activityLimitFilter.addEventListener('change', loadActivity);
  }
  
  const preciseTimeToggle = document.getElementById('activity-precise-time');
  if (preciseTimeToggle) {
    preciseTimeToggle.addEventListener('change', (e) => {
      usePreciseTime = e.target.checked;
      if (activityData.length > 0) {
        renderActivity(activityData);
      }
    });
  }
}
