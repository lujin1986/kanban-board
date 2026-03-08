const { test, expect } = require('@playwright/test');

test('Goals markdown persists after Save + reload (stress)', async ({ page, request }) => {
  // Backup existing goals so we can restore them after the test.
  const beforeRes = await request.get('/api/goals');
  expect(beforeRes.ok()).toBeTruthy();
  const before = await beforeRes.json();
  const originalContent = before?.content ?? '';

  try {
    // Repeat to catch timing/race flakes.
    for (let i = 0; i < 10; i++) {
      const marker = `## Playwright Goals Persistence Test\n\n- iteration: ${i}\n- ts: ${Date.now()}\n`;

      // Go directly to Goals. Click Edit immediately (before waiting for any async load)
      // to reproduce the historical race.
      await page.goto('/#goals');
      await page.locator('#edit-goals-btn').click();

      const editor = page.locator('#goals-editor');
      await expect(editor).toBeVisible();
      await editor.fill(marker);

      await page.locator('#save-goals-btn').click();

      const pre = page.locator('#goals-display .goals-pre');
      await expect(pre).toContainText('Playwright Goals Persistence Test');
      await expect(pre).toContainText(`iteration: ${i}`);

      // Navigate away and back, and reload the whole page.
      await page.locator('a.nav-link[data-view="board"]').click();
      await expect(page.locator('#board-view')).toHaveClass(/active/);

      await page.reload();

      // Use the in-app navigation (the app does not listen to hashchange events).
      await page.locator('a.nav-link[data-view="goals"]').click();
      await page.waitForSelector('#goals-view.active', { timeout: 5000 });
      const pre2 = page.locator('#goals-display .goals-pre');
      await expect(pre2).toBeVisible();
      await expect(pre2).toContainText(`iteration: ${i}`);

      // Also assert the editor gets the persisted content.
      await page.locator('#edit-goals-btn').click();
      await expect(page.locator('#goals-editor')).toHaveValue(marker);

      // Return to display mode to keep iteration consistent.
      await page.locator('#cancel-goals-btn').click();
    }
  } finally {
    // Restore original goals content (best-effort).
    await request.put('/api/goals', {
      data: { content: originalContent, actor: 'Jin' },
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
