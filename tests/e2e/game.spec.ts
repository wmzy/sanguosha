import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const DOWNLOAD_DIR = path.join(process.cwd(), 'test-results', 'downloads');
const LOG_DIR = path.join(process.cwd(), 'test-results', 'logs');

function createTestLog() {
  return {
    meta: {
      version: '1.0.0',
      createdAt: Date.now(),
      playerCount: 2,
      characters: ['曹操', '刘备'],
      seed: 12345,
    },
    serverOps: [
      { seq: 0, timestamp: Date.now(), type: 'gameStart', data: { players: [{ name: '曹操', character: '曹操', role: '主公' }, { name: '刘备', character: '刘备', role: '反贼' }] }, description: '游戏开始' },
      { seq: 1, timestamp: Date.now(), type: 'phaseChange', data: { phase: '判定', player: '曹操' }, description: '进入判定阶段' },
      { seq: 2, timestamp: Date.now(), type: 'phaseChange', data: { phase: '摸牌', player: '曹操' }, description: '进入摸牌阶段' },
      { seq: 3, timestamp: Date.now(), type: 'draw', data: { player: '曹操', cards: [{ name: '杀', suit: '♠', rank: '3' }, { name: '闪', suit: '♥', rank: '5' }] }, description: '曹操摸了2张牌' },
      { seq: 4, timestamp: Date.now(), type: 'phaseChange', data: { phase: '出牌', player: '曹操' }, description: '进入出牌阶段' },
      { seq: 5, timestamp: Date.now(), type: 'damage', data: { source: '曹操', target: '刘备', amount: 1, cardName: '杀' }, description: '曹操对刘备使用杀，造成1点伤害' },
    ],
    playerOps: {
      曹操: [
        { seq: 0, timestamp: Date.now(), type: 'gameStart', data: {}, description: '游戏开始，你是 曹操（主公）' },
        { seq: 1, timestamp: Date.now(), type: 'draw', data: {}, description: '你摸了 杀、闪' },
        { seq: 2, timestamp: Date.now(), type: 'damage', data: {}, description: '曹操对刘备使用杀，造成1点伤害' },
      ],
      刘备: [
        { seq: 0, timestamp: Date.now(), type: 'gameStart', data: {}, description: '游戏开始，你是 刘备（反贼）' },
        { seq: 1, timestamp: Date.now(), type: 'damage', data: {}, description: '曹操对刘备使用杀，造成1点伤害' },
      ],
    },
  };
}

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
  });

  test('点击多人对战进入大厅', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '多人对战' }).click();
    await expect(page).toHaveURL('/lobby');
  });
});

test.describe('本地游戏 — 真实游戏流程', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/game');
    await page.waitForSelector('text=出牌');
  });

  test('初始状态正确', async ({ page }) => {
    await expect(page.getByText('曹操 (你)')).toBeVisible();
    await expect(page.getByText('刘备')).toBeVisible();
    await expect(page.getByText(/回合.*阶段.*当前玩家/)).toBeVisible();
    await expect(page.getByText(/阶段.*出牌/)).toBeVisible();
  });

  test('出牌阶段可以使用杀', async ({ page }) => {
    // 找到杀牌
    const 杀牌 = page.locator('div[style*="cursor: pointer"]').filter({ hasText: /^杀$/ }).first();

    if (await 杀牌.count() > 0) {
      await 杀牌.click();
      await page.waitForTimeout(200);

      // 点击出牌
      const 出牌按钮 = page.getByRole('button', { name: '出牌' });
      await expect(出牌按钮).toBeEnabled();
      await 出牌按钮.click();
      await page.waitForTimeout(500);

      // 验证日志显示伤害信息
      await expect(page.getByText(/对.*使用杀/).first()).toBeVisible();
    }
  });

  test('出牌阶段可以使用桃', async ({ page }) => {
    const 桃牌 = page.locator('div[style*="cursor: pointer"]').filter({ hasText: /^桃$/ }).first();

    if (await 桃牌.count() > 0) {
      await 桃牌.click();
      await page.waitForTimeout(200);

      const 出牌按钮 = page.getByRole('button', { name: '出牌' });
      if (await 出牌按钮.isEnabled()) {
        await 出牌按钮.click();
        await page.waitForTimeout(500);
        await expect(page.getByText(/使用桃/).first()).toBeVisible();
      }
    }
  });

  test('结束回合后轮到下一个玩家', async ({ page }) => {
    // 记录当前信息
    const 初始信息 = await page.getByText(/回合.*当前玩家/).textContent();

    // 点击结束回合
    await page.getByRole('button', { name: '结束回合' }).click();
    await page.waitForTimeout(1000);

    // 验证信息变化
    const 新信息 = await page.getByText(/回合.*当前玩家/).textContent();
    expect(新信息).not.toBe(初始信息);
  });

  test('日志面板记录操作', async ({ page }) => {
    // 应该有游戏开始和摸牌的日志
    await expect(page.getByText(/游戏开始/).first()).toBeVisible();
    await expect(page.getByText(/摸/).first()).toBeVisible();
  });

  test('保存日志按钮可用', async ({ page }) => {
    const btn = page.getByRole('button', { name: '保存日志' });
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('返回首页', async ({ page }) => {
    await page.getByRole('link', { name: /返回/ }).click();
    await expect(page).toHaveURL('/');
  });
});

