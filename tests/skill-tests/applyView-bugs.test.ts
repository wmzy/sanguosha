// tests/skill-tests/applyView-bugs.test.ts
// 验证 apply 与 applyView 的一致性：apply 修改 GameState，applyView 修改 GameView。
// 如果两者不一致，前端（走事件流 applyView）看到的与引擎 state（测试断言的）不同。
// 这些 bug 之前测不出来，因为绝大多数测试断言 harness.state（绝对真实）而非 processedView。
import { describe, it, expect } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { viewReducer } from '../../src/client/view/reducer';
import { getAtomDef } from '../../src/engine/atom';
import { applyAtom } from '../../src/engine/create-engine';
import { buildView } from '../../src/engine/view/buildView';
import { createGameState } from '../../src/engine/types';
import type { GameView, ViewEvent, Card, GameState, PlayerState } from '../../src/engine/types';

/** 构造一个最小化 mock GameView 用于直接调用 applyView */
function mockView(overrides: Partial<GameView> = {}): GameView {
  return {
    viewer: 0,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
    players: [
      {
        index: 0,
        name: 'P1',
        character: '',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        marks: [],
      },
      {
        index: 1,
        name: 'P2',
        character: '',
        health: 4,
        maxHealth: 4,
        alive: true,
        equipment: {},
        skills: [],
        handCount: 0,
        marks: [],
      },
    ],
    cardMap: {},
    pending: null,
    deadline: null,
    deadlineTotalMs: 0,
    log: [],
    zones: { deckCount: 10, discardPileCount: 0, processing: [] },
    settlementStack: [],
    ...overrides,
  };
}

