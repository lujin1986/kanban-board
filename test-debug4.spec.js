const { test, expect } = require('@playwright/test');

test('debug selectNode trace', async ({ page }) => {
  await page.goto('http://localhost:3000/#mindmaps');
  await page.waitForSelector('#mindmaps-view.active', { timeout: 5000 });
  await page.waitForSelector('.mindmap-list-item', { timeout: 5000 });
  await page.click('.mindmap-list-item');
  await page.waitForSelector('canvas.mindmap-canvas', { timeout: 5000 });
  await page.waitForTimeout(500);

  // Trace ALL calls to selectNode AND all keydown events  
  await page.evaluate(() => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    window.__traceLog = [];
    
    // Trace keydown on canvas
    mi.canvas.addEventListener('keydown', (e) => {
      window.__traceLog.push({ event: 'canvas-keydown', key: e.key, code: e.code });
    }, true); // capture phase, before the handler
    
    // Trace keydown on document
    document.addEventListener('keydown', (e) => {
      window.__traceLog.push({ event: 'document-keydown', key: e.key, code: e.code, target: e.target.tagName });
    }, true);
    
    // Trace selectNode
    const origSelectNode = mi.selectNode.bind(mi);
    mi.selectNode = (id) => {
      window.__traceLog.push({ fn: 'selectNode', id, stack: new Error().stack.split('\n').slice(1, 5).map(s => s.trim()) });
      origSelectNode(id);
    };
    
    // Trace _onKeyDown
    const origOnKeyDown = mi._onKeyDown.bind(mi);
    mi._onKeyDown = (e) => {
      window.__traceLog.push({ fn: '_onKeyDown', key: e.key, selectedId: mi.selectedId });
      origOnKeyDown(e);
    };
  });

  // Select root
  await page.evaluate(() => {
    const mi = window.__mindmapDebug.getMindmapInstance();
    mi.selectNode(mi.root.id);
    window.__traceLog = [];
  });
  await page.waitForTimeout(100);

  // ArrowRight first
  const canvas = page.locator('canvas.mindmap-canvas');
  await canvas.focus();
  await page.evaluate(() => { window.__traceLog = []; });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);

  let log = await page.evaluate(() => window.__traceLog);
  console.log('=== ArrowRight trace ===');
  for (const entry of log) {
    if (entry.stack) {
      console.log(JSON.stringify({ ...entry, stack: entry.stack.join(' | ') }));
    } else {
      console.log(JSON.stringify(entry));
    }
  }

  // ArrowDown
  await canvas.focus();
  await page.evaluate(() => { window.__traceLog = []; });
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);

  log = await page.evaluate(() => window.__traceLog);
  console.log('=== ArrowDown trace ===');
  for (const entry of log) {
    if (entry.stack) {
      console.log(JSON.stringify({ ...entry, stack: entry.stack.join(' | ') }));
    } else {
      console.log(JSON.stringify(entry));
    }
  }

  const sel = await page.evaluate(() => window.__mindmapDebug.getSelectedId());
  console.log('Final selected:', sel);
});
