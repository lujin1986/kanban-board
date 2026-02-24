// Playwright tests for Mindmap keyboard shortcuts
const { test, expect } = require('@playwright/test');

// Helper to get debug info from the page
const debug = {
  selectedId: (page) => page.evaluate(() => window.__mindmapDebug.getSelectedId()),
  editingId: (page) => page.evaluate(() => window.__mindmapDebug.getEditingNodeId()),
  undoLen: (page) => page.evaluate(() => window.__mindmapDebug.getUndoStackLength()),
  redoLen: (page) => page.evaluate(() => window.__mindmapDebug.getRedoStackLength()),
  nodeCount: (page) => page.evaluate(() => window.__mindmapDebug.getNodeCount()),
  nodeText: (page, id) => page.evaluate((nid) => window.__mindmapDebug.getNodeText(nid), id),
  nodeChildren: (page, id) => page.evaluate((nid) => window.__mindmapDebug.getNodeChildren(nid), id),
  nodeParent: (page, id) => page.evaluate((nid) => window.__mindmapDebug.getNodeParent(nid), id),
  isCollapsed: (page, id) => page.evaluate((nid) => window.__mindmapDebug.isCollapsed(nid), id),
  allNodeIds: (page) => page.evaluate(() => window.__mindmapDebug.getAllNodeIds()),
  nodeDepth: (page, id) => page.evaluate((nid) => window.__mindmapDebug.getNodeDepth(nid), id),
  visibleNodesAtDepth: (page, depth) => page.evaluate((d) => window.__mindmapDebug.getVisibleNodesAtDepth(d), depth),
  isZenMode: (page) => page.evaluate(() => window.__mindmapDebug.isZenMode()),
  isHelpModalVisible: (page) => page.evaluate(() => window.__mindmapDebug.isHelpModalVisible()),
};

// Common setup: navigate to mindmaps view, open the first mindmap, click root node
async function setupMindmap(page) {
  await page.goto('/#mindmaps');
  // Wait for the mindmaps view to become active
  await page.waitForSelector('#mindmaps-view.active', { timeout: 5000 });
  // Wait for the mindmap list to appear
  await page.waitForSelector('.mindmap-list-item', { timeout: 5000 });
  // Click the first mindmap
  await page.click('.mindmap-list-item');
  // Wait for canvas to appear
  await page.waitForSelector('canvas.mindmap-canvas', { timeout: 5000 });
  // Small delay to let rendering finish
  await page.waitForTimeout(500);
}

// Click on the canvas to get focus, then click on a node by evaluating its position
async function clickNode(page, nodeId) {
  // Get node screen position
  const pos = await page.evaluate((nid) => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    const node = mi.nodes.get(nid);
    if (!node) return null;
    // Convert node position to screen coords
    const screenX = node.x * mi.scale + mi.panX + node.width / 2 * mi.scale;
    const screenY = node.y * mi.scale + mi.panY + node.height / 2 * mi.scale;
    const rect = mi.canvas.getBoundingClientRect();
    return { x: rect.left + screenX, y: rect.top + screenY };
  }, nodeId);

  if (pos) {
    await page.mouse.click(pos.x, pos.y);
  }
}

// Click on the root node to select it
async function selectRoot(page) {
  const rootId = await page.evaluate(() => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    return mi.root ? mi.root.id : null;
  });
  expect(rootId).toBeTruthy();
  await clickNode(page, rootId);
  await page.waitForTimeout(100);
  const selId = await debug.selectedId(page);
  // If click didn't select the root, try clicking canvas first for focus
  if (selId !== rootId) {
    const canvas = page.locator('canvas.mindmap-canvas');
    await canvas.click();
    await page.waitForTimeout(100);
    await clickNode(page, rootId);
    await page.waitForTimeout(100);
  }
  return rootId;
}

// Select a specific node by clicking on it
async function selectNodeById(page, nodeId) {
  await clickNode(page, nodeId);
  await page.waitForTimeout(100);
  const sel = await debug.selectedId(page);
  if (sel !== nodeId) {
    // Try again with a direct evaluate to set selection
    await page.evaluate((nid) => {
      const mi = window.__mindmapDebug.getMindmapInstance();
      mi.selectNode(nid);
    }, nodeId);
    await page.waitForTimeout(100);
  }
}

