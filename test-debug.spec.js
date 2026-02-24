const { test, expect } = require('@playwright/test');

test('debug navigation', async ({ page }) => {
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

  let sel = await page.evaluate(() => window.__mindmapDebug.getSelectedId());
  console.log('After selecting root:', sel);
  
  const rootChildren = await page.evaluate(() => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    return mi.root.children.map(c => ({ id: c.id, text: c.text }));
  });
  console.log('Root children:', JSON.stringify(rootChildren));

  // Press ArrowRight
  const canvas = page.locator('canvas.mindmap-canvas');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);

  sel = await page.evaluate(() => window.__mindmapDebug.getSelectedId());
  console.log('After ArrowRight:', sel);

  // Now press ArrowDown
  await canvas.focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);

  sel = await page.evaluate(() => window.__mindmapDebug.getSelectedId());
  console.log('After ArrowDown:', sel);

  // Debug: what node is this and what are its siblings?
  const info = await page.evaluate((id) => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    const node = mi.nodes.get(id);
    if (!node) return { error: 'not found' };
    return {
      id: node.id,
      text: node.text,
      parentId: node.parent?.id,
      parentText: node.parent?.text,
      siblings: node.parent?.children.map(c => ({ id: c.id, text: c.text })) || [],
    };
  }, sel);
  console.log('Current node info:', JSON.stringify(info, null, 2));
});
