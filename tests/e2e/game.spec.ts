import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import type { ReplayFile } from '../../src/client/replay/types';

const DOWNLOAD_DIR = path.join(process.cwd(), 'test-results', 'downloads');
const LOG_DIR = path.join(process.cwd(), 'test-results', 'logs');

function createTestReplayFile(): ReplayFile {
  const baseView = {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌' as const,
    turn: { round: 1, phase: '出牌' as const, vars: {} },
    players: [
      {
        index: 0,
        name: '曹操',
        character: '曹操',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 2,
        marks: [],
        identity: '主公',
      },
      {
        index: 1,
        name: '刘备',
        character: '刘备',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 2,
        marks: [],
        identity: '反贼',
        identityHidden: true,
      },
    ],
    cardMap: {},
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    settlementStack: [],
  };

  const events = [
    { seq: 0, time: 1000, event: { type: '回合开始', player: 0, round: 1 } },
    { seq: 1, time: 1001, event: { type: '阶段开始', player: 0, phase: '摸牌' } },
    { seq: 2, time: 1002, event: { type: '摸牌', player: 0, count: 2 } },
    { seq: 3, time: 1003, event: { type: '阶段结束', player: 0, phase: '摸牌' } },
    { seq: 4, time: 1004, event: { type: '阶段开始', player: 0, phase: '出牌' } },
    { seq: 5, time: 1005, event: { type: '造成伤害', target: 1, amount: 1, source: 0 } },
    { seq: 6, time: 1006, event: { type: '阶段结束', player: 0, phase: '出牌' } },
  ];

  return {
    format: 'sanguosha-replay',
    version: 1,
    meta: { createdAt: Date.now(), playerCount: 2, characters: ['曹操', '刘备'] },
    seats: {
      0: { seatIndex: 0, playerName: '曹操', initialView: baseView, events },
      1: {
        seatIndex: 1,
        playerName: '刘备',
        initialView: { ...baseView, viewer: 1 },
        events,
      },
    },
  };
}

test.describe('首页', () => {
  test('显示游戏标题和模式选择', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '三国杀' })).toBeVisible();
    await expect(page.getByText('数字卡牌游戏')).toBeVisible();
    await expect(page.getByRole('link', { name: '调试游戏' })).toBeVisible();
    await expect(page.getByRole('link', { name: '多人对战' })).toBeVisible();
    await expect(page.getByRole('button', { name: '回放' })).toBeVisible();
  });

  test('点击调试游戏进入游戏页面', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '调试游戏' }).click();
    await expect(page).toHaveURL('/game');
  });

  test('点击多人对战进入大厅', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '多人对战' }).click();
    await expect(page).toHaveURL('/lobby');
  });
});

test.describe('调试游戏 — 真实游戏流程', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/game');
    await page.waitForSelector('text=出牌');
  });

  test('初始状态正确', async ({ page }) => {
    await expect(page.getByText('曹操 (你)')).toBeVisible();
    await expect(page.getByText(/回合.*阶段/)).toBeVisible();
    await expect(page.getByRole('button', { name: '结束回合' })).toBeVisible();
  });

  test('出牌阶段可以使用杀', async ({ page }) => {
    // 找到杀牌
    const 杀牌 = page.locator('div[style*="cursor: pointer"]').filter({ hasText: /^杀$/ }).first();

    if ((await 杀牌.count()) > 0) {
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

    if ((await 桃牌.count()) > 0) {
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
    // 应该有操作日志
    await expect(page.getByText('保存日志')).toBeVisible();
    // 日志面板应该存在（通过折叠面板的标题判断）
    await expect(page.getByText('调试信息')).toBeVisible();
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

  test.beforeEach((_fixtures, testInfo) => {
    // 使用唯一文件名避免并行冲突
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logFile = path.join(LOG_DIR, `test-${testInfo.retry}-${Date.now()}.json`);
    fs.writeFileSync(logFile, JSON.stringify(createTestReplayFile(), null, 2));
  });

  test.afterEach(() => {
    if (logFile && fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
    }
  });

  async function loadReplayAndEnter(page: import('@playwright/test').Page) {
    await page.goto('/');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '加载录像回放' }).click(),
    ]);
    await fileChooser.setFiles(logFile);
    await page.waitForSelector('text=重播模式');
  }

  test('加载录像进入回放模式', async ({ page }) => {
    await loadReplayAndEnter(page);

    await expect(page.getByText('重播模式')).toBeVisible();
    await expect(page.getByRole('button', { name: '退出重播' })).toBeVisible();
    await expect(page.getByRole('button', { name: '上一步' })).toBeVisible();
    await expect(page.getByRole('button', { name: '下一步' })).toBeVisible();
    await expect(page.getByText('播放')).toBeVisible();
  });

  test('步进操作', async ({ page }) => {
    await loadReplayAndEnter(page);

    // 初始在第 0 步
    await expect(page.getByText(/0 \/ 7/)).toBeVisible();

    // 下一步
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByText(/1 \/ 7/)).toBeVisible();

    // 再下一步
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByText(/2 \/ 7/)).toBeVisible();

    // 上一步
    await page.getByRole('button', { name: '上一步' }).click();
    await expect(page.getByText(/1 \/ 7/)).toBeVisible();
  });

  test('显示玩家面板', async ({ page }) => {
    await loadReplayAndEnter(page);

    // 回放视图应渲染玩家(曹操和刘备)
    await expect(page.getByText('曹操').first()).toBeVisible();
    await expect(page.getByText('刘备').first()).toBeVisible();
  });

  test('切换视角', async ({ page }) => {
    await loadReplayAndEnter(page);

    const 视角选择 = page.locator('select');
    await expect(视角选择).toBeVisible();

    // 切换到座次 1
    await 视角选择.selectOption('1');
    await page.waitForTimeout(300);

    // 视角切换后仍在回放模式
    await expect(page.getByText('重播模式')).toBeVisible();
  });

  test('播放/暂停按钮存在并可点击', async ({ page }) => {
    await loadReplayAndEnter(page);

    const playBtn = page.locator('button').filter({ hasText: '播放' });
    await expect(playBtn).toBeVisible();

    // 点击播放
    await playBtn.click();
    await page.waitForTimeout(300);

    // 至少验证点击没有报错
    await expect(page.getByText('重播模式')).toBeVisible();
  });

  test('退出回放', async ({ page }) => {
    await loadReplayAndEnter(page);

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
