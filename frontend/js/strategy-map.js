// Strategy Map Module — Markmap-based rendering of Goals markdown
// Replaces the old Mermaid.js implementation
(function() {
'use strict';

const STRATEGY_API = '/api';

// State
let strategyLoaded = false;
let goalsContent = '';
let goalsUpdatedAt = null;
let isEditing = false;
let markmapInstance = null;
let previewMarkmapInstance = null;

// DOM helpers
function el(id) { return document.getElementById(id); }

// API — reads from /api/strategy-map (separate from goals)
async function getGoals() {
  const res = await fetch(`${STRATEGY_API}/strategy-map`);
  return res.json();
}

async function updateGoals(content) {
  const res = await fetch(`${STRATEGY_API}/strategy-map`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, actor: 'Jin' })
  });
  return res.json();
}

// Render markmap into an SVG element
function renderMarkmap(svgSelector, markdownText, existingInstance) {
  const svgEl = typeof svgSelector === 'string'
    ? document.querySelector(svgSelector)
    : svgSelector;
  if (!svgEl) return null;

  if (!markdownText || !markdownText.trim()) {
    svgEl.innerHTML = '';
    const parent = svgEl.parentElement;
    if (parent && !parent.querySelector('.strategy-empty')) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'strategy-empty';
      emptyMsg.textContent = 'No goals content yet. Click Edit to add goals markdown.';
      parent.appendChild(emptyMsg);
    }
    return null;
  }

  // Remove any empty message
  const parent = svgEl.parentElement;
  const emptyMsg = parent?.querySelector('.strategy-empty');
  if (emptyMsg) emptyMsg.remove();

  try {
    const { Transformer } = markmap;
    const { Markmap } = markmap;
    const transformer = new Transformer();
    const { root } = transformer.transform(markdownText);

    if (existingInstance) {
      existingInstance.setData(root);
      existingInstance.fit();
      return existingInstance;
    } else {
      // Clear previous SVG contents
      svgEl.innerHTML = '';
      // High-contrast color palette (avoid pale yellows/grays on white bg)
      const hcColors = [
        '#2563eb', // blue
        '#dc2626', // red
        '#059669', // emerald
        '#7c3aed', // violet
        '#d97706', // amber
        '#0891b2', // cyan
        '#be185d', // pink
        '#4f46e5', // indigo
      ];
      const mm = Markmap.create(svgEl, {
        colorFreezeLevel: 2,
        duration: 300,
        maxWidth: 300,
        initialExpandLevel: 3,
        color: (node) => {
          // colorFreezeLevel=2: color by the node at depth 2 in the path
          // state.path is like "1.2.3.4" — use segment at index [colorFreezeLevel] or last available
          const path = node.state?.path || '';
          const parts = path.split('.');
          const freezeIdx = Math.min(2, parts.length - 1);
          const colorKey = parseInt(parts[freezeIdx], 10) || 0;
          return hcColors[colorKey % hcColors.length];
        },
      }, root);
      return mm;
    }
  } catch (err) {
    console.error('Markmap render error:', err);
    svgEl.innerHTML = '';
    const parent = svgEl.parentElement;
    if (parent) {
      const errDiv = document.createElement('div');
      errDiv.className = 'strategy-render-error';
      errDiv.textContent = 'Render Error: ' + (err.message || String(err));
      parent.appendChild(errDiv);
    }
    return null;
  }
}

// Load goals data and render
async function loadStrategy() {
  try {
    const data = await getGoals();
    goalsContent = data.content || '';
    goalsUpdatedAt = data.updated_at || null;
    strategyLoaded = true;

    markmapInstance = renderMarkmap('#markmap-svg', goalsContent, null);
    setupHoverShortcuts();
    renderMeta();
    setEditMode(false);
  } catch (err) {
    console.error('Failed to load goals:', err);
    const errEl = el('strategy-error');
    if (errEl) {
      errEl.textContent = 'Failed to load goals for strategy map.';
      errEl.classList.remove('hidden');
    }
  }
}

function renderMeta() {
  const metaEl = el('strategy-updated');
  if (!metaEl) return;
  if (!goalsUpdatedAt) {
    metaEl.textContent = '';
    return;
  }
  const date = new Date(goalsUpdatedAt);
  metaEl.textContent = `Last updated: ${date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })}`;
}

function setEditMode(editing) {
  isEditing = editing;
  const displayMode = el('strategy-display-mode');
  const editMode = el('strategy-edit-mode');
  const editBtn = el('edit-strategy-btn');
  const saveBtn = el('save-strategy-btn');
  const cancelBtn = el('cancel-strategy-btn');
  const fitBtn = el('fit-strategy-btn');

  if (displayMode) displayMode.classList.toggle('hidden', editing);
  if (editMode) editMode.classList.toggle('hidden', !editing);
  if (editBtn) editBtn.classList.toggle('hidden', editing);
  if (saveBtn) saveBtn.classList.toggle('hidden', !editing);
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !editing);
  if (fitBtn) fitBtn.classList.toggle('hidden', editing);

  const errEl = el('strategy-error');
  if (errEl) errEl.classList.add('hidden');

  if (editing) {
    const editor = el('strategy-editor');
    if (editor) editor.value = goalsContent;
    // Destroy preview instance if any
    previewMarkmapInstance = null;
    const previewSvg = el('markmap-preview-svg');
    if (previewSvg) previewSvg.innerHTML = '';
    debouncePreview();
  }
}

