import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import type { ReplayFile, ReplayBaseline, PublicPlayerView } from '../../src/client/replay/types';

const LOG_DIR = path.join(process.cwd(), 'test-results', 'logs');

function createTestReplayFile(): ReplayFile {
  const baseView = {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌' as const,
    turn: { round: 1, phase: '出牌', vars: {} },
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

  // v2: 去掉冗余 seq(数组下标即序号)
  const events = [
    { time: 1000, event: { type: '回合开始', player: 0, round: 1 } },
    { time: 1001, event: { type: '阶段开始', player: 0, phase: '摸牌' } },
    { time: 1002, event: { type: '摸牌', player: 0, count: 2 } },
    { time: 1003, event: { type: '阶段结束', player: 0, phase: '摸牌' } },
    { time: 1004, event: { type: '阶段开始', player: 0, phase: '出牌' } },
    { time: 1005, event: { type: '扣减体力', target: 1, amount: 1 } },
    { time: 1006, event: { type: '阶段结束', player: 0, phase: '出牌' } },
  ];

  // v2: baseline = baseView 的公共部分(剥离 viewer/hand/identity)
  const { viewer: _v, players, ...publicFields } = baseView;
  const baseline: ReplayBaseline = {
    ...(publicFields as Omit<ReplayBaseline, 'players'>),
    players: players.map((p) => {
      const { identity: _id, identityHidden: _ih, hand: _h, ...pub } = p as Record<
        string,
        unknown
      >;
      return pub as PublicPlayerView;
    }),
  };

  return {
    format: 'sanguosha-replay',
    version: 2,
    meta: { createdAt: Date.now(), playerCount: 2, characters: ['曹操', '刘备'] },
    baseline,
    seats: {
      0: {
        viewer: 0,
        playerName: '曹操',
        privateHands: [],
        identityView: players.map((p) => ({
          index: (p as { index: number }).index,
          identity: (p as { identity?: string }).identity,
          identityHidden: (p as { identityHidden?: boolean }).identityHidden,
        })),
        events,
      },
      1: {
        viewer: 1,
        playerName: '刘备',
        privateHands: [],
        identityView: players.map((p) => ({
          index: (p as { index: number }).index,
          identity: (p as { identity?: string }).identity,
          identityHidden: (p as { identityHidden?: boolean }).identityHidden,
        })),
        events,
      },
    },
  };
}

// ─── 调试房开局驱动 ─────────────────────────────────────────
// 现行 debug 流程:/debug 大厅创建房间 → 每座次点「准备」→「开始游戏」→
// 身份揭示遮罩确认 → 各座次依次选将(主公先选;无头座次由 e2e 切视角代答)。
// 用 2 人局:连接数少、开局快。
//
// ⚠️ 点击通道:GameView 在 transform 缩放容器内,常规 locator.click 的坐标
// hit-test 会被缩放/覆盖层拦截(事件不落到目标按钮,React onClick 不触发),
// 表现为 click 永久挂起。debug 流程的按钮点击一律走 DOM 直接触发。

/** 在页面里按可见文本精确匹配按钮并直接触发其 click(返回是否找到并点击) */
async function domClickButton(
  page: import('@playwright/test').Page,
  text: string,
): Promise<boolean> {
  return page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find(
      (el) => el.textContent?.trim() === t && !el.disabled,
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, text);
}

/** 驱动开局遮罩:身份揭示确认 + 自适应替各待选座次完成选将,直到自己进入出牌阶段 */
async function driveOpeningOverlays(page: import('@playwright/test').Page): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastStep = 'start';
  while (Date.now() < deadline) {
    // 自己出牌阶段:「结束回合」按钮出现且无应答/选将 pending 时完成
    // (对手先手的 AOE 应答窗期间 isMyTurn 仍为 true,结束回合按钮可见但不可作为终点)
    const respondWindow = await page.evaluate(() =>
      [...document.querySelectorAll('button')].some((el) => el.textContent?.trim() === '不回应'),
    );
    if (respondWindow) {
      lastStep = 'respond-window';
      await domClickButton(page, '不回应');
      await page.waitForTimeout(400);
      continue;
    }
    if (await page.getByRole('button', { name: '结束回合' }).isVisible().catch(() => false)) return;

    if (
      await page.evaluate(
        () => !![...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === '确认'),
      )
    ) {
      lastStep = 'identity-confirm';
      await domClickButton(page, '确认');
      await page.waitForTimeout(300);
      continue;
    }

    // 读一次选将面板全量状态,按状态分派(避免分支间互相遮挡)
    const st = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const confirm = btns.find((el) => el.textContent?.trim() === '确认选择');
      return {
        submitted: btns.some((el) => el.textContent?.includes('✅ 已选择')),
        hasConfirm: !!confirm,
        confirmEnabled: confirm ? !confirm.disabled : false,
        hasCard: document.querySelector('[data-char-card]') !== null,
        hasGroup: document.querySelector('[data-multi-group]') !== null,
        nextSeat: btns.some((el) => el.textContent?.trim() === '下一个待选者'),
        startGame: btns.some((el) => el.textContent?.trim() === '开始游戏' && !el.disabled),
      };
    });

    // 已选中待提交
    if (st.hasConfirm && st.confirmEnabled) {
      lastStep = 'char-submit';
      await domClickButton(page, '确认选择');
      await page.waitForTimeout(300);
      continue;
    }
    // 未选中:点第一张可直接选中的卡
    if (st.hasConfirm && st.hasCard) {
      lastStep = 'char-pick';
      await page.evaluate(() => {
        document.querySelector<HTMLElement>('[data-char-card]')?.click();
      });
      await page.waitForTimeout(200);
      continue;
    }
    // 只有折叠组卡:hover 展开成版本卡(mouseover 驱动 React onMouseEnter)
    if (st.hasGroup) {
      lastStep = 'expand-group';
      await page.evaluate(() => {
        const group = document.querySelector('[data-multi-group]');
        group?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      await page.waitForTimeout(300);
      continue;
    }
    // 本视角已提交(或无自选面板)且还有其他座次未选 → 切换过去替它选
    if (st.nextSeat && (st.submitted || (!st.hasConfirm && !st.hasCard))) {
      lastStep = 'next-seat';
      await domClickButton(page, '下一个待选者');
      await page.waitForTimeout(300);
      continue;
    }
    lastStep = 'idle-wait';
    // 自愈:若仍停在配置面板(开始按钮已可用说明准备完成但开局请求未生效),补点一次
    if (st.startGame) await domClickButton(page, '开始游戏');
    await page.waitForTimeout(500);
  }
  const digest = await page
    .evaluate(() => document.body.innerText.slice(0, 400).replace(/\n+/g, '|'))
    .catch(() => '(evaluate failed)');
  throw new Error(
    `开局流程未在时限内完成,最后阶段: ${lastStep};页面摘要: ${digest}`,
  );
}

