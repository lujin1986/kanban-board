const { test, expect } = require('@playwright/test');

test('debug onNodeSelected trap', async ({ page }) => {
  // Capture ALL console logs
  page.on('console', msg => {
    if (msg.text().startsWith('[TRAP]')) {
      console.log(msg.text());
    }
  });

  await page.goto('http://localhost:3000/#mindmaps');
  await page.waitForSelector('#mindmaps-view.active', { timeout: 5000 });
  await page.waitForSelector('.mindmap-list-item', { timeout: 5000 });
  await page.click('.mindmap-list-item');
  await page.waitForSelector('canvas.mindmap-canvas', { timeout: 5000 });
  await page.waitForTimeout(500);

  // Intercept the mindmap-node-selected event
  await page.evaluate(() => {
    window.addEventListener('mindmap-node-selected', (e) => {
      const node = e.detail?.node;
      console.log(`[TRAP] mindmap-node-selected: node.id=${node?.id}, node.text=${node?.text}, stack=${new Error().stack.split('\n').slice(1,5).join(' | ')}`);
    }, true); // capture phase, before the actual handler
  });

  // Select root
  await page.evaluate(() => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    mi.selectNode(mi.root.id);
  });
  await page.waitForTimeout(200);

  // ArrowRight
  const canvas = page.locator('canvas.mindmap-canvas');
  await canvas.focus();
  console.log('--- Pressing ArrowRight ---');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);

  let sel = await page.evaluate(() => window.__mindmapDebug.getSelectedId());
  console.log('Global selectedNodeId after ArrowRight:', sel);

  // ArrowDown
  await canvas.focus();
  console.log('--- Pressing ArrowDown ---');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);

  sel = await page.evaluate(() => window.__mindmapDebug.getSelectedId());
  console.log('Global selectedNodeId after ArrowDown:', sel);
  
  const instSel = await page.evaluate(() => window.__mindmapDebug.getMindmapInstance().selectedId);
  console.log('Instance selectedId after ArrowDown:', instSel);
});