// Debounced preview
let previewTimer = null;
function debouncePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const editor = el('strategy-editor');
    if (editor) {
      previewMarkmapInstance = renderMarkmap('#markmap-preview-svg', editor.value, null);
    }
  }, 600);
}

async function saveStrategy() {
  const editor = el('strategy-editor');
  if (!editor) return;
  const newContent = editor.value;

  try {
    const data = await updateGoals(newContent);
    goalsContent = data.content || '';
    goalsUpdatedAt = data.updated_at || null;
    strategyLoaded = true;

    markmapInstance = renderMarkmap('#markmap-svg', goalsContent, null);
    setupHoverShortcuts();
    renderMeta();
    setEditMode(false);
  } catch (err) {
    console.error('Failed to save goals:', err);
    const errEl = el('strategy-error');
    if (errEl) {
      errEl.textContent = 'Failed to save goals.';
      errEl.classList.remove('hidden');
    }
  }
}

// Ctrl+hover expand / Shift+hover collapse
let hoverShortcutsInstalled = false;
function setupHoverShortcuts() {
  const svgEl = document.getElementById('markmap-svg');
  if (!svgEl || hoverShortcutsInstalled) return;
  hoverShortcutsInstalled = true;

  // Helper: find the markmap data node attached to a DOM element
  function getNodeData(target) {
    // Walk up to find the .markmap-node <g> element
    let g = target.closest('g.markmap-node');
    if (!g) return null;
    // d3 binds data via __data__
    return g.__data__ || null;
  }

  // Helper: recursively set fold on a node and all descendants
  function setFoldRecursive(node, fold) {
    if (!node) return;
    if (!node.payload) node.payload = {};
    node.payload.fold = fold;
    if (node.children) {
      node.children.forEach(child => setFoldRecursive(child, fold));
    }
  }

  svgEl.addEventListener('mouseover', (event) => {
    if (!markmapInstance) return;
    if (!event.ctrlKey && !event.shiftKey) return;

    const nodeData = getNodeData(event.target);
    if (!nodeData) return;

    if (event.ctrlKey) {
      // Expand this node and all children
      setFoldRecursive(nodeData, 0);
      markmapInstance.renderData();
    } else if (event.shiftKey) {
      // Collapse this node (fold its children)
      if (!nodeData.payload) nodeData.payload = {};
      nodeData.payload.fold = 1;
      markmapInstance.renderData();
    }
  });
}

// Event listeners
function setup() {
  const editBtn = el('edit-strategy-btn');
  const saveBtn = el('save-strategy-btn');
  const cancelBtn = el('cancel-strategy-btn');
  const fitBtn = el('fit-strategy-btn');

  if (editBtn) editBtn.addEventListener('click', () => setEditMode(true));
  if (cancelBtn) cancelBtn.addEventListener('click', () => setEditMode(false));
  if (saveBtn) saveBtn.addEventListener('click', () => saveStrategy());
  if (fitBtn) fitBtn.addEventListener('click', () => {
    if (markmapInstance) markmapInstance.fit();
  });

  // Live preview on edit
  const editor = el('strategy-editor');
  if (editor) {
    editor.addEventListener('input', debouncePreview);
  }

  // Listen for view activation
  window.addEventListener('strategy-view-activated', () => {
    if (!strategyLoaded) {
      loadStrategy();
    }
  });

  // Cancel edit mode when navigating away from Strategy view
  window.addEventListener('strategy-cancel-edit', () => {
    if (isEditing) {
      setEditMode(false);
    }
  });

  // If strategy view is already active (e.g. loaded with #strategy hash), load now
  const strategyView = document.getElementById('strategy-view');
  if (strategyView && strategyView.classList.contains('active') && !strategyLoaded) {
    loadStrategy();
  }

  // Fallback: check again after a short delay (race condition with app.js DOMContentLoaded)
  setTimeout(() => {
    const sv = document.getElementById('strategy-view');
    if (sv && sv.classList.contains('active') && !strategyLoaded) {
      loadStrategy();
    }
  }, 200);

  // Listen for SSE goals changes
  window.addEventListener('goals-data-changed', () => {
    if (!isEditing) {
      loadStrategy();
    } else {
      strategyLoaded = false;
    }
  });

  // Also listen for strategy-data-changed (backward compat)
  window.addEventListener('strategy-data-changed', () => {
    if (!isEditing) {
      loadStrategy();
    } else {
      strategyLoaded = false;
    }
  });
}

// Init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}

})(); // end IIFE
