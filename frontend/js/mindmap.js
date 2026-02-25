// Mindmap Editor Module
// Uses a custom canvas-based mindmap implementation (no external lib dependency)
(function () {
  'use strict';

  const API_URL = '/api/mindmaps';

  // State
  let mindmaps = [];
  let currentMindmap = null;
  let currentMindmapId = null;
  let selectedNodeId = null;
  let mindmapInstance = null;
  let saveTimeout = null;
  let initialized = false;
  let undoStack = [];
  let redoStack = [];
  let editingNodeId = null;
  let nodeCounter = 0;
  let clientId = 'frontend_' + Math.random().toString(36).slice(2, 10);
  let currentRevision = 0;
  let suppressNextSave = false;  // flag to avoid re-saving data we just loaded from backend
  let tagFilter = 'all'; // 'all' | 'knowledge' | 'execution'

  const TAG_CONFIG = {
    knowledge: { emoji: '📚', label: 'Knowledge' },
    execution: { emoji: '⚔️', label: 'Execution' }
  };

  // DOM refs
  const listEl = document.getElementById('mindmaps-list');
  const containerEl = document.getElementById('mindmap-container');
  const emptyEl = document.getElementById('mindmap-empty');
  const toolbarEl = document.getElementById('mindmap-toolbar');
  const titleDisplay = document.getElementById('mindmap-title-display');
  const rightPanel = document.getElementById('mindmap-right-panel');
  const nodeNoteEl = document.getElementById('mindmap-node-note');
  const thinkingNotesEl = document.getElementById('mindmap-thinking-notes');
  const newBtn = document.getElementById('new-mindmap-btn');
  const renameBtn = document.getElementById('rename-mindmap-btn');
  const deleteBtn = document.getElementById('delete-mindmap-btn');
  const tagBtn = document.getElementById('mindmap-tag-btn');

  // Canvas-based mindmap renderer
  class MindmapCanvas {
    constructor(container) {
      this.container = container;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'mindmap-canvas';
      this.canvas.tabIndex = 0;
      this.ctx = this.canvas.getContext('2d');
      this.container.appendChild(this.canvas);

      // State
      this.root = null;
      this.nodes = new Map(); // id -> node
      this.selectedId = null;
      this.panX = 0;
      this.panY = 0;
      this.scale = 1;
      this.dragging = false;
      this.dragStartX = 0;
      this.dragStartY = 0;
      this.panStartX = 0;
      this.panStartY = 0;

      // Layout constants
      this.nodeHeight = 36;
      this.nodePaddingX = 16;
      this.nodePaddingY = 8;
      this.levelGapX = 160;
      this.siblingGapY = 12;
      this.fontSize = 14;
      this.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

      // Color themes per depth
      this.colors = [
        { bg: '#4A90D9', text: '#fff', border: '#3572A5' },   // root
        { bg: '#5BA55B', text: '#fff', border: '#4A8A4A' },   // level 1
        { bg: '#E8943A', text: '#fff', border: '#C77E30' },   // level 2
        { bg: '#D95B5B', text: '#fff', border: '#B84A4A' },   // level 3
        { bg: '#8E6FBF', text: '#fff', border: '#7559A0' },   // level 4
        { bg: '#3AAFCF', text: '#fff', border: '#2E93AD' },   // level 5+
      ];

      this._setupEvents();
      this._resize();

      // Input element for editing
      this.inputEl = document.createElement('input');
      this.inputEl.className = 'mindmap-inline-input';
      this.inputEl.style.display = 'none';
      this.container.appendChild(this.inputEl);

      this.inputEl.addEventListener('blur', () => this._finishEdit());
      this.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this._finishEdit(); }
        if (e.key === 'Escape') { e.preventDefault(); this._cancelEdit(); }
      });
    }

    _setupEvents() {
      // Resize
      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(this.container);

      // Mouse events for pan and node selection
      this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
      this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
      this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
      this.canvas.addEventListener('wheel', (e) => this._onWheel(e));
      this.canvas.addEventListener('dblclick', (e) => this._onDblClick(e));

      // Keyboard events
      this.canvas.addEventListener('keydown', (e) => this._onKeyDown(e));
    }

    _resize() {
      const rect = this.container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.render();
    }

    setData(data) {
      this.nodes.clear();
      nodeCounter = 0;
      if (data && data.data) {
        this.root = this._buildTree(data.data, null, 0);
      } else {
        this.root = this._createNode('Central Topic', null, 0);
      }
      this.selectedId = null;
      this._centerOnRoot();
      this.render();
    }

    getData() {
      if (!this.root) return { data: { text: 'Central Topic', children: [] } };
      return { data: this._serializeNode(this.root) };
    }

    _buildTree(data, parent, depth) {
      const id = data.id || ('node_' + (nodeCounter++));
      const node = {
        id,
        text: data.text || 'Node',
        note: data.note || '',
        children: [],
        parent,
        depth,
        x: 0, y: 0, width: 0, height: 0,
        collapsed: false
      };
      this.nodes.set(id, node);
      if (data.children && data.children.length > 0) {
        node.children = data.children.map(c => this._buildTree(c, node, depth + 1));
      }
      // Update nodeCounter to be above all existing ids
      const numId = parseInt(id.replace('node_', ''), 10);
      if (!isNaN(numId) && numId >= nodeCounter) nodeCounter = numId + 1;
      return node;
    }

    _createNode(text, parent, depth) {
      const id = 'node_' + (nodeCounter++);
      const node = {
        id,
        text: text || 'Node',
        note: '',
        children: [],
        parent,
        depth,
        // Layout positions (computed)
        x: 0, y: 0, width: 0, height: 0,
        collapsed: false
      };
      this.nodes.set(id, node);
      return node;
    }

    _serializeNode(node) {
      const obj = { text: node.text, id: node.id };
      if (node.note) obj.note = node.note;
      if (node.children.length > 0) {
        obj.children = node.children.map(c => this._serializeNode(c));
      }
      return obj;
    }

    // ---- Layout ----
    _measureText(text) {
      this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
      return this.ctx.measureText(text).width;
    }

    _computeLayout() {
      if (!this.root) return;
      // Compute node sizes
      this._computeSizes(this.root);
      // Compute positions (right-expanding tree)
      this._computePositions(this.root, 60, 0);
    }

    _computeSizes(node) {
      const tw = this._measureText(node.text);
      node.width = tw + this.nodePaddingX * 2;
      node.height = this.nodeHeight;
      if (!node.collapsed) {
        node.children.forEach(c => this._computeSizes(c));
      }
    }

    _getSubtreeHeight(node) {
      if (node.collapsed || node.children.length === 0) return node.height;
      let total = 0;
      node.children.forEach((c, i) => {
        total += this._getSubtreeHeight(c);
        if (i < node.children.length - 1) total += this.siblingGapY;
      });
      return Math.max(total, node.height);
    }

    _computePositions(node, x, yCenter) {
      node.x = x;
      node.y = yCenter - node.height / 2;

      if (node.collapsed || node.children.length === 0) return;

      const childX = x + node.width + this.levelGapX;
      const totalH = this._getSubtreeHeight(node);
      let yStart = yCenter - totalH / 2;

      node.children.forEach((child, i) => {
        const subtreeH = this._getSubtreeHeight(child);
        const childYCenter = yStart + subtreeH / 2;
        this._computePositions(child, childX, childYCenter);
        yStart += subtreeH + this.siblingGapY;
      });
    }

    _centerOnRoot() {
      if (!this.root) return;
      this._computeLayout();
      const rect = this.container.getBoundingClientRect();
      this.scale = 1;
      this.panX = 80;
      this.panY = rect.height / 2;
    }

    // ---- Rendering ----
    render() {
      if (!this.ctx) return;
      this._computeLayout();

      const rect = this.container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      this.ctx.clearRect(0, 0, w, h);
      this.ctx.save();
      this.ctx.translate(this.panX, this.panY);
      this.ctx.scale(this.scale, this.scale);

      if (this.root) {
        this._drawConnections(this.root);
        this._drawNodes(this.root);
      }

      this.ctx.restore();
    }

    _getColor(depth) {
      return this.colors[Math.min(depth, this.colors.length - 1)];
    }

    _drawNodes(node) {
      const color = this._getColor(node.depth);
      const isSelected = node.id === this.selectedId;
      const isEditing = node.id === editingNodeId;
      const radius = 8;

      // Draw rounded rect
      this.ctx.fillStyle = color.bg;
      this.ctx.strokeStyle = isSelected ? '#FFD700' : color.border;
      this.ctx.lineWidth = isSelected ? 3 : 1.5;

      this._roundRect(node.x, node.y, node.width, node.height, radius);
      this.ctx.fill();
      this.ctx.stroke();

      // Note indicator
      if (node.note) {
        this.ctx.fillStyle = '#FFD700';
        this.ctx.beginPath();
        this.ctx.arc(node.x + node.width - 6, node.y + 6, 4, 0, Math.PI * 2);
        this.ctx.fill();
      }

      // Collapse indicator
      if (node.children.length > 0) {
        const cx = node.x + node.width + 8;
        const cy = node.y + node.height / 2;
        this.ctx.fillStyle = '#666';
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = '#fff';
        this.ctx.font = `bold 12px ${this.fontFamily}`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(node.collapsed ? '+' : node.children.length.toString(), cx, cy);
      }

      // Text (hide if editing inline)
      if (!isEditing) {
        this.ctx.fillStyle = color.text;
        this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(node.text, node.x + this.nodePaddingX, node.y + node.height / 2);
      }

      // Draw children
      if (!node.collapsed) {
        node.children.forEach(c => this._drawNodes(c));
      }
    }

    _drawConnections(node) {
      if (node.collapsed || node.children.length === 0) return;

      node.children.forEach(child => {
        const startX = node.x + node.width;
        const startY = node.y + node.height / 2;
        const endX = child.x;
        const endY = child.y + child.height / 2;

        const cpX = startX + (endX - startX) * 0.5;

        this.ctx.strokeStyle = '#aab';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.bezierCurveTo(cpX, startY, cpX, endY, endX, endY);
        this.ctx.stroke();

        this._drawConnections(child);
      });
    }

    _roundRect(x, y, w, h, r) {
      this.ctx.beginPath();
      this.ctx.moveTo(x + r, y);
      this.ctx.lineTo(x + w - r, y);
      this.ctx.arcTo(x + w, y, x + w, y + r, r);
      this.ctx.lineTo(x + w, y + h - r);
      this.ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      this.ctx.lineTo(x + r, y + h);
      this.ctx.arcTo(x, y + h, x, y + h - r, r);
      this.ctx.lineTo(x, y + r);
      this.ctx.arcTo(x, y, x + r, y, r);
      this.ctx.closePath();
    }

    // ---- Hit testing ----
    _hitTest(mx, my) {
      // Convert screen coords to canvas coords
      const x = (mx - this.panX) / this.scale;
      const y = (my - this.panY) / this.scale;

      // Check nodes
      for (const [id, node] of this.nodes) {
        if (x >= node.x && x <= node.x + node.width &&
            y >= node.y && y <= node.y + node.height) {
          return { type: 'node', node };
        }
        // Check collapse indicator
        if (node.children.length > 0) {
          const cx = node.x + node.width + 8;
          const cy = node.y + node.height / 2;
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
          if (dist <= 10) {
            return { type: 'collapse', node };
          }
        }
      }
      return null;
    }

    // ---- Mouse Events ----
    _getCanvasPos(e) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    _onMouseDown(e) {
      const pos = this._getCanvasPos(e);
      const hit = this._hitTest(pos.x, pos.y);

      if (hit && hit.type === 'collapse') {
        this._pushUndo();
        hit.node.collapsed = !hit.node.collapsed;
        this.render();
        this._notifyChange();
        return;
      }

      if (hit && hit.type === 'node') {
        this.selectNode(hit.node.id);
        this.canvas.focus();
        return;
      }

      // Start panning
      this.dragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.panStartX = this.panX;
      this.panStartY = this.panY;
      this.canvas.style.cursor = 'grabbing';
    }

    _onMouseMove(e) {
      if (this.dragging) {
        this.panX = this.panStartX + (e.clientX - this.dragStartX);
        this.panY = this.panStartY + (e.clientY - this.dragStartY);
        this.render();
      }
    }

    _onMouseUp(e) {
      this.dragging = false;
      this.canvas.style.cursor = 'default';
    }

    _onWheel(e) {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const pos = this._getCanvasPos(e);

      // Zoom towards cursor
      const worldX = (pos.x - this.panX) / this.scale;
      const worldY = (pos.y - this.panY) / this.scale;

      this.scale *= zoomFactor;
      this.scale = Math.max(0.2, Math.min(3, this.scale));

      this.panX = pos.x - worldX * this.scale;
      this.panY = pos.y - worldY * this.scale;

      this.render();
    }

    _onDblClick(e) {
      const pos = this._getCanvasPos(e);
      const hit = this._hitTest(pos.x, pos.y);
      if (hit && hit.type === 'node') {
        this._startEdit(hit.node.id);
      }
    }

    _navigateRight(node) {
      if (node && node.children.length > 0 && !node.collapsed) {
        this.selectNode(node.children[0].id);
      } else if (node && node.collapsed) {
        node.collapsed = false;
        this.render();
        this._notifyChange();
      }
    }

    _navigateLeft(node) {
      if (node && node.parent) {
        this.selectNode(node.parent.id);
      }
    }

    // Cross-branch j/k navigation: collect visible nodes at target depth (or deepest visible leaf for shallow branches)
    _getVisibleNodesAtDepthOrDeepest(targetDepth) {
      const result = [];
      const walk = (node) => {
        if (node.depth === targetDepth) {
          result.push(node);
          return; // don't go deeper
        } else if (node.depth < targetDepth && (node.collapsed || node.children.length === 0)) {
          // This branch doesn't reach targetDepth — take deepest visible leaf
          result.push(node);
          return;
        }
        // Continue deeper
        if (!node.collapsed) {
          node.children.forEach(walk);
        }
      };
      walk(this.root);
      return result; // already in DFS pre-order (visual top→bottom)
    }

    _navigateDown(node) {
      if (!node) return;
      const targetDepth = node.depth;
      const list = this._getVisibleNodesAtDepthOrDeepest(targetDepth);
      const idx = list.indexOf(node);
      if (idx === -1) {
        // Current node not in list (e.g. it's a shallow-branch substitute) — find by id
        const idxById = list.findIndex(n => n.id === node.id);
        if (idxById >= 0 && idxById < list.length - 1) {
          this.selectNode(list[idxById + 1].id);
        }
        return;
      }
      if (idx < list.length - 1) {
        this.selectNode(list[idx + 1].id);
      }
    }

    _navigateUp(node) {
      if (!node) return;
      const targetDepth = node.depth;
      const list = this._getVisibleNodesAtDepthOrDeepest(targetDepth);
      const idx = list.indexOf(node);
      if (idx === -1) {
        const idxById = list.findIndex(n => n.id === node.id);
        if (idxById > 0) {
          this.selectNode(list[idxById - 1].id);
        }
        return;
      }
      if (idx > 0) {
        this.selectNode(list[idx - 1].id);
      }
    }

    _onKeyDown(e) {
      if (editingNodeId) return; // let input handle keys

      // Help modal toggle: ? key
      if (e.key === '?') {
        e.preventDefault();
        toggleHelpModal();
        return;
      }

      // Zen mode toggle: Z key (shift+z)
      if (e.key === 'Z' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleZenMode();
        return;
      }

      const node = this.selectedId ? this.nodes.get(this.selectedId) : null;
      if (!node && !['z', 'r', 'u'].includes(e.key.toLowerCase())) return;

      switch (e.key) {
        case 'Tab': {
          e.preventDefault();
          if (node) this.addChild(node.id);
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (node) this.addSibling(node.id);
          break;
        }
        case 'Delete':
        case 'Backspace': {
          if (node && node.parent) {
            e.preventDefault();
            this.deleteNode(node.id);
          }
          break;
        }
        case 'F2':
        case 'i': {
          // F2 or i (vim insert) to edit node
          e.preventDefault();
          if (node) this._startEdit(node.id);
          break;
        }
        // Arrow keys
        case 'ArrowRight': {
          e.preventDefault();
          this._navigateRight(node);
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          this._navigateLeft(node);
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          this._navigateDown(node);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          this._navigateUp(node);
          break;
        }
        // Vim-style hjkl navigation
        case 'l': {
          e.preventDefault();
          this._navigateRight(node);
          break;
        }
        case 'h': {
          e.preventDefault();
          this._navigateLeft(node);
          break;
        }
        case 'j': {
          e.preventDefault();
          this._navigateDown(node);
          break;
        }
        case 'k': {
          e.preventDefault();
          this._navigateUp(node);
          break;
        }
        // Vim-style: o = add child (like "open" below), O = add sibling above
        case 'o': {
          e.preventDefault();
          if (node) this.addChild(node.id);
          break;
        }
        case 'O': {
          e.preventDefault();
          if (node) this.addSibling(node.id);
          break;
        }
        // x or d = delete (vim style)
        case 'x':
        case 'd': {
          if (!e.ctrlKey && !e.metaKey && node && node.parent) {
            e.preventDefault();
            this.deleteNode(node.id);
          }
          break;
        }
        case 'z':
        case 'Z': {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) {
              this.redo();
            } else {
              this.undo();
            }
          }
          break;
        }
        case 'u': {
          // vim-style undo
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.undo();
          }
          break;
        }
        case 'r': {
          // Ctrl+R = vim-style redo
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this.redo();
          }
          break;
        }
        case ' ': {
          // Toggle collapse (like za in vim)
          if (node && node.children.length > 0) {
            e.preventDefault();
            node.collapsed = !node.collapsed;
            this.render();
            this._notifyChange();
          }
          break;
        }
        case 'n': {
          // n = focus node notes
          e.preventDefault();
          if (zenMode) {
            toggleZenFloatingPanel('zen-float-note');
          } else {
            if (nodeNoteEl && !nodeNoteEl.disabled) nodeNoteEl.focus();
          }
          break;
        }
        case 'N': {
          // N = focus thinking notes
          e.preventDefault();
          if (zenMode) {
            toggleZenFloatingPanel('zen-float-thinking');
          } else {
            if (thinkingNotesEl) thinkingNotesEl.focus();
          }
          break;
        }
      }
    }

    // ---- Selection ----
    selectNode(id) {
      this.selectedId = id;
      selectedNodeId = id;
      this.render();
      this._notifySelect(id);
    }

    _notifySelect(id) {
      const node = id ? this.nodes.get(id) : null;
      window.dispatchEvent(new CustomEvent('mindmap-node-selected', { detail: { node } }));
    }

    // ---- Inline Edit ----
    _startEdit(id) {
      const node = this.nodes.get(id);
      if (!node) return;
      editingNodeId = id;
      this.selectNode(id);

      // Position input over node
      const screenX = node.x * this.scale + this.panX;
      const screenY = node.y * this.scale + this.panY;
      const screenW = node.width * this.scale;
      const screenH = node.height * this.scale;

      this.inputEl.style.display = 'block';
      this.inputEl.style.left = screenX + 'px';
      this.inputEl.style.top = screenY + 'px';
      this.inputEl.style.width = Math.max(screenW, 100) + 'px';
      this.inputEl.style.height = screenH + 'px';
      this.inputEl.style.fontSize = (this.fontSize * this.scale) + 'px';
      this.inputEl.value = node.text;
      this.inputEl.focus();
      this.inputEl.select();
      this.render();
    }

    _finishEdit() {
      if (!editingNodeId) return;
      const node = this.nodes.get(editingNodeId);
      if (node && this.inputEl.value.trim()) {
        this._pushUndo();
        node.text = this.inputEl.value.trim();
      }
      editingNodeId = null;
      this.inputEl.style.display = 'none';
      this.canvas.focus();
      this.render();
      this._notifyChange();
    }

    _cancelEdit() {
      editingNodeId = null;
      this.inputEl.style.display = 'none';
      this.canvas.focus();
      this.render();
    }

    // ---- Node Operations ----
    addChild(parentId) {
      const parent = this.nodes.get(parentId);
      if (!parent) return;
      this._pushUndo();
      parent.collapsed = false;
      const child = this._createNode('New node', parent, parent.depth + 1);
      parent.children.push(child);
      this.selectNode(child.id);
      this.render();
      this._startEdit(child.id);
      this._notifyChange();
    }

    addSibling(nodeId) {
      const node = this.nodes.get(nodeId);
      if (!node || !node.parent) return; // can't add sibling to root
      this._pushUndo();
      const parent = node.parent;
      const idx = parent.children.indexOf(node);
      const sibling = this._createNode('New node', parent, node.depth);
      parent.children.splice(idx + 1, 0, sibling);
      this.selectNode(sibling.id);
      this.render();
      this._startEdit(sibling.id);
      this._notifyChange();
    }

    deleteNode(nodeId) {
      const node = this.nodes.get(nodeId);
      if (!node || !node.parent) return; // can't delete root
      this._pushUndo();
      const parent = node.parent;
      const idx = parent.children.indexOf(node);
      parent.children.splice(idx, 1);

      // Remove from map recursively
      this._removeFromMap(node);

      // Select parent or sibling
      if (parent.children.length > 0) {
        const newIdx = Math.min(idx, parent.children.length - 1);
        this.selectNode(parent.children[newIdx].id);
      } else {
        this.selectNode(parent.id);
      }
      this.render();
      this._notifyChange();
    }

    _removeFromMap(node) {
      this.nodes.delete(node.id);
      node.children.forEach(c => this._removeFromMap(c));
    }

    // ---- Undo/Redo ----
    _pushUndo() {
      undoStack.push(JSON.stringify(this.getData()));
      if (undoStack.length > 50) undoStack.shift();
      redoStack = [];
    }

    undo() {
      if (undoStack.length === 0) return;
      redoStack.push(JSON.stringify(this.getData()));
      const data = JSON.parse(undoStack.pop());
      this.setData(data);
      this._notifyChange();
    }

    redo() {
      if (redoStack.length === 0) return;
      undoStack.push(JSON.stringify(this.getData()));
      const data = JSON.parse(redoStack.pop());
      this.setData(data);
      this._notifyChange();
    }

    _notifyChange() {
      window.dispatchEvent(new CustomEvent('mindmap-data-changed'));
    }

    setNodeNote(nodeId, note) {
      const node = this.nodes.get(nodeId);
      if (node) {
        node.note = note;
        this.render();
      }
    }

    getNodeNote(nodeId) {
      const node = this.nodes.get(nodeId);
      return node ? node.note || '' : '';
    }

    destroy() {
      if (this._resizeObserver) this._resizeObserver.disconnect();
      if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
      if (this.inputEl.parentNode) this.inputEl.parentNode.removeChild(this.inputEl);
    }

    focus() {
      this.canvas.focus();
    }
  }

  // ---- API Functions ----
  async function fetchMindmaps() {
    const res = await fetch(API_URL, { cache: 'no-store' });
    return res.json();
  }

  async function fetchMindmap(id) {
    const res = await fetch(`${API_URL}/${id}`, { cache: 'no-store' });
    return res.json();
  }

  async function createMindmap(title) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    return res.json();
  }

  async function updateMindmap(id, data) {
    const res = await fetch(`${API_URL}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  }

  async function deleteMindmap(id) {
    const res = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
    return res.json();
  }

  // ---- Render List ----
  function renderList() {
    if (!listEl) return;
    const filtered = tagFilter === 'all' ? mindmaps : mindmaps.filter(m => (m.tag || 'knowledge') === tagFilter);
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="mindmaps-empty">' + (mindmaps.length === 0 ? 'No mindmaps yet' : 'No mindmaps with this tag') + '</div>';
      return;
    }
    listEl.innerHTML = filtered.map(m => {
      const active = m.id === currentMindmapId ? 'active' : '';
      const tag = m.tag || 'knowledge';
      const tagEmoji = tag === 'execution' ? '⚔️' : '📚';
      const time = m.updated_at ? new Date(m.updated_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : '';
      return `
        <div class="mindmap-list-item ${active}" data-id="${m.id}">
          <div class="mindmap-list-title"><span class="mindmap-tag-emoji">${tagEmoji}</span> ${escapeHtml(m.title)}</div>
          <div class="mindmap-list-time">${time}</div>
        </div>
      `;
    }).join('');

    // Bind click events
    listEl.querySelectorAll('.mindmap-list-item').forEach(el => {
      el.addEventListener('click', () => loadMindmap(el.dataset.id));
    });
  }

  function renderTagFilters() {
    const sidebar = document.querySelector('.mindmaps-sidebar');
    if (!sidebar) return;
    let filterBar = sidebar.querySelector('.mindmap-tag-filters');
    if (!filterBar) {
      filterBar = document.createElement('div');
      filterBar.className = 'mindmap-tag-filters';
      sidebar.insertBefore(filterBar, listEl);
    }
    const filters = [
      { key: 'all', label: 'All' },
      { key: 'knowledge', label: '📚' },
      { key: 'execution', label: '⚔️' }
    ];
    filterBar.innerHTML = filters.map(f => {
      const active = tagFilter === f.key ? 'active' : '';
      return `<button class="mindmap-tag-filter-btn ${active}" data-filter="${f.key}">${f.label}</button>`;
    }).join('');
    filterBar.querySelectorAll('.mindmap-tag-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        tagFilter = btn.dataset.filter;
        renderTagFilters();
        renderList();
      });
    });
  }

  // ---- Load / Save ----
  async function loadMindmapList() {
    try {
      mindmaps = await fetchMindmaps();
      renderTagFilters();
      renderList();
    } catch (err) {
      console.error('Failed to load mindmaps:', err);
    }
  }

  async function loadMindmap(id) {
    // Flush any pending save from previous mindmap before switching
    if (currentMindmapId && currentMindmapId !== id) {
      await flushSave();
    }
    try {
      const data = await fetchMindmap(id);
      currentMindmap = data;
      currentMindmapId = id;
      selectedNodeId = null;
      currentRevision = data.revision || 0;
      // Restore undo/redo history from backend (if available)
      undoStack = (data.history && Array.isArray(data.history.undo)) ? [...data.history.undo] : [];
      redoStack = (data.history && Array.isArray(data.history.redo)) ? [...data.history.redo] : [];

      // Show toolbar + right panel
      if (toolbarEl) toolbarEl.classList.remove('hidden');
      if (rightPanel) rightPanel.classList.remove('hidden');
      if (emptyEl) emptyEl.style.display = 'none';
      if (titleDisplay) titleDisplay.textContent = data.title;
      updateTagButton(data.tag || 'knowledge');

      // Init or update canvas
      if (!mindmapInstance) {
        mindmapInstance = new MindmapCanvas(containerEl);
      }
      mindmapInstance.setData(data.data);
      mindmapInstance.focus();

      // Load thinking notes
      if (thinkingNotesEl) thinkingNotesEl.value = data.notes || '';

      // Update list highlight
      renderList();
    } catch (err) {
      console.error('Failed to load mindmap:', err);
    }
  }

  let saving = false;
  let pendingSave = false;

  function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(doSave, 800);
  }

  // Immediate save (for critical moments: before unload, before switching maps)
  async function flushSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = null;
    await doSave();
  }

  async function doSave() {
    if (!currentMindmapId || !mindmapInstance) return;
    if (suppressNextSave) { suppressNextSave = false; return; }
    if (saving) { pendingSave = true; return; }
    saving = true;
    try {
      const mapData = mindmapInstance.getData();
      const notes = thinkingNotesEl ? thinkingNotesEl.value : '';
      const history = { undo: [...undoStack], redo: [...redoStack] };
      const result = await updateMindmap(currentMindmapId, { data: mapData, notes, history, source: clientId });
      if (result && result.revision) currentRevision = result.revision;
      // Update list timestamps
      const idx = mindmaps.findIndex(m => m.id === currentMindmapId);
      if (idx >= 0) {
        mindmaps[idx].updated_at = new Date().toISOString();
      }
    } catch (err) {
      console.error('Failed to save mindmap:', err);
    } finally {
      saving = false;
      if (pendingSave) {
        pendingSave = false;
        scheduleSave();
      }
    }
  }

  // ---- Event Handlers ----
  function onNodeSelected(e) {
    const node = e.detail?.node;
    selectedNodeId = node?.id || null;
    if (nodeNoteEl) {
      nodeNoteEl.value = node?.note || '';
      nodeNoteEl.disabled = !node;
    }
    // Also sync zen floating note if visible
    const zenNote = document.getElementById('zen-node-note');
    if (zenNote) {
      zenNote.value = node?.note || '';
      zenNote.disabled = !node;
    }
  }

  function onDataChanged() {
    scheduleSave();
  }

  async function onNewMindmap() {
    const title = prompt('Mindmap name:', 'New Mindmap');
    if (!title || !title.trim()) return;
    try {
      const mm = await createMindmap(title.trim());
      mindmaps.unshift({ id: mm.id, title: mm.title, updated_at: mm.updated_at });
      renderList();
      loadMindmap(mm.id);
    } catch (err) {
      console.error('Failed to create mindmap:', err);
    }
  }

  async function onRenameMindmap() {
    if (!currentMindmapId || !currentMindmap) return;
    const title = prompt('Rename mindmap:', currentMindmap.title);
    if (!title || !title.trim()) return;
    try {
      await updateMindmap(currentMindmapId, { title: title.trim() });
      currentMindmap.title = title.trim();
      if (titleDisplay) titleDisplay.textContent = title.trim();
      const idx = mindmaps.findIndex(m => m.id === currentMindmapId);
      if (idx >= 0) mindmaps[idx].title = title.trim();
      renderList();
    } catch (err) {
      console.error('Failed to rename mindmap:', err);
    }
  }

  async function onDeleteMindmap() {
    if (!currentMindmapId) return;
    if (!confirm(`Delete "${currentMindmap?.title || 'this mindmap'}"?`)) return;
    try {
      await deleteMindmap(currentMindmapId);
      mindmaps = mindmaps.filter(m => m.id !== currentMindmapId);
      currentMindmapId = null;
      currentMindmap = null;

      // Destroy canvas
      if (mindmapInstance) {
        mindmapInstance.destroy();
        mindmapInstance = null;
      }

      // Reset UI
      if (toolbarEl) toolbarEl.classList.add('hidden');
      if (rightPanel) rightPanel.classList.add('hidden');
      if (emptyEl) emptyEl.style.display = '';

      renderList();
    } catch (err) {
      console.error('Failed to delete mindmap:', err);
    }
  }

  // ---- Help Modal ----
  function toggleHelpModal() {
    const modal = document.getElementById('mindmap-help-modal');
    if (!modal) return;
    modal.classList.toggle('hidden');
  }

  function closeHelpModal() {
    const modal = document.getElementById('mindmap-help-modal');
    if (modal) modal.classList.add('hidden');
  }

  // Setup help modal events (called once from init)
  function setupHelpModal() {
    const modal = document.getElementById('mindmap-help-modal');
    if (!modal) return;

    // Close on backdrop click
    const backdrop = modal.querySelector('.mindmap-help-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeHelpModal);

    // Close button
    const closeBtn = modal.querySelector('.mindmap-help-close');
    if (closeBtn) closeBtn.addEventListener('click', closeHelpModal);
  }

  // ---- Zen Mode ----
  let zenMode = false;

  function toggleZenMode() {
    const layout = document.querySelector('.mindmaps-layout');
    if (!layout) return;
    zenMode = !zenMode;
    layout.classList.toggle('zen-mode', zenMode);

    // When exiting Zen, close any floating panels and sync their content back
    if (!zenMode) {
      closeZenFloatingPanels();
    }

    // Resize canvas after layout change
    if (mindmapInstance) {
      setTimeout(() => {
        mindmapInstance._resize();
        mindmapInstance.focus();
      }, 50);
    }
  }

  function closeZenFloatingPanels() {
    const notePanel = document.getElementById('zen-float-note');
    const thinkingPanel = document.getElementById('zen-float-thinking');
    if (notePanel) notePanel.classList.remove('visible');
    if (thinkingPanel) thinkingPanel.classList.remove('visible');
  }

  function toggleZenFloatingPanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;

    if (panel.classList.contains('visible')) {
      panel.classList.remove('visible');
      if (mindmapInstance) mindmapInstance.focus();
    } else {
      // Sync content before showing
      if (panelId === 'zen-float-note') {
        const zenNote = document.getElementById('zen-node-note');
        if (zenNote && nodeNoteEl) {
          zenNote.value = nodeNoteEl.value;
          zenNote.disabled = nodeNoteEl.disabled;
        }
      } else if (panelId === 'zen-float-thinking') {
        const zenThinking = document.getElementById('zen-thinking-notes');
        if (zenThinking && thinkingNotesEl) {
          zenThinking.value = thinkingNotesEl.value;
        }
      }
      panel.classList.add('visible');
      // Focus the textarea inside
      const ta = panel.querySelector('textarea');
      if (ta && !ta.disabled) ta.focus();
    }
  }

  // Setup Zen floating panels (drag + sync + close)
  function setupZenFloatingPanels() {
    ['zen-float-note', 'zen-float-thinking'].forEach(panelId => {
      const panel = document.getElementById(panelId);
      if (!panel) return;

      // Close button
      const closeBtn = panel.querySelector('.zen-floating-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          panel.classList.remove('visible');
          if (mindmapInstance) mindmapInstance.focus();
        });
      }

      // Dragging
      const header = panel.querySelector('.zen-floating-header');
      if (header) {
        let dragOffX = 0, dragOffY = 0, dragging = false;
        header.addEventListener('mousedown', (e) => {
          dragging = true;
          dragOffX = e.clientX - panel.getBoundingClientRect().left;
          dragOffY = e.clientY - panel.getBoundingClientRect().top;
          e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
          if (!dragging) return;
          panel.style.left = (e.clientX - dragOffX) + 'px';
          panel.style.top = (e.clientY - dragOffY) + 'px';
          panel.style.right = 'auto'; // remove right positioning once dragged
        });
        document.addEventListener('mouseup', () => { dragging = false; });
      }
    });

    // Sync zen node note back to main
    const zenNote = document.getElementById('zen-node-note');
    if (zenNote) {
      zenNote.addEventListener('input', () => {
        if (selectedNodeId && mindmapInstance) {
          mindmapInstance.setNodeNote(selectedNodeId, zenNote.value);
          if (nodeNoteEl) nodeNoteEl.value = zenNote.value;
          scheduleSave();
        }
      });
      // Escape closes the panel
      zenNote.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          document.getElementById('zen-float-note')?.classList.remove('visible');
          if (mindmapInstance) mindmapInstance.focus();
        }
      });
    }

    // Sync zen thinking notes back to main
    const zenThinking = document.getElementById('zen-thinking-notes');
    if (zenThinking) {
      zenThinking.addEventListener('input', () => {
        if (thinkingNotesEl) thinkingNotesEl.value = zenThinking.value;
        scheduleSave();
      });
      zenThinking.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          document.getElementById('zen-float-thinking')?.classList.remove('visible');
          if (mindmapInstance) mindmapInstance.focus();
        }
      });
    }
  }

  // ---- Tag Functions ----
  function updateTagButton(tag) {
    if (!tagBtn) return;
    const isExec = tag === 'execution';
    tagBtn.textContent = isExec ? '⚔️ execution' : '📚 knowledge';
    tagBtn.className = 'mindmap-tag-badge ' + (isExec ? 'tag-execution' : 'tag-knowledge');
  }

  async function toggleTag() {
    if (!currentMindmapId || !currentMindmap) return;
    const currentTag = currentMindmap.tag || 'knowledge';
    const newTag = currentTag === 'knowledge' ? 'execution' : 'knowledge';
    try {
      await updateMindmap(currentMindmapId, { tag: newTag, source: clientId });
      currentMindmap.tag = newTag;
      updateTagButton(newTag);
      // Update in list
      const idx = mindmaps.findIndex(m => m.id === currentMindmapId);
      if (idx >= 0) mindmaps[idx].tag = newTag;
      renderList();
    } catch (err) {
      console.error('Failed to update tag:', err);
    }
  }

  // ---- Init ----
  function init() {
    if (initialized) {
      // Just reload list
      loadMindmapList();
      return;
    }
    initialized = true;

    // Setup help modal and zen floating panels
    setupHelpModal();
    setupZenFloatingPanels();

    // Button events
    if (newBtn) newBtn.addEventListener('click', onNewMindmap);
    if (renameBtn) renameBtn.addEventListener('click', onRenameMindmap);
    if (deleteBtn) deleteBtn.addEventListener('click', onDeleteMindmap);
    if (tagBtn) tagBtn.addEventListener('click', toggleTag);

    // Node note editing
    if (nodeNoteEl) {
      nodeNoteEl.addEventListener('input', () => {
        if (selectedNodeId && mindmapInstance) {
          mindmapInstance.setNodeNote(selectedNodeId, nodeNoteEl.value);
          scheduleSave();
        }
      });
    }

    // Thinking notes editing
    if (thinkingNotesEl) {
      thinkingNotesEl.addEventListener('input', () => {
        scheduleSave();
      });
    }

    // Listen for mindmap events
    window.addEventListener('mindmap-node-selected', onNodeSelected);
    window.addEventListener('mindmap-data-changed', onDataChanged);

    // ---- Global keyboard shortcuts for panel switching ----
    // Ctrl+1 = focus mindmap canvas
    // Ctrl+2 = focus node notes
    // Ctrl+3 = focus thinking notes
    // Escape in textareas = back to canvas
    document.addEventListener('keydown', (e) => {
      // Only handle when mindmaps view is active
      const mindmapsView = document.getElementById('mindmaps-view');
      if (!mindmapsView || !mindmapsView.classList.contains('active')) return;

      // Escape: close help modal first, then handle textareas
      if (e.key === 'Escape') {
        const helpModal = document.getElementById('mindmap-help-modal');
        if (helpModal && !helpModal.classList.contains('hidden')) {
          e.preventDefault();
          closeHelpModal();
          if (mindmapInstance) mindmapInstance.focus();
          return;
        }
        if (document.activeElement === nodeNoteEl || document.activeElement === thinkingNotesEl) {
          e.preventDefault();
          if (mindmapInstance) mindmapInstance.focus();
          return;
        }
        // In Zen mode, escape from zen floating textareas is handled by their own keydown listeners
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        if (e.key === '1') {
          e.preventDefault();
          // In Zen mode, close floating panels and focus canvas
          if (zenMode) closeZenFloatingPanels();
          if (mindmapInstance) mindmapInstance.focus();
        } else if (e.key === '2') {
          e.preventDefault();
          if (zenMode) {
            // In Zen mode, toggle floating note panel
            toggleZenFloatingPanel('zen-float-note');
          } else {
            if (nodeNoteEl && !nodeNoteEl.disabled) {
              nodeNoteEl.focus();
            }
          }
        } else if (e.key === '3') {
          e.preventDefault();
          if (zenMode) {
            // In Zen mode, toggle floating thinking panel
            toggleZenFloatingPanel('zen-float-thinking');
          } else {
            if (thinkingNotesEl) thinkingNotesEl.focus();
          }
        }
      }
    });

    // Flush save before page unload
    window.addEventListener('beforeunload', () => {
      if (currentMindmapId && mindmapInstance) {
        // Synchronous best-effort save via sendBeacon
        try {
          const mapData = mindmapInstance.getData();
          const notes = thinkingNotesEl ? thinkingNotesEl.value : '';
          const history = { undo: [...undoStack], redo: [...redoStack] };
          const payload = JSON.stringify({ data: mapData, notes, history, source: clientId });
          navigator.sendBeacon(`${API_URL}/${currentMindmapId}`, new Blob([payload], { type: 'application/json' }));
        } catch (e) { /* best effort */ }
      }
    });

    // Also flush when tab loses visibility
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && currentMindmapId) {
        flushSave();
      }
    });

    // Listen for backend-initiated mindmap updates via SSE
    setupMindmapSSE();

    // Load list
    loadMindmapList();
  }

  function setupMindmapSSE() {
    // Use the existing /api/events SSE endpoint
    const evtSource = new EventSource('/api/events');
    evtSource.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'mindmap:updated' && msg.data) {
          const { id, source, revision } = msg.data;
          // Ignore our own saves
          if (source === clientId) return;
          // Only reload if it's the currently open mindmap and revision is newer
          if (id === currentMindmapId && revision > currentRevision) {
            console.log(`[mindmap] Backend update detected (source=${source}, rev=${revision}). Reloading...`);
            reloadFromBackend();
          }
          // Also refresh the list sidebar (title may have changed)
          loadMindmapList();
        }
      } catch (err) {
        // ignore parse errors for non-mindmap events
      }
    });
    evtSource.addEventListener('error', () => {
      // EventSource auto-reconnects; no action needed
    });
  }

  async function reloadFromBackend() {
    if (!currentMindmapId || !mindmapInstance) return;
    try {
      const data = await fetchMindmap(currentMindmapId);

      // Push current state to undo stack so user can undo the external change
      const currentData = mindmapInstance.getData();
      undoStack.push(JSON.stringify(currentData));
      if (undoStack.length > 50) undoStack.shift();
      redoStack = [];

      // Update state
      currentMindmap = data;
      currentRevision = data.revision || 0;
      suppressNextSave = true;  // don't re-save what we just loaded

      // Reload canvas
      mindmapInstance.setData(data.data);

      // Reload thinking notes
      if (thinkingNotesEl) thinkingNotesEl.value = data.notes || '';

      // Update title and tag display
      if (titleDisplay) titleDisplay.textContent = data.title;
      updateTagButton(data.tag || 'knowledge');

      // Show a brief notification
      showBackendUpdateNotice();
    } catch (err) {
      console.error('[mindmap] Failed to reload from backend:', err);
    }
  }

  function showBackendUpdateNotice() {
    // Show a brief toast notification
    let toast = document.getElementById('mindmap-backend-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mindmap-backend-toast';
      toast.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#4A90D9;color:#fff;padding:10px 18px;border-radius:8px;font-size:14px;z-index:9999;opacity:0;transition:opacity 0.3s;pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = '🔄 Mindmap updated from backend (Ctrl+Z to undo)';
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 3000);
  }

  // Listen for view activation
  window.addEventListener('mindmaps-view-activated', init);

  // Also check on script load if mindmaps view is already active
  if (document.getElementById('mindmaps-view')?.classList.contains('active')) {
    init();
  }

  // Debug/test API
  window.__mindmapDebug = {
    getSelectedId: () => selectedNodeId,
    getEditingNodeId: () => editingNodeId,
    getMindmapInstance: () => mindmapInstance,
    getUndoStackLength: () => undoStack.length,
    getRedoStackLength: () => redoStack.length,
    getNodeCount: () => mindmapInstance ? mindmapInstance.nodes.size : 0,
    getNodeText: (id) => mindmapInstance ? (mindmapInstance.nodes.get(id)?.text || null) : null,
    getNodeChildren: (id) => mindmapInstance ? (mindmapInstance.nodes.get(id)?.children.map(c => c.id) || []) : [],
    getNodeParent: (id) => mindmapInstance ? (mindmapInstance.nodes.get(id)?.parent?.id || null) : null,
    isCollapsed: (id) => mindmapInstance ? (mindmapInstance.nodes.get(id)?.collapsed || false) : false,
    getAllNodeIds: () => mindmapInstance ? Array.from(mindmapInstance.nodes.keys()) : [],
    getNodeDepth: (id) => mindmapInstance ? (mindmapInstance.nodes.get(id)?.depth ?? -1) : -1,
    getVisibleNodesAtDepth: (depth) => {
      if (!mindmapInstance) return [];
      return mindmapInstance._getVisibleNodesAtDepthOrDeepest(depth).map(n => n.id);
    },
    isZenMode: () => {
      const layout = document.querySelector('.mindmaps-layout');
      return layout ? layout.classList.contains('zen-mode') : false;
    },
    isHelpModalVisible: () => {
      const modal = document.getElementById('mindmap-help-modal');
      return modal ? !modal.classList.contains('hidden') : false;
    },
  };

  // Utility
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
