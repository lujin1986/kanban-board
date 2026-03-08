// Playwright: Strategy Map node click opens matching Kanban task modal (Phase 1)
const { test, expect } = require('@playwright/test');

test('Strategy Map node click opens task modal (hex match)', async ({ page, request }) => {
  // Create a unique task we can safely match.
  const title = `StrategyMap Click Test ${Date.now()}`;
  const created = await request.post('/api/tasks', {
    data: {
      title,
      description: 'e2e test: strategy map node click',
      checklist_text: '',
      assignee: 'Jin',
      priority: 'low',
      status: 'backlog',
      actor: 'Jin'
    }
  });
  expect(created.ok()).toBeTruthy();
  const task = await created.json();
  expect(task?.id).toBeTruthy();
  expect(task?.hex_id).toBeTruthy();

  // Snapshot current strategy-map content so the test is non-destructive.
  const prevRes = await request.get('/api/strategy-map');
  expect(prevRes.ok()).toBeTruthy();
  const prev = await prevRes.json();

  try {
    const markdown = [
      '# Strategy Map',
      '## Phase 1 Click Test',
      `- #${task.hex_id} ${title}`
    ].join('\n');

    const put = await request.put('/api/strategy-map', {
      data: { content: markdown, actor: 'Jin' }
    });
    expect(put.ok()).toBeTruthy();

    await page.goto('/#strategy');
    await page.waitForSelector('#strategy-view.active', { timeout: 5000 });

    // Wait for markmap to render the node label we inserted.
    const nodeLabel = page.locator('#markmap-svg foreignObject', { hasText: title }).first();
    await expect(nodeLabel).toBeVisible({ timeout: 5000 });

    await nodeLabel.click();

    // Modal should open and show the task hex id.
    await expect(page.locator('#task-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#modal-title')).toContainText(`#${task.hex_id}`);
  } finally {
    // Restore strategy map and delete the task we created.
    await request.put('/api/strategy-map', {
      data: { content: prev?.content || '', description: prev?.description || '', actor: 'Jin' }
    }).catch(() => {});
    await request.delete(`/api/tasks/${task.id}`, {
      data: { actor: 'Jin' }
    }).catch(() => {});
  }
});