/** 从 /debug 创建 2 人调试房并走完准备/开始/选将,停在玩家 0 的出牌阶段 */
async function startDebugGame(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/debug');
  // 人数选 2(减少 SSE 连接数)
  await page.locator('select').first().selectOption('2');
  await domClickButton(page, '创建调试房间');

  // 房间配置面板:等待两座次连接完成(出现「准备」按钮)
  await page.getByText(/座次与准备/).waitFor({ timeout: 30_000 });
  await page
    .locator('button', { hasText: /^准备$/ })
    .first()
    .waitFor({ timeout: 30_000 });
  // 准备循环:目标不是「找不到准备按钮」(React 重渲染间隙可能短暂查不到),
  // 而是「开始游戏按钮变为可点」= 全员已准备
  const readyDeadline = Date.now() + 20_000;
  while (Date.now() < readyDeadline) {
    const allReady = await page.evaluate(() =>
      [...document.querySelectorAll('button')].some(
        (el) => el.textContent?.trim() === '开始游戏' && !el.disabled,
      ),
    );
    if (allReady) break;
    await domClickButton(page, '准备');
    await page.waitForTimeout(500);
  }
  // 全员准备后「开始游戏」按钮才启用;UI 刷新有滞后,窗口期内重试
  const startDeadline = Date.now() + 15_000;
  while (Date.now() < startDeadline) {
    if (await domClickButton(page, '开始游戏')) break;
    await page.waitForTimeout(400);
  }

  await driveOpeningOverlays(page);
}

test.describe('首页', () => {
  test('显示游戏标题和模式选择', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '三国杀' })).toBeVisible();
    await expect(page.getByText('数字卡牌游戏')).toBeVisible();
    await expect(page.getByRole('link', { name: '调试游戏' })).toBeVisible();
    await expect(page.getByRole('link', { name: '多人游戏' })).toBeVisible();
    await expect(page.getByRole('button', { name: '录像回放' })).toBeVisible();
  });

  test('点击调试游戏进入游戏页面', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '调试游戏' }).click();
    await expect(page).toHaveURL('/debug');
  });

  test('点击多人对战进入大厅', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '多人游戏' }).click();
    await expect(page).toHaveURL('/play');
  });
});

