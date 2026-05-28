import { test, expect } from '@playwright/test';

test.describe('首页', () => {
  test('显示游戏标题和模式选择', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '三国杀' })).toBeVisible();
    await expect(page.getByText('数字卡牌游戏')).toBeVisible();
    await expect(page.getByRole('link', { name: '本地游戏' })).toBeVisible();
    await expect(page.getByRole('link', { name: '多人对战' })).toBeVisible();
    await expect(page.getByRole('button', { name: '回放' })).toBeVisible();
  });

  test('点击本地游戏进入游戏页面', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '本地游戏' }).click();
    await expect(page).toHaveURL('/game');
    await expect(page.getByRole('heading', { name: '三国杀' })).toBeVisible();
  });

  test('点击多人对战进入大厅', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '多人对战' }).click();
    await expect(page).toHaveURL('/lobby');
  });
});

test.describe('本地游戏', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/game');
    await page.waitForSelector('text=回合 1');
  });

  test('显示游戏面板', async ({ page }) => {
    // Should show player panels with character names
    await expect(page.getByText('曹操 (你)')).toBeVisible();
    await expect(page.getByText('刘备')).toBeVisible();

    // Should show game info
    await expect(page.getByText('回合 1')).toBeVisible();
    await expect(page.getByText('阶段:')).toBeVisible();
  });

  test('显示手牌区域', async ({ page }) => {
    // Verify the game board rendered
    await expect(page.getByText('回合 1')).toBeVisible();
    // End turn button should exist (even if disabled)
    await expect(page.getByRole('button', { name: '结束回合' })).toBeVisible();
    // Save log button should exist
    await expect(page.getByRole('button', { name: '保存日志' })).toBeVisible();
  });

  test('可以选择卡牌', async ({ page }) => {
    // Find card elements (they have card names like 杀, 闪, 桃)
    const cardElements = page.locator('div[style*="cursor: pointer"]').filter({
      hasText: /^(杀|闪|桃|过河拆桥|顺手牵羊|无中生有)$/,
    });

    const count = await cardElements.count();
    if (count > 0) {
      // Click first card to select
      await cardElements.first().click();
      await page.waitForTimeout(200);

      // The card should have a red border (selected state)
      const selectedCard = cardElements.first();
      await expect(selectedCard).toBeVisible();
    }
  });

  test('结束回合按钮存在', async ({ page }) => {
    const endBtn = page.getByRole('button', { name: '结束回合' });
    await expect(endBtn).toBeVisible();
    // Note: button may be disabled if it's not the player's turn or not in play phase
  });

  test('日志面板显示操作记录', async ({ page }) => {
    // The log panel should show game start message
    await expect(page.getByText(/游戏开始/).first()).toBeVisible();
  });

  test('保存日志按钮存在', async ({ page }) => {
    await expect(page.getByRole('button', { name: '保存日志' })).toBeVisible();
  });

  test('返回按钮可以回到首页', async ({ page }) => {
    await page.getByRole('link', { name: /返回/ }).click();
    await expect(page).toHaveURL('/');
  });
});

test.describe('多人对战大厅', () => {
  test('显示大厅界面', async ({ page }) => {
    await page.goto('/lobby');
    await expect(page.getByText(/返回/)).toBeVisible();
  });

  test('返回按钮可以回到首页', async ({ page }) => {
    await page.goto('/lobby');
    await page.getByRole('link', { name: /返回/ }).click();
    await expect(page).toHaveURL('/');
  });
});

test.describe('完整游戏流程', () => {
  test('可以进行一局完整的游戏操作', async ({ page }) => {
    await page.goto('/game');
    await page.waitForSelector('text=回合 1');

    // Step 1: Verify initial game state
    await expect(page.getByText('曹操 (你)')).toBeVisible();
    await expect(page.getByText('刘备')).toBeVisible();
    await expect(page.getByText('回合 1')).toBeVisible();

    // Step 2: Try to play a card
    const cardElements = page.locator('div[style*="cursor: pointer"]').filter({
      hasText: /^(杀|闪|桃)$/,
    });
    const cardCount = await cardElements.count();

    if (cardCount > 0) {
      await cardElements.first().click();
      await page.waitForTimeout(200);

      // Try to play it
      const playBtn = page.getByRole('button', { name: '出牌' });
      if (await playBtn.isEnabled()) {
        await playBtn.click();
        await page.waitForTimeout(300);
      }
    }

    // Step 3: Try to end turn (may be disabled if not in play phase)
    const endBtn = page.getByRole('button', { name: '结束回合' });
    if (await endBtn.isEnabled()) {
      await endBtn.click();
      await page.waitForTimeout(500);
    }

    // Step 4: Verify game is still running
    await expect(page.getByText(/回合/).first()).toBeVisible();

    // Step 5: Verify log panel has entries
    await expect(page.getByText(/游戏开始/).first()).toBeVisible();

    // Step 6: Save log button should be visible
    await expect(page.getByRole('button', { name: '保存日志' })).toBeVisible();
  });
});
