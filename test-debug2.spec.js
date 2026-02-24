const { test, expect } = require('@playwright/test');

test('debug navigation detailed', async ({ page }) => {
  await page.goto('http://localhost:3000/#mindmaps');
  await page.waitForSelector('#mindmaps-view.active', { timeout: 5000 });
  await page.waitForSelector('.mindmap-list-item', { timeout: 5000 });
  await page.click('.mindmap-list-item');
  await page.waitForSelector('canvas.mindmap-canvas', { timeout: 5000 });
  await page.waitForTimeout(500);

  // Select root via evaluate
  await page.evaluate(() => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    mi.selectNode(mi.root.id);
  });
  await page.waitForTimeout(100);

  // Press ArrowRight to go to node_1
  const canvas = page.locator('canvas.mindmap-canvas');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);

  let sel = await page.evaluate(() => window.__mindmapDebug.getSelectedId());
  console.log('After ArrowRight:', sel);

  // Check node_1's parent info before pressing ArrowDown
  const parentInfo = await page.evaluate((id) => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    const node = mi.nodes.get(id);
    if (!node) return 'node not found';
    if (!node.parent) return 'no parent';
    return {
      selfId: node.id,
      selfText: node.text,
      parentId: node.parent.id,
      parentText: node.parent.text,
      parentChildren: node.parent.children.map(c => c.id),
      selfIndexInParent: node.parent.children.indexOf(node),
      parentChildrenLength: node.parent.children.length,
    };
  }, sel);
  console.log('Node parent info:', JSON.stringify(parentInfo, null, 2));

  // Now, let's manually test _navigateDown
  const manualResult = await page.evaluate((id) => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    const node = mi.nodes.get(id);
    if (!node || !node.parent) return 'no parent';
    const siblings = node.parent.children;
    const idx = siblings.indexOf(node);
    return {
      idx,
      siblingsLength: siblings.length,
      canGoDown: idx < siblings.length - 1,
      nextSiblingId: idx < siblings.length - 1 ? siblings[idx + 1].id : null,
    };
  }, sel);
  console.log('Manual navigate check:', JSON.stringify(manualResult, null, 2));

  // Now actually press ArrowDown  
  await canvas.focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);

  sel = await page.evaluate(() => window.__mindmapDebug.getSelectedId());
  console.log('After ArrowDown:', sel);
});