// Press a key on the canvas
async function pressKey(page, key, modifiers = {}) {
  // Make sure canvas has focus
  const canvas = page.locator('canvas.mindmap-canvas');
  await canvas.focus();
  await page.waitForTimeout(50);

  const keyCombo = [];
  if (modifiers.ctrl) keyCombo.push('Control');
  if (modifiers.shift) keyCombo.push('Shift');
  if (modifiers.alt) keyCombo.push('Alt');
  if (modifiers.meta) keyCombo.push('Meta');
  keyCombo.push(key);

  await page.keyboard.press(keyCombo.join('+'));
  await page.waitForTimeout(100);
}

test.describe('Mindmap Keyboard Shortcuts', () => {

  test.describe('Navigation - Arrow Keys', () => {
    test('ArrowRight: navigate from root to first child', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThan(0);

      await pressKey(page, 'ArrowRight');
      const sel = await debug.selectedId(page);
      expect(sel).toBe(children[0]);
    });

    test('ArrowLeft: navigate from child back to parent', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThan(0);

      // First go right to a child
      await pressKey(page, 'ArrowRight');
      const sel1 = await debug.selectedId(page);
      expect(sel1).toBe(children[0]);

      // Now go left back to root
      await pressKey(page, 'ArrowLeft');
      const sel2 = await debug.selectedId(page);
      expect(sel2).toBe(rootId);
    });

    test('ArrowDown: navigate to next sibling', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThanOrEqual(2);

      // Go right to first child
      await pressKey(page, 'ArrowRight');
      const sel1 = await debug.selectedId(page);
      expect(sel1).toBe(children[0]);

      // Go down to second sibling
      await pressKey(page, 'ArrowDown');
      const sel2 = await debug.selectedId(page);
      expect(sel2).toBe(children[1]);
    });

    test('ArrowUp: navigate to previous sibling', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThanOrEqual(2);

      // Go right then down to second child
      await pressKey(page, 'ArrowRight');
      await pressKey(page, 'ArrowDown');
      const sel1 = await debug.selectedId(page);
      expect(sel1).toBe(children[1]);

      // Go up to first child
      await pressKey(page, 'ArrowUp');
      const sel2 = await debug.selectedId(page);
      expect(sel2).toBe(children[0]);
    });
  });

  test.describe('Navigation - Vim Keys', () => {
    test('l: navigate right (same as ArrowRight)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThan(0);

      await pressKey(page, 'l');
      const sel = await debug.selectedId(page);
      expect(sel).toBe(children[0]);
    });

    test('h: navigate left (same as ArrowLeft)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);

      await pressKey(page, 'l'); // go right
      await pressKey(page, 'h'); // go left
      const sel = await debug.selectedId(page);
      expect(sel).toBe(rootId);
    });

    test('j: navigate down (same as ArrowDown)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThanOrEqual(2);

      await pressKey(page, 'l'); // go to first child
      await pressKey(page, 'j'); // go down
      const sel = await debug.selectedId(page);
      expect(sel).toBe(children[1]);
    });

    test('k: navigate up (same as ArrowUp)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThanOrEqual(2);

      await pressKey(page, 'l'); // go to first child
      await pressKey(page, 'j'); // go down to second
      await pressKey(page, 'k'); // go up to first
      const sel = await debug.selectedId(page);
      expect(sel).toBe(children[0]);
    });
  });

  test.describe('Edit Operations', () => {
    test('i: enter edit mode (inline input appears)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);

      await pressKey(page, 'i');
      await page.waitForTimeout(200);

      // Check inline input is visible
      const inputVisible = await page.evaluate(() => {
        const input = document.querySelector('.mindmap-inline-input');
        return input && input.style.display !== 'none';
      });
      expect(inputVisible).toBe(true);

      // Check editingNodeId is set
      const editId = await debug.editingId(page);
      expect(editId).toBe(rootId);

      // Escape to cancel
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    });

    test('F2: enter edit mode (inline input appears)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);

      await pressKey(page, 'F2');
      await page.waitForTimeout(200);

      const inputVisible = await page.evaluate(() => {
        const input = document.querySelector('.mindmap-inline-input');
        return input && input.style.display !== 'none';
      });
      expect(inputVisible).toBe(true);

      const editId = await debug.editingId(page);
      expect(editId).toBe(rootId);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    });

    test('Tab: add child node', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const childrenBefore = await debug.nodeChildren(page, rootId);
      const nodeCountBefore = await debug.nodeCount(page);

      await pressKey(page, 'Tab');
      await page.waitForTimeout(300);

      // A new node should be created and we should be in edit mode
      const nodeCountAfter = await debug.nodeCount(page);
      expect(nodeCountAfter).toBe(nodeCountBefore + 1);

      // Cancel the edit that started automatically
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      // The new node should be a child of root
      const childrenAfter = await debug.nodeChildren(page, rootId);
      expect(childrenAfter.length).toBe(childrenBefore.length + 1);
    });

    test('o: add child node (vim style)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const childrenBefore = await debug.nodeChildren(page, rootId);
      const nodeCountBefore = await debug.nodeCount(page);

      await pressKey(page, 'o');
      await page.waitForTimeout(300);

      const nodeCountAfter = await debug.nodeCount(page);
      expect(nodeCountAfter).toBe(nodeCountBefore + 1);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      const childrenAfter = await debug.nodeChildren(page, rootId);
      expect(childrenAfter.length).toBe(childrenBefore.length + 1);
    });

    test('Enter: add sibling node', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThan(0);

      // Select first child (not root, since root has no parent)
      await selectNodeById(page, children[0]);
      const nodeCountBefore = await debug.nodeCount(page);

      await pressKey(page, 'Enter');
      await page.waitForTimeout(300);

      const nodeCountAfter = await debug.nodeCount(page);
      expect(nodeCountAfter).toBe(nodeCountBefore + 1);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      // Root should now have one more child (sibling was added)
      const childrenAfter = await debug.nodeChildren(page, rootId);
      expect(childrenAfter.length).toBe(children.length + 1);
    });

    test('O (shift+o): add sibling node (vim style)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThan(0);

      // Select first child
      await selectNodeById(page, children[0]);
      const nodeCountBefore = await debug.nodeCount(page);

      await pressKey(page, 'O');
      await page.waitForTimeout(300);

      const nodeCountAfter = await debug.nodeCount(page);
      expect(nodeCountAfter).toBe(nodeCountBefore + 1);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    });

    test('Delete: delete selected non-root node', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);

      // First add a child to test deletion
      await pressKey(page, 'Tab');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      // Get the newly created node (should be selected)
      const newNodeId = await debug.selectedId(page);
      expect(newNodeId).not.toBe(rootId);
      const nodeCountBefore = await debug.nodeCount(page);

      // Focus canvas again, then delete
      await pressKey(page, 'Delete');
      await page.waitForTimeout(200);

      const nodeCountAfter = await debug.nodeCount(page);
      expect(nodeCountAfter).toBe(nodeCountBefore - 1);
    });

    test('Backspace: delete selected non-root node', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);

      // Add a child
      await pressKey(page, 'Tab');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      const newNodeId = await debug.selectedId(page);
      expect(newNodeId).not.toBe(rootId);
      const nodeCountBefore = await debug.nodeCount(page);

      await pressKey(page, 'Backspace');
      await page.waitForTimeout(200);

      const nodeCountAfter = await debug.nodeCount(page);
      expect(nodeCountAfter).toBe(nodeCountBefore - 1);
    });

    test('x: delete selected non-root node (vim style)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);

      // Add a child
      await pressKey(page, 'Tab');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      const newNodeId = await debug.selectedId(page);
      expect(newNodeId).not.toBe(rootId);
      const nodeCountBefore = await debug.nodeCount(page);

      await pressKey(page, 'x');
      await page.waitForTimeout(200);

      const nodeCountAfter = await debug.nodeCount(page);
      expect(nodeCountAfter).toBe(nodeCountBefore - 1);
    });

    test('d: delete selected non-root node (vim style)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);

      // Add a child
      await pressKey(page, 'Tab');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      const newNodeId = await debug.selectedId(page);
      expect(newNodeId).not.toBe(rootId);
      const nodeCountBefore = await debug.nodeCount(page);

      await pressKey(page, 'd');
      await page.waitForTimeout(200);

      const nodeCountAfter = await debug.nodeCount(page);
      expect(nodeCountAfter).toBe(nodeCountBefore - 1);
    });

    test('Space: toggle collapse/expand', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThan(0);

      // Root should not be collapsed initially
      const collapsedBefore = await debug.isCollapsed(page, rootId);
      expect(collapsedBefore).toBe(false);

      // Press space to collapse
      await pressKey(page, ' ');
      const collapsedAfter = await debug.isCollapsed(page, rootId);
      expect(collapsedAfter).toBe(true);

      // Press space again to expand
      await pressKey(page, ' ');
      const collapsedFinal = await debug.isCollapsed(page, rootId);
      expect(collapsedFinal).toBe(false);
    });
  });

  test.describe('Undo/Redo', () => {
    test('u: undo last action (vim style)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const nodeCountOriginal = await debug.nodeCount(page);

      // Add a child
      await pressKey(page, 'Tab');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      const nodeCountAfterAdd = await debug.nodeCount(page);
      expect(nodeCountAfterAdd).toBe(nodeCountOriginal + 1);

      // Focus canvas
      const canvas = page.locator('canvas.mindmap-canvas');
      await canvas.focus();
      await page.waitForTimeout(100);

      // Undo with u
      await pressKey(page, 'u');
      await page.waitForTimeout(300);

      const nodeCountAfterUndo = await debug.nodeCount(page);
      expect(nodeCountAfterUndo).toBe(nodeCountOriginal);
    });

    test('Ctrl+Z: undo last action', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const nodeCountOriginal = await debug.nodeCount(page);

      // Add a child
      await pressKey(page, 'Tab');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      const nodeCountAfterAdd = await debug.nodeCount(page);
      expect(nodeCountAfterAdd).toBe(nodeCountOriginal + 1);

      const canvas = page.locator('canvas.mindmap-canvas');
      await canvas.focus();
      await page.waitForTimeout(100);

      // Undo with Ctrl+Z
      await pressKey(page, 'z', { ctrl: true });
      await page.waitForTimeout(300);

      const nodeCountAfterUndo = await debug.nodeCount(page);
      expect(nodeCountAfterUndo).toBe(nodeCountOriginal);
    });

    test('Ctrl+Shift+Z: redo', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const nodeCountOriginal = await debug.nodeCount(page);

      // Add a child, then undo
      await pressKey(page, 'Tab');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      const canvas = page.locator('canvas.mindmap-canvas');
      await canvas.focus();
      await page.waitForTimeout(100);

      await pressKey(page, 'u'); // undo
      await page.waitForTimeout(300);

      const nodeCountAfterUndo = await debug.nodeCount(page);
      expect(nodeCountAfterUndo).toBe(nodeCountOriginal);

      // Redo with Ctrl+Shift+Z
      await pressKey(page, 'Z', { ctrl: true, shift: true });
      await page.waitForTimeout(300);

      const nodeCountAfterRedo = await debug.nodeCount(page);
      expect(nodeCountAfterRedo).toBe(nodeCountOriginal + 1);
    });

    test('Ctrl+R: redo (vim style)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const nodeCountOriginal = await debug.nodeCount(page);

      // Add a child, then undo
      await pressKey(page, 'Tab');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      const canvas = page.locator('canvas.mindmap-canvas');
      await canvas.focus();
      await page.waitForTimeout(100);

      await pressKey(page, 'u'); // undo
      await page.waitForTimeout(300);

      const nodeCountAfterUndo = await debug.nodeCount(page);
      expect(nodeCountAfterUndo).toBe(nodeCountOriginal);

      // Redo with Ctrl+R
      await pressKey(page, 'r', { ctrl: true });
      await page.waitForTimeout(300);

      const nodeCountAfterRedo = await debug.nodeCount(page);
      expect(nodeCountAfterRedo).toBe(nodeCountOriginal + 1);
    });
  });

  test.describe('Panel Switching', () => {
    test('Ctrl+1: focus canvas', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      // First focus a text area
      const thinkingNotes = page.locator('#mindmap-thinking-notes');
      await thinkingNotes.focus();
      await page.waitForTimeout(100);

      // Now Ctrl+1 to go back to canvas
      await page.keyboard.press('Control+1');
      await page.waitForTimeout(200);

      const activeTag = await page.evaluate(() => document.activeElement.tagName.toLowerCase());
      expect(activeTag).toBe('canvas');
    });

    test('Ctrl+2: focus node note textarea', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      // Focus canvas first
      const canvas = page.locator('canvas.mindmap-canvas');
      await canvas.focus();
      await page.waitForTimeout(100);

      // Ctrl+2 to focus node note
      await page.keyboard.press('Control+2');
      await page.waitForTimeout(200);

      const activeId = await page.evaluate(() => document.activeElement.id);
      expect(activeId).toBe('mindmap-node-note');
    });

    test('Ctrl+3: focus thinking notes textarea', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      // Focus canvas first
      const canvas = page.locator('canvas.mindmap-canvas');
      await canvas.focus();
      await page.waitForTimeout(100);

      // Ctrl+3 to focus thinking notes
      await page.keyboard.press('Control+3');
      await page.waitForTimeout(200);

      const activeId = await page.evaluate(() => document.activeElement.id);
      expect(activeId).toBe('mindmap-thinking-notes');
    });

    test('Escape from node note: return to canvas', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      // Focus node note
      await page.keyboard.press('Control+2');
      await page.waitForTimeout(200);
      const activeId = await page.evaluate(() => document.activeElement.id);
      expect(activeId).toBe('mindmap-node-note');

      // Press Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      const activeTag = await page.evaluate(() => document.activeElement.tagName.toLowerCase());
      expect(activeTag).toBe('canvas');
    });

    test('Escape from thinking notes: return to canvas', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      // Focus thinking notes
      await page.keyboard.press('Control+3');
      await page.waitForTimeout(200);

      // Press Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      const activeTag = await page.evaluate(() => document.activeElement.tagName.toLowerCase());
      expect(activeTag).toBe('canvas');
    });
  });

  test.describe('Edge Cases', () => {
    test('Cannot delete root node', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const nodeCountBefore = await debug.nodeCount(page);

      await pressKey(page, 'Delete');
      await page.waitForTimeout(200);

      const nodeCountAfter = await debug.nodeCount(page);
      expect(nodeCountAfter).toBe(nodeCountBefore);
      const sel = await debug.selectedId(page);
      expect(sel).toBe(rootId);
    });

    test('Cannot add sibling to root (Enter on root)', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const nodeCountBefore = await debug.nodeCount(page);

      await pressKey(page, 'Enter');
      await page.waitForTimeout(300);

      // Should not add a node since root has no parent
      const nodeCountAfter = await debug.nodeCount(page);
      expect(nodeCountAfter).toBe(nodeCountBefore);
    });

    test('ArrowRight on collapsed node expands it', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);

      // First collapse root
      await pressKey(page, ' ');
      await page.waitForTimeout(100);
      expect(await debug.isCollapsed(page, rootId)).toBe(true);

      // ArrowRight should expand it (per _navigateRight logic)
      await pressKey(page, 'ArrowRight');
      await page.waitForTimeout(100);
      expect(await debug.isCollapsed(page, rootId)).toBe(false);
    });

    test('Navigation does nothing when no node selected', async ({ page }) => {
      await setupMindmap(page);
      // Just click empty area of canvas
      const canvas = page.locator('canvas.mindmap-canvas');
      await canvas.click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(100);

      // Clear selection by evaluating directly
      await page.evaluate(() => {
        const mi = window.__mindmapDebug.getMindmapInstance();
        mi.selectedId = null;
      });

      await pressKey(page, 'ArrowRight');
      await page.waitForTimeout(100);
      // Should not crash, selection should still be null or unchanged
      // (just verifying no exception)
    });

    test('Edit mode blocks keyboard shortcuts', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const nodeCountBefore = await debug.nodeCount(page);

      // Enter edit mode
      await pressKey(page, 'i');
      await page.waitForTimeout(200);

      // Try to type 'o' which normally adds a child — but in edit mode it should just type
      await page.keyboard.type('o');
      await page.waitForTimeout(100);

      // Node count should not change
      const nodeCountDuringEdit = await debug.nodeCount(page);
      expect(nodeCountDuringEdit).toBe(nodeCountBefore);

      // Cancel edit
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    });
  });

  // ============================================================
  // Feature 1: Cross-branch j/k navigation
  // ============================================================
  test.describe('Cross-branch j/k Navigation', () => {
    test('j navigates across branches at same depth', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThanOrEqual(2);

      // Go to first child (depth 1)
      await pressKey(page, 'l');
      const sel1 = await debug.selectedId(page);
      expect(sel1).toBe(children[0]);

      // j should go to next depth-1 node (second child of root), crossing branches
      await pressKey(page, 'j');
      const sel2 = await debug.selectedId(page);
      expect(sel2).toBe(children[1]);
    });

    test('k navigates backwards across branches at same depth', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThanOrEqual(2);

      // Go to second child
      await selectNodeById(page, children[1]);
      const d = await debug.nodeDepth(page, children[1]);
      expect(d).toBe(1);

      // k should go to first child
      await pressKey(page, 'k');
      const sel = await debug.selectedId(page);
      expect(sel).toBe(children[0]);
    });

    test('j/k at depth 2 crosses parent boundaries', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      expect(children.length).toBeGreaterThanOrEqual(2);

      // Check if first child has children (depth 2 nodes)
      const grandChildren0 = await debug.nodeChildren(page, children[0]);
      const grandChildren1 = await debug.nodeChildren(page, children[1]);

      if (grandChildren0.length > 0 && grandChildren1.length > 0) {
        // Select last grandchild of first child
        const lastGC0 = grandChildren0[grandChildren0.length - 1];
        await selectNodeById(page, lastGC0);

        // Press j — should navigate to first grandchild of second child
        await pressKey(page, 'j');
        const sel = await debug.selectedId(page);
        expect(sel).toBe(grandChildren1[0]);
      }
    });

    test('visible nodes at depth helper includes shallow branch leaves', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);

      // Get visible nodes at depth 1
      const depth1Nodes = await debug.visibleNodesAtDepth(page, 1);
      expect(depth1Nodes.length).toBeGreaterThanOrEqual(2);

      // All returned nodes should have depth <= 1
      for (const nodeId of depth1Nodes) {
        const d = await debug.nodeDepth(page, nodeId);
        expect(d).toBeLessThanOrEqual(1);
      }
    });

    test('j at last node does nothing', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);
      const lastChild = children[children.length - 1];

      // Check if last child has children
      const grandChildren = await debug.nodeChildren(page, lastChild);

      // Navigate to a leaf at depth 1 (last child if it has no children at depth 1)
      const depth1Nodes = await debug.visibleNodesAtDepth(page, 1);
      const lastDepth1 = depth1Nodes[depth1Nodes.length - 1];
      await selectNodeById(page, lastDepth1);

      // Press j — should stay on same node
      await pressKey(page, 'j');
      const sel = await debug.selectedId(page);
      expect(sel).toBe(lastDepth1);
    });

    test('k at first node does nothing', async ({ page }) => {
      await setupMindmap(page);
      const rootId = await selectRoot(page);
      const children = await debug.nodeChildren(page, rootId);

      // Navigate to first depth-1 node
      await selectNodeById(page, children[0]);

      // Press k — should stay (no previous at this depth)
      await pressKey(page, 'k');
      const sel = await debug.selectedId(page);
      expect(sel).toBe(children[0]);
    });
  });

  // ============================================================
  // Feature 2: Help Modal
  // ============================================================
  test.describe('Help Modal', () => {
    test('? opens help modal', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      // Initially hidden
      const before = await debug.isHelpModalVisible(page);
      expect(before).toBe(false);

      // Press ?
      await pressKey(page, '?');
      await page.waitForTimeout(200);

      const after = await debug.isHelpModalVisible(page);
      expect(after).toBe(true);
    });

    test('? toggles help modal (second press closes)', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      // Open
      await pressKey(page, '?');
      await page.waitForTimeout(200);
      expect(await debug.isHelpModalVisible(page)).toBe(true);

      // Close by pressing ? again — need to focus canvas first
      const canvas = page.locator('canvas.mindmap-canvas');
      await canvas.focus();
      await page.waitForTimeout(50);
      await pressKey(page, '?');
      await page.waitForTimeout(200);
      expect(await debug.isHelpModalVisible(page)).toBe(false);
    });

    test('Escape closes help modal', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      await pressKey(page, '?');
      await page.waitForTimeout(200);
      expect(await debug.isHelpModalVisible(page)).toBe(true);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      expect(await debug.isHelpModalVisible(page)).toBe(false);
    });

    test('Clicking backdrop closes help modal', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      await pressKey(page, '?');
      await page.waitForTimeout(200);
      expect(await debug.isHelpModalVisible(page)).toBe(true);

      // Click backdrop (top-left corner, outside the card)
      await page.click('.mindmap-help-backdrop', { position: { x: 10, y: 10 }, force: true });
      await page.waitForTimeout(200);
      expect(await debug.isHelpModalVisible(page)).toBe(false);
    });

    test('Help modal shows correct content sections', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      await pressKey(page, '?');
      await page.waitForTimeout(200);

      // Check that all sections are present
      const sections = await page.$$eval('.mindmap-help-section h4', els => els.map(e => e.textContent));
      expect(sections).toContain('Navigation');
      expect(sections).toContain('Editing');
      expect(sections).toContain('Undo / Redo');
      expect(sections).toContain('Panels');
    });
  });

  // ============================================================
  // Feature 3: Zen Mode
  // ============================================================
  test.describe('Zen Mode', () => {
    test('Z toggles zen mode on', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      expect(await debug.isZenMode(page)).toBe(false);

      // Press Z (shift+z)
      await pressKey(page, 'Z');
      await page.waitForTimeout(200);

      expect(await debug.isZenMode(page)).toBe(true);
    });

    test('Z again toggles zen mode off', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      // Enter zen
      await pressKey(page, 'Z');
      await page.waitForTimeout(200);
      expect(await debug.isZenMode(page)).toBe(true);

      // Exit zen
      await pressKey(page, 'Z');
      await page.waitForTimeout(200);
      expect(await debug.isZenMode(page)).toBe(false);
    });

    test('Zen mode hides sidebar and right panel', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      await pressKey(page, 'Z');
      await page.waitForTimeout(200);

      // Check sidebar is not visible
      const sidebarVisible = await page.evaluate(() => {
        const el = document.querySelector('.mindmaps-sidebar');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none';
      });
      expect(sidebarVisible).toBe(false);

      // Check right panel is not visible
      const rightPanelVisible = await page.evaluate(() => {
        const el = document.querySelector('.mindmap-right-panel');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none';
      });
      expect(rightPanelVisible).toBe(false);
    });

    test('Zen mode shows indicator', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      await pressKey(page, 'Z');
      await page.waitForTimeout(200);

      const indicatorVisible = await page.evaluate(() => {
        const el = document.querySelector('.zen-mode-indicator');
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none';
      });
      expect(indicatorVisible).toBe(true);
    });

    test('Ctrl+2 in zen mode opens floating note panel', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      await pressKey(page, 'Z');
      await page.waitForTimeout(200);

      // Press Ctrl+2 to open floating note panel
      await page.keyboard.press('Control+2');
      await page.waitForTimeout(200);

      const floatVisible = await page.evaluate(() => {
        const el = document.getElementById('zen-float-note');
        return el && el.classList.contains('visible');
      });
      expect(floatVisible).toBe(true);
    });

    test('Ctrl+3 in zen mode opens floating thinking panel', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      await pressKey(page, 'Z');
      await page.waitForTimeout(200);

      await page.keyboard.press('Control+3');
      await page.waitForTimeout(200);

      const floatVisible = await page.evaluate(() => {
        const el = document.getElementById('zen-float-thinking');
        return el && el.classList.contains('visible');
      });
      expect(floatVisible).toBe(true);
    });

    test('Exiting zen mode closes floating panels', async ({ page }) => {
      await setupMindmap(page);
      await selectRoot(page);

      // Enter zen + open floating panel
      await pressKey(page, 'Z');
      await page.waitForTimeout(200);
      await page.keyboard.press('Control+2');
      await page.waitForTimeout(200);

      // Exit zen
      await pressKey(page, 'Z');
      await page.waitForTimeout(200);

      const floatVisible = await page.evaluate(() => {
        const el = document.getElementById('zen-float-note');
        return el && el.classList.contains('visible');
      });
      expect(floatVisible).toBe(false);
    });
  });
});