describe('applyView 一致性 bug', () => {
  describe('弃置 atom: equipment 未清除', () => {
    it('apply 清 equipment, applyView 也清 equipment + handCount 按 zone 精确扣减', () => {
      const def = getAtomDef('弃置');
      const view = mockView({
        players: [
          {
            index: 0,
            name: 'P1',
            character: '',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: { 武器: 'w1' },
            skills: [],
            handCount: 1,
            hand: [{ id: 'h1', name: '杀', suit: '♠', color: '黑', rank: '1', type: '基本牌' }],
            marks: [],
          },
          {
            index: 1,
            name: 'P2',
            character: '',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {},
            skills: [],
            handCount: 0,
            marks: [],
          },
        ],
      });

      // 弃置 w1 (装备) 和 h1 (手牌)。zones 字段由 toViewEvents 生成(apply 前 state 快照),
      // 标记每张牌所在区域,applyView 据此精确扣减(判定区牌不计 handCount)。
      def.applyView!(view, {
        type: '弃置',
        player: 0,
        cardIds: ['w1', 'h1'],
        zones: { w1: 'equipment', h1: 'hand' },
      });

      expect(view.players[0].handCount).toBe(0);
      expect(view.players[0].hand).toEqual([]);
      expect(view.players[0].equipment['武器']).toBeUndefined();
    });
  });

  describe('获得 atom: from 玩家视图不同步', () => {
    it('apply 从 from 移除手牌/装备, applyView 不处理 from 的 handCount/equipment', () => {
      const def = getAtomDef('获得');
      const view = mockView({
        players: [
          {
            index: 0,
            name: 'P1',
            character: '',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {},
            skills: [],
            handCount: 0,
            marks: [],
          },
          {
            index: 1,
            name: 'P2',
            character: '',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {},
            skills: [],
            handCount: 1,
            hand: [{ id: 'c2', name: '杀', suit: '♥', color: '红', rank: '3', type: '基本牌' }],
            marks: [],
          },
        ],
        cardMap: {
          c2: { id: 'c2', name: '杀', suit: '♥', color: '红', rank: '3', type: '基本牌' },
        },
      });

      // P0 从 P1 获得 c2
      def.applyView!(view, { type: '获得', player: 0, cardId: 'c2', from: 1 });

      expect(view.players[0].handCount).toBe(1); // ✅ 获得者 +1
      expect(view.players[1].handCount).toBe(0); // ❌ BUG: from 玩家仍为 1,未 -1
    });
  });

  describe('判定 atom: deckCount 未递减', () => {
    it('apply 从 deck shift 到 processing, applyView 不减 deckCount', () => {
      const def = getAtomDef('判定');
      const view = mockView();

      const before = view.zones!.deckCount;
      def.applyView!(view, {} as any);

      // processing 被 pop（afterHook 模拟），但 deckCount 应该 -1（牌从牌堆翻出）
      expect(view.zones!.deckCount).toBe(before - 1); // ❌ BUG: 实际仍为 10
    });

    it('applyView 净效果: deckCount-1 + discardPileCount+1, processing 不变', () => {
      const def = getAtomDef('判定');
      const view = mockView();

      def.applyView!(view, {
        type: '判定',
        player: 0,
        judgeType: '乐不思蜀',
        cardId: 'j1',
        card: { name: '杀', suit: '♠', color: '黑', rank: '7' },
      });

      // 净效果:判定牌最终进弃牌堆,processing 不变(apply 加 + afterHooks 减)
      expect(view.zones!.processing).toHaveLength(0);
      expect(view.zones!.discardPileCount).toBe(1);
      expect(view.zones!.deckCount).toBe(9);
    });
  });

  describe('加标记 atom: 缺少 applyView', () => {
    it('apply 加 mark, 但 applyView 不存在 → 前端 marks 永不更新', () => {
      const def = getAtomDef('加标记');
      expect(def.applyView).toBeDefined(); // ❌ BUG: 实际为 undefined
    });
  });

  describe('去标记 atom: 缺少 applyView', () => {
    it('apply 移除 mark, 但 applyView 不存在', () => {
      const def = getAtomDef('去标记');
      expect(def.applyView).toBeDefined(); // ❌ BUG
    });
  });

  describe('清过期标记 atom: 缺少 applyView', () => {
    it('apply 清 duration===turn marks, 但 applyView 不存在', () => {
      const def = getAtomDef('清过期标记');
      expect(def.applyView).toBeDefined(); // ❌ BUG
    });
  });

  describe('击杀 atom: discardPileCount 未增加', () => {
    it('apply 把手牌+装备进弃牌堆, applyView 不增加 discardPileCount', () => {
      const def = getAtomDef('击杀');
      const view = mockView({
        players: [
          {
            index: 0,
            name: 'P1',
            character: '',
            health: 0,
            maxHealth: 4,
            alive: true,
            equipment: { 武器: 'e1' },
            skills: [],
            handCount: 2,
            hand: [
              { id: 'h1', name: '杀', suit: '♠', color: '黑', rank: '1', type: '基本牌' },
              { id: 'h2', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' },
            ],
            marks: [],
          },
          {
            index: 1,
            name: 'P2',
            character: '',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {},
            skills: [],
            handCount: 0,
            marks: [],
          },
        ],
      });

      const before = view.zones!.discardPileCount;
      def.applyView!(view, { type: '击杀', player: 0 });

      // apply: 2 手牌 + 1 装备 = 3 张进弃牌堆
      expect(view.zones!.discardPileCount).toBe(before + 3); // ❌ BUG: 实际仍为 0
    });

    it('阵亡身份对所有视角揭示(toViewEvents 携带 identity, applyView 揭示)', () => {
      const def = getAtomDef('击杀');
      // mock state: P1 是反贼(真实身份)
      const mockState = {
        players: [{ identity: '主公' }, { identity: '反贼' }],
      } as any;
      // mock view: P1 对 viewer=0 隐藏身份
      const view = mockView({
        viewer: 0,
        players: [
          {
            index: 0,
            name: 'P0',
            character: '',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {},
            skills: [],
            handCount: 0,
            marks: [],
            identity: '主公',
            identityHidden: false,
          },
          {
            index: 1,
            name: 'P1',
            character: '',
            health: 0,
            maxHealth: 4,
            alive: true,
            equipment: {},
            skills: [],
            handCount: 0,
            marks: [],
            identity: undefined,
            identityHidden: true,
          },
        ],
      });

      // toViewEvents 应携带阵亡者身份(死亡即公开)
      const split = def.toViewEvents!(mockState, { type: '击杀', player: 1 });
      expect((split!.othersView as any).identity).toBe('反贼');

      // applyView 揭示身份:前端走事件流时能看到阵亡者的真实身份
      def.applyView!(view, split!.othersView!);
      expect(view.players[1].identity).toBe('反贼');
      expect(view.players[1].identityHidden).toBe(false);
    });
  });

  describe('获得/给予 atom: 信息分级泄露', () => {
    it('获得 toViewEvents 用 othersView 公开 cardId → 第三方知道顺手牵羊拿了什么牌', () => {
      const def = getAtomDef('获得');
      const split = def.toViewEvents!(
        {
          players: [
            {
              index: 0,
              name: 'P0',
              character: '',
              health: 4,
              maxHealth: 4,
              alive: true,
              hand: [],
              equipment: {},
              skills: [],
              vars: {},
              marks: [],
              pendingTricks: [],
              tags: [],
              judgeZone: [],
            },
            {
              index: 1,
              name: 'P1',
              character: '',
              health: 4,
              maxHealth: 4,
              alive: true,
              hand: [],
              equipment: { 防具: 'c2' },
              skills: [],
              vars: {},
              marks: [],
              pendingTricks: [],
              tags: [],
              judgeZone: [],
            },
          ],
          cardMap: {
            c2: { id: 'c2', name: '杀', suit: '♥', color: '红', rank: '3', type: '基本牌' },
          },
          zones: { deck: [], discardPile: [], processing: [] },
        } as any,
        { type: '获得', player: 0, cardId: 'c2', from: 1 },
      );
      // othersView 不应携带 cardId（第三方不应知道获得了什么牌）
      expect((split?.othersView as any)?.cardId).toBeUndefined();
    });
  });

  // ── 重复牌打出/弃牌导致 hand.length 与 handCount 脱节 ──
  // 标准牌堆中同名同花色同点数的牌有多张(如 杀♠7 有 4 张)。
  // 移动牌.applyView 的「打出」「弃牌」分支按 name+suit+rank 过滤移除手牌,
  // 会一次性移除所有重复牌,但 handCount 只 -1 → 前端手牌区(hand.length)
  // 与武将卡片手牌数(handCount)不一致。这就是「玩一会后手牌数对不上」的根因。
  describe('移动牌 atom: 重复牌打出导致 hand 与 handCount 脱节', () => {
    // 两张完全相同的杀(id 不同,但 name/suit/rank 相同)
    const dupCards: Card[] = [
      { id: 's1', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' },
      { id: 's2', name: '杀', suit: '♠', color: '黑', rank: '7', type: '基本牌' },
    ];

    it('打出分支: 打出 1 张重复杀, hand 应只移除 1 张, handCount 只 -1', () => {
      const def = getAtomDef('移动牌');
      const view = mockView({
        players: [
          {
            index: 0,
            name: 'P1',
            character: '',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {},
            skills: [],
            handCount: 2,
            hand: [...dupCards],
            marks: [],
          },
          {
            index: 1,
            name: 'P2',
            character: '',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {},
            skills: [],
            handCount: 0,
            marks: [],
          },
        ],
        cardMap: { s1: dupCards[0], s2: dupCards[1] },
      });

      // 打出 s1: 手牌→处理区。toViewEvents 生成 { type: '打出', player: 0, card: {name,suit, color: suitColor(suit),rank}, cardId: 's1' }
      def.applyView!(view, {
        type: '打出',
        player: 0,
        cardId: 's1',
        card: { name: '杀', suit: '♠', color: '黑', rank: '7' },
      });

      // ❌ BUG: filter 按 name/suit/rank 匹配,s2 也会被移除 → hand 变空但 handCount=1
      expect(view.players[0].handCount).toBe(1); // handCount 只 -1 ✓
      expect(view.players[0].hand?.length).toBe(1); // hand 应剩 1 张(s2)
      // 残留的牌必须是 s2(没被打出的那张),不能是 s1
      expect(view.players[0].hand?.[0]?.id).toBe('s2');
    });

    it('弃牌分支: 弃 1 张重复杀, hand 应只移除 1 张, handCount 只 -1', () => {
      const def = getAtomDef('移动牌');
      const view = mockView({
        players: [
          {
            index: 0,
            name: 'P1',
            character: '',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {},
            skills: [],
            handCount: 2,
            hand: [...dupCards],
            marks: [],
          },
          {
            index: 1,
            name: 'P2',
            character: '',
            health: 4,
            maxHealth: 4,
            alive: true,
            equipment: {},
            skills: [],
            handCount: 0,
            marks: [],
          },
        ],
        cardMap: { s1: dupCards[0], s2: dupCards[1] },
      });

      // 弃牌: 手牌→弃牌堆。toViewEvents 生成 { type: '弃牌', player: 0, card: {...}, cardId: 's1' }
      def.applyView!(view, {
        type: '弃牌',
        player: 0,
        cardId: 's1',
        card: { name: '杀', suit: '♠', color: '黑', rank: '7' },
      });

      expect(view.players[0].handCount).toBe(1);
      expect(view.players[0].hand?.length).toBe(1);
      expect(view.players[0].hand?.[0]?.id).toBe('s2');
    });
  });
});

// 源: tests/integration/view-reducer-fallback.test.ts — 归并于 2026-06-23
describe('展示型 ViewEvent 注册', () => {
  function makeView(): GameView {
    return {
      viewer: 0,
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
      players: [
        {
          index: 0,
          name: 'P1',
          character: '',
          faction: '群',
          health: 4,
          maxHealth: 4,
          alive: true,
          handCount: 0,
          equipment: {},
          skills: [],
          marks: [],
          identity: '主公',
        },
      ],
      zones: { deckCount: 0, discardCount: 0, processingCount: 0 },
      log: [],
      pending: null,
      deadline: null,
      deadlineTotalMs: 0,
    } as unknown as GameView;
  }

  it('等待选将 已注册,viewReducer 不抛错', () => {
    expect(() => getAtomDef('等待选将')).not.toThrow();
    const view = makeView();
    const event = {
      type: '等待选将',
      waitingFor: 0,
      effect: { duration: 200 },
    } as unknown as ViewEvent;
    expect(() => viewReducer(view, event)).not.toThrow();
    // view 不应被改变
    expect(view.phase).toBe('准备');
  });

  it('打出 已注册,viewReducer 不抛错', () => {
    expect(() => getAtomDef('打出')).not.toThrow();
    const view = makeView();
    const event = { type: '打出', player: 0, effect: { duration: 800 } } as unknown as ViewEvent;
    expect(() => viewReducer(view, event)).not.toThrow();
  });

  it('注册的实体 atom(分配武将) 正常 applyView', () => {
    const view = makeView();
    const event = {
      type: '分配武将',
      target: 0,
      character: '刘备',
      skills: ['仁德'],
      effect: { duration: 200 },
    } as unknown as ViewEvent;
    viewReducer(view, event);
    expect(view.players[0].character).toBe('刘备');
  });
});

// ── 请求回应 atom: applyView 的 deadline/totalMs 必须与后端真实超时口径一致 ──
// 后端 createAndAwaitSlot 走 resolveTimeoutMs(state, base)。
// toViewEvents 计算出 timeoutMs(已应用 timeoutScale)并透传给 applyView。
// applyView 必须从 event.timeoutMs 读取,而非硬编码 30s,
// 否则前端倒计时(applyView 增量路径)与后端真实超时不一致。
describe('请求回应 atom: deadline/totalMs 口径一致性', () => {
  const TIMEOUT_MS = 10_000; // 无懈可击 atom.timeout=10(秒) → timeoutMs=10000

  it('广播型(无懈可击): applyView 的 totalMs = event.timeoutMs', () => {
    const def = getAtomDef('请求回应');
    const view = mockView();
    // 模拟 toViewEvents 生成的 event(广播型,带 timeoutMs)
    const event = {
      type: '请求回应',
      requestType: '无懈可击',
      target: -2, // TARGET_BROADCAST
      prompt: { type: 'useCard', title: '是否打出无瓣可击?' },
      timeoutMs: 10_000,
    } as unknown as ViewEvent;
    def.applyView!(view, event);
    expect(view.pending).not.toBeNull();
    expect(view.pending!.totalMs).toBe(TIMEOUT_MS);
    // deadline ≈ now + 10s(允许 100ms 漂移)
    expect(view.pending!.deadline).toBeGreaterThan(Date.now() + TIMEOUT_MS - 200);
    expect(view.pending!.deadline).toBeLessThan(Date.now() + TIMEOUT_MS + 200);
  });

  it('target viewer: applyView 的 totalMs = event.timeoutMs', () => {
    const def = getAtomDef('请求回应');
    const view = mockView({ viewer: 1 });
    const event = {
      type: '请求回应',
      requestType: '询问杀',
      target: 1,
      prompt: { type: 'useCard', title: '请出杀' },
      timeoutMs: 15_000,
    } as unknown as ViewEvent;
    def.applyView!(view, event);
    expect(view.pending).not.toBeNull();
    expect(view.pending!.totalMs).toBe(15_000);
  });

  it('未传 timeout 时 fallback 到 pending.timeout(30s)', () => {
    const def = getAtomDef('请求回应');
    const view = mockView();
    const event = {
      type: '请求回应',
      requestType: '询问杀',
      target: -2,
      prompt: { type: 'useCard', title: '请出杀' },
      // 不带 timeout → fallback
    } as unknown as ViewEvent;
    def.applyView!(view, event);
    expect(view.pending).not.toBeNull();
    expect(view.pending!.totalMs).toBe(30_000);
  });
});

// ── 分配武将 atom: faction 字段运行时赋值 ──
// PlayerState.faction 已声明但历史上从不赋值——分配武将 atom 只设
// character/name/skills,导致激将/护驾/黄天/救援/暴虐/颂威/制霸等读 player.faction
// 的技能始终拿到 undefined。现有技能测试之所以没暴露,是因为它们在 makePlayer 里
// 手动注入了 faction,绕过了 atom。这里直接走 分配武将 atom 验证 faction 真正被赋值,
// 并贯穿到 view(toViewEvents 携带 + applyView 写入 + buildView 投影)。
function makeBarePlayer(index: number): PlayerState {
  return {
    index,
    name: `P${index}`,
    character: '',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: [],
    equipment: {},
    skills: [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    // 故意不设 faction/identity —— 应由 atom 赋值
  };
}

function makeBareState(): GameState {
  return createGameState({
    players: [makeBarePlayer(0), makeBarePlayer(1)],
    cardMap: {},
  });
}

describe('分配武将 atom: faction 从角色配置赋值并投影到 view', () => {
  it.each([
    ['刘备', '蜀'],
    ['关羽', '蜀'],
    ['曹操', '魏'],
    ['司马懿', '魏'],
    ['孙权', '吴'],
    ['周瑜', '吴'],
    ['吕布', '群'],
    ['貂蝉', '群'],
  ])('apply 后 %s.faction === %s', async (character, faction) => {
    const state = makeBareState();
    await applyAtom(state, {
      type: '分配武将',
      target: 0,
      character,
      skills: [],
    });
    expect(state.players[0].character).toBe(character);
    expect(state.players[0].faction).toBe(faction);
  });

  it('toViewEvents 携带 faction(公开信息,所有视角可见)', () => {
    const def = getAtomDef('分配武将');
    const split = def.toViewEvents!(makeBareState(), {
      type: '分配武将',
      target: 0,
      character: '刘备',
      skills: [],
    });
    expect(split).toBeDefined();
    // othersView 携带 faction(ownerViews 为空 = owner 也看 othersView)
    expect(split!.ownerViews.size).toBe(0);
    expect(split!.othersView?.faction).toBe('蜀');
  });

  it('applyView 写入 view.players[].faction', () => {
    const def = getAtomDef('分配武将');
    const view = mockView();
    def.applyView!(view, {
      type: '分配武将',
      target: 0,
      character: '曹操',
      skills: [],
      faction: '魏',
    } as ViewEvent);
    expect(view.players[0].character).toBe('曹操');
    expect(view.players[0].faction).toBe('魏');
  });

  it('端到端:applyAtom 后 buildView 投影 faction 到所有视角', async () => {
    const state = makeBareState();
    await applyAtom(state, {
      type: '分配武将',
      target: 1,
      character: '孙权',
      skills: [],
    });
    // 任意 viewer 都能看到目标玩家的公开势力
    const v0 = buildView(state, 0);
    const v1 = buildView(state, 1);
    expect(v0.players[1].faction).toBe('吴');
    expect(v1.players[1].faction).toBe('吴');
  });

  it('分配前 faction 为 undefined,分配后才被赋值', async () => {
    const state = makeBareState();
    expect(state.players[0].faction).toBeUndefined();
    await applyAtom(state, {
      type: '分配武将',
      target: 0,
      character: '张飞',
      skills: [],
    });
    expect(state.players[0].faction).toBe('蜀');
  });
});
