const { test, expect } = require('@playwright/test');

test('debug ArrowDown event tracing', async ({ page }) => {
  await page.goto('http://localhost:3000/#mindmaps');
  await page.waitForSelector('#mindmaps-view.active', { timeout: 5000 });
  await page.waitForSelector('.mindmap-list-item', { timeout: 5000 });
  await page.click('.mindmap-list-item');
  await page.waitForSelector('canvas.mindmap-canvas', { timeout: 5000 });
  await page.waitForTimeout(500);

  // Monkey-patch _navigateDown to log when it's called
  await page.evaluate(() => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    window.__navLog = [];
    
    const origDown = mi._navigateDown.bind(mi);
    const origRight = mi._navigateRight.bind(mi);
    const origUp = mi._navigateUp.bind(mi);
    const origLeft = mi._navigateLeft.bind(mi);
    const origSelectNode = mi.selectNode.bind(mi);
    
    mi._navigateDown = (node) => {
      window.__navLog.push({ fn: 'navigateDown', nodeId: node?.id, nodeText: node?.text });
      origDown(node);
    };
    mi._navigateRight = (node) => {
      window.__navLog.push({ fn: 'navigateRight', nodeId: node?.id, nodeText: node?.text });
      origRight(node);
    };
    mi._navigateUp = (node) => {
      window.__navLog.push({ fn: 'navigateUp', nodeId: node?.id, nodeText: node?.text });
      origUp(node);
    };
    mi._navigateLeft = (node) => {
      window.__navLog.push({ fn: 'navigateLeft', nodeId: node?.id, nodeText: node?.text });
      origLeft(node);
    };
    mi.selectNode = (id) => {
      window.__navLog.push({ fn: 'selectNode', id });
      origSelectNode(id);
    };
  });

  // Select root
  await page.evaluate(() => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    mi.selectNode(mi.root.id);
    window.__navLog = []; // clear log after initial select
  });
  await page.waitForTimeout(100);

  // Press ArrowRight
  const canvas = page.locator('canvas.mindmap-canvas');
  await canvas.focus();
  
  await page.evaluate(() => { window.__navLog = []; });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  
  let log = await page.evaluate(() => window.__navLog);
  console.log('After ArrowRight log:', JSON.stringify(log, null, 2));
  let sel = await page.evaluate(() => window.__mindmapDebug.getSelectedId());
  console.log('Selected after ArrowRight:', sel);
  
  // Now press ArrowDown
  await canvas.focus();
  await page.evaluate(() => { window.__navLog = []; });
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  
  log = await page.evaluate(() => window.__navLog);
  console.log('After ArrowDown log:', JSON.stringify(log, null, 2));
  sel = await page.evaluate(() => window.__mindmapDebug.getSelectedId());
  console.log('Selected after ArrowDown:', sel);
});
