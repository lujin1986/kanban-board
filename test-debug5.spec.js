const { test, expect } = require('@playwright/test');

test('debug selectedId setter trap', async ({ page }) => {
  await page.goto('http://localhost:3000/#mindmaps');
  await page.waitForSelector('#mindmaps-view.active', { timeout: 5000 });
  await page.waitForSelector('.mindmap-list-item', { timeout: 5000 });
  await page.click('.mindmap-list-item');
  await page.waitForSelector('canvas.mindmap-canvas', { timeout: 5000 });
  await page.waitForTimeout(500);

  // Add a property interceptor on selectedId
  await page.evaluate(() => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    window.__selLog = [];
    
    let _selectedId = mi.selectedId;
    Object.defineProperty(mi, 'selectedId', {
      get() { return _selectedId; },
      set(val) {
        window.__selLog.push({ 
          newVal: val, 
          oldVal: _selectedId,
          stack: new Error().stack.split('\n').slice(1, 6).map(s => s.trim())
        });
        _selectedId = val;
      }
    });
  });

  // Select root
  await page.evaluate(() => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    mi.selectNode(mi.root.id);
    window.__selLog = [];
  });
  await page.waitForTimeout(100);

  // ArrowRight
  const canvas = page.locator('canvas.mindmap-canvas');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);

  let log = await page.evaluate(() => window.__selLog);
  console.log('=== After ArrowRight - selectedId changes ===');
  for (const entry of log) {
    console.log(`${entry.oldVal} -> ${entry.newVal}`);
    console.log('  ' + entry.stack.join('\n  '));
  }

  // Clear and press ArrowDown
  await canvas.focus();
  await page.evaluate(() => { window.__selLog = []; });
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);

  log = await page.evaluate(() => window.__selLog);
  console.log('=== After ArrowDown - selectedId changes ===');
  for (const entry of log) {
    console.log(`${entry.oldVal} -> ${entry.newVal}`);
    console.log('  ' + entry.stack.join('\n  '));
  }

  const sel = await page.evaluate(() => window.__mindmapDebug.getSelectedId());
  console.log('Final selectedId (global):', sel);
  const sel2 = await page.evaluate(() => window.__mindmapDebug.getMindmapInstance().selectedId);
  console.log('Final instance.selectedId:', sel2);
});