test.describe('调试游戏 — 真实游戏流程', () => {
  // 随机主公下 AI 座次可能先手;无头座次的询问/出牌窗口靠服务端超时自动跳过,
  // 一整轮对手回合可达 60-90s,默认 30s testTimeout 不够。
  test.setTimeout(150_000);

  test.beforeEach(async ({ page }) => {
    // 每用例独立账号:debug 座次 playerId 派生自登录 userId,若并行 worker 共用
    // 账号,后 join 的房间会把同 playerId 从前一个房里踢走(服务端 join 清旧房
    // 关联),对方房的 ready 400 → 开局卡死。独立账号彻底隔离。
    // 用户名规则:2-24 位 [\w\u4e00-\u9fa5-](store.isValidUsername)
    const username = `e2e${test.info().workerIndex}${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 5)}`;
    const res = await page.request.post('/api/auth/register', {
      data: { username, password: 'e2e-pass-123' },
    });
    expect(res.status()).toBe(200);
    await startDebugGame(page);
  });

  test('初始状态正确', async ({ page }) => {
    // 自己的出牌阶段:阶段徽章 + 结束回合按钮 + 手牌已发
    await expect(page.getByRole('button', { name: '结束回合' })).toBeVisible();
    await expect(page.locator('[data-card-id]').first()).toBeVisible();
  });

  test('出牌阶段可以选选手牌', async ({ page }) => {
    // 点选手牌 → 动作条出现「取消选择」;再取消回到空闲。
    // 手牌在 transform 缩放容器内,locator.click 的坐标命中会被拦截,走 DOM click。
    // 渲染间隙首点可能无效,以「取消选择」出现为成功标志做有限重试。
    const deadline = Date.now() + 15_000;
    let cancelled = false;
    while (Date.now() < deadline && !cancelled) {
      await expect(page.getByRole('button', { name: '结束回合' })).toBeVisible();
      await page.evaluate(() => {
        document.querySelector<HTMLElement>('[data-card-id]')?.click();
      });
      try {
        await expect(page.getByRole('button', { name: '取消选择' })).toBeVisible({
          timeout: 3000,
        });
        cancelled = true;
      } catch {
        await page.waitForTimeout(500);
      }
    }
    expect(cancelled).toBe(true);
    await domClickButton(page, '取消选择');
  });

  test('结束回合后轮到下一个玩家', async ({ page }) => {
    await domClickButton(page, '结束回合');
    // 不再是自己回合:结束回合按钮消失(弃牌/对方回合)
    await expect(page.getByRole('button', { name: '结束回合' })).toBeHidden({ timeout: 10_000 });
  });

  test('日志面板记录操作', async ({ page }) => {
    // 底部折叠面板存在
    await expect(page.getByText('调试信息')).toBeVisible();
  });

  test('返回首页', async ({ page }) => {
    // 对局内左上是「← 退出」(删除调试房并 navigate('/'));大厅顶栏才是「← 返回」
    await domClickButton(page, '← 退出');
    await expect(page).toHaveURL('/', { timeout: 15_000 });
  });
});

test.describe('回放功能', () => {
  let logFile: string;

  test.beforeEach(() => {
    // 使用唯一文件名避免并行冲突
    // 注意:beforeEach 钩子签名只有 fixtures 一个参数(第二参数会让 Playwright 把
    // 首参当解构模式校验,加载即抛 "First argument must use the object
    // destructuring pattern",整个 spec 无法运行);retry 经 test.info() 获取。
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logFile = path.join(LOG_DIR, `test-${test.info().retry}-${Date.now()}.json`);
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
      page.getByRole('button', { name: '录像回放' }).click(),
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
    // 精确匹配「▶ 播放」:「事件动效播放速度」按钮的 aria-label 含「播放」会撞名
    await expect(page.getByRole('button', { name: '▶ 播放' })).toBeVisible();
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

    const playBtn = page.getByRole('button', { name: '▶ 播放' });
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
    await page.goto('/play');
    await expect(page.getByText(/返回/)).toBeVisible();
  });

  test('返回首页', async ({ page }) => {
    await page.goto('/play');
    // 顶栏「← 返回首页」是 button(非 link)
    await page.getByRole('button', { name: '← 返回首页' }).click();
    await expect(page).toHaveURL('/');
  });
});
