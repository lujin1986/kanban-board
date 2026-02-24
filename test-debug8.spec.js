const { test, expect } = require('@playwright/test');

test('debug Ctrl+R redo', async ({ page }) => {
  await page.goto('http://localhost:3000/#mindmaps');
  await page.waitForSelector('#mindmaps-view.active', { timeout: 5000 });
  await page.waitForSelector('.mindmap-list-item', { timeout: 5000 });
  await page.click('.mindmap-list-item');
  await page.waitForSelector('canvas.mindmap-canvas', { timeout: 5000 });
  await page.waitForTimeout(500);

  // Select root
  await page.evaluate(() => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    mi.selectNode(mi.root.id);
  });
  await page.waitForTimeout(100);

  const canvas = page.locator('canvas.mindmap-canvas');
  await canvas.focus();

  const nodeCountOriginal = await page.evaluate(() => window.__mindmapDebug.getNodeCount());
  console.log('Original node count:', nodeCountOriginal);

  // Add a child (Tab)
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);

  const nodeCountAfterAdd = await page.evaluate(() => window.__mindmapDebug.getNodeCount());
  console.log('After adding child:', nodeCountAfterAdd);

  // Focus canvas, then undo
  await canvas.focus();
  await page.waitForTimeout(100);
  await page.keyboard.press('u');
  await page.waitForTimeout(300);

  const nodeCountAfterUndo = await page.evaluate(() => window.__mindmapDebug.getNodeCount());
  console.log('After undo:', nodeCountAfterUndo);

  // Check selection state after undo
  const selAfterUndo = await page.evaluate(() => ({
    global: window.__mindmapDebug.getSelectedId(),
    instance: window.__mindmapDebug.getMindmapInstance().selectedId,
    redoLen: window.__mindmapDebug.getRedoStackLength(),
  }));
  console.log('State after undo:', JSON.stringify(selAfterUndo));

  // Now try Ctrl+R
  await canvas.focus();
  await page.waitForTimeout(100);
  
  // Log the keydown event
  await page.evaluate(() => {
    window.__keyLog = [];
    const mi = window.__mindmapDebug.getMindmapInstance();
    const orig = mi._onKeyDown.bind(mi);
    mi._onKeyDown = (e) => {
      window.__keyLog.push({ key: e.key, ctrlKey: e.ctrlKey });
      orig(e);
    };
  });

  await page.keyboard.press('Control+r');
  await page.waitForTimeout(300);

  const keyLog = await page.evaluate(() => window.__keyLog);
  console.log('Key events received:', JSON.stringify(keyLog));

  const nodeCountAfterRedo = await page.evaluate(() => window.__mindmapDebug.getNodeCount());
  console.log('After Ctrl+R redo:', nodeCountAfterRedo);
});