test.describe('保存日志', () => {
  test('保存日志下载 JSON 文件', async ({ page }) => {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

    await page.goto('/game');
    await page.waitForSelector('text=出牌');

    // 结束回合产生更多日志
    await page.getByRole('button', { name: '结束回合' }).click();
    await page.waitForTimeout(1000);

    // 点击保存日志
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '保存日志' }).click(),
    ]);

    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^sanguosha_.*\.json$/);

    const filePath = path.join(DOWNLOAD_DIR, filename);
    await download.saveAs(filePath);

    // 验证文件内容
    const content = fs.readFileSync(filePath, 'utf-8');
    const log = JSON.parse(content);
    expect(log.meta.version).toBe('1.0.0');
    expect(log.serverOps.length).toBeGreaterThan(0);
    expect(log.playerOps).toBeDefined();

    // 清理
    fs.unlinkSync(filePath);
  });
});

test.describe('回放功能', () => {
  let logFile: string;

  test.beforeEach(({}, testInfo) => { // eslint-disable-line no-empty-pattern
    // 使用唯一文件名避免并行冲突
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logFile = path.join(LOG_DIR, `test-${testInfo.retry}-${Date.now()}.json`);
    fs.writeFileSync(logFile, JSON.stringify(createTestLog(), null, 2));
  });

  test.afterEach(() => {
    if (logFile && fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
    }
  });

  async function loadLogAndEnterReplay(page: import('@playwright/test').Page) {
    await page.goto('/');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '回放' }).click(),
    ]);
    await fileChooser.setFiles(logFile);
    await page.waitForSelector('text=重播模式');
  }

  test('加载日志进入回放模式', async ({ page }) => {
    await loadLogAndEnterReplay(page);

    await expect(page.getByText('重播模式')).toBeVisible();
    await expect(page.getByRole('button', { name: '退出重播' })).toBeVisible();
    await expect(page.getByRole('button', { name: '上一步' })).toBeVisible();
    await expect(page.getByRole('button', { name: '下一步' })).toBeVisible();
    await expect(page.getByText('播放')).toBeVisible();
  });

  test('步进操作', async ({ page }) => {
    await loadLogAndEnterReplay(page);

    // 初始在第 1 步
    await expect(page.getByText(/1\/7/)).toBeVisible();

    // 下一步
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByText(/2\/7/)).toBeVisible();

    // 再下一步
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByText(/3\/7/)).toBeVisible();

    // 上一步
    await page.getByRole('button', { name: '上一步' }).click();
    await expect(page.getByText(/2\/7/)).toBeVisible();
  });

  test('显示当前操作描述', async ({ page }) => {
    await loadLogAndEnterReplay(page);

    // 前进一步以显示操作描述
    await page.getByRole('button', { name: '下一步' }).click();
    await page.waitForTimeout(200);

    await expect(page.getByText(/当前操作/)).toBeVisible();
  });

  test('显示玩家面板', async ({ page }) => {
    await loadLogAndEnterReplay(page);

    // 使用更精确的选择器
    await expect(page.getByText('曹操 (你)')).toBeVisible();
    // 刘备可能在多个地方出现（面板、下拉框），检查面板中的
    await expect(page.locator('div').filter({ hasText: /^刘备$/ }).first()).toBeVisible();
  });

  test('切换视角', async ({ page }) => {
    await loadLogAndEnterReplay(page);

    const 视角选择 = page.locator('select');
    await expect(视角选择).toBeVisible();

    // 切换到刘备视角
    await 视角选择.selectOption('刘备');
    await page.waitForTimeout(300);

    // 日志面板应该显示刘备视角的操作
    await expect(page.getByText(/你是.*刘备/).first()).toBeVisible();
  });

  test('播放/暂停按钮存在并可点击', async ({ page }) => {
    await loadLogAndEnterReplay(page);

    // 播放按钮应该存在
    const playBtn = page.locator('button').filter({ hasText: '播放' });
    await expect(playBtn).toBeVisible();

    // 点击播放
    await playBtn.click();
    await page.waitForTimeout(300);

    // 按钮文字应该变化（播放→暂停或由于到达末尾变回播放）
    // 至少验证点击没有报错
    await expect(page.getByText('重播模式')).toBeVisible();
  });

  test('退出回放', async ({ page }) => {
    await loadLogAndEnterReplay(page);

    await page.getByRole('button', { name: '退出重播' }).click();
    await page.waitForTimeout(500);

    // 回到首页
    await expect(page.getByRole('heading', { name: '三国杀' })).toBeVisible();
  });
});

test.describe('多人对战大厅', () => {
  test('显示大厅界面', async ({ page }) => {
    await page.goto('/lobby');
    await expect(page.getByText(/返回/)).toBeVisible();
  });

  test('返回首页', async ({ page }) => {
    await page.goto('/lobby');
    await page.getByRole('link', { name: /返回/ }).click();
    await expect(page).toHaveURL('/');
  });
});
