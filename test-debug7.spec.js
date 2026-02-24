const { test, expect } = require('@playwright/test');

test('debug nodes map integrity', async ({ page }) => {
  await page.goto('http://localhost:3000/#mindmaps');
  await page.waitForSelector('#mindmaps-view.active', { timeout: 5000 });
  await page.waitForSelector('.mindmap-list-item', { timeout: 5000 });
  await page.click('.mindmap-list-item');
  await page.waitForSelector('canvas.mindmap-canvas', { timeout: 5000 });
  await page.waitForTimeout(500);

  // Dump the nodes map
  const nodesMap = await page.evaluate(() => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    const result = [];
    for (const [key, node] of mi.nodes) {
      result.push({
        mapKey: key,
        nodeId: node.id,
        nodeText: node.text,
        match: key === node.id,
      });
    }
    return result;
  });

  console.log('Nodes map dump:');
  for (const entry of nodesMap) {
    const status = entry.match ? '✓' : '✗ MISMATCH!';
    console.log(`  ${status} key="${entry.mapKey}" node.id="${entry.nodeId}" text="${entry.nodeText}"`);
  }
});
