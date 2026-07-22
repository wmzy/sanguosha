// 界铁骑(界马超·被动技)测试:
//   1. 发动 → 判定 → 目标弃同花色手牌 → 可正常出闪抵消
//   2. 发动 → 判定 → 目标有同花色但不弃 → 不能出闪,强制命中
//   3. 发动 → 判定 → 目标无同花色手牌 → 直接强制命中
//   4. 不发动 → 正常询问闪
//   5. 本回合非锁定技失效:目标 反馈 不触发(锁定技仍生效)
//   6. 回合结束清标签:下回合目标非锁定技恢复正常
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '界马超',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界铁骑', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 弃同花色手牌 → 正常出闪抵消 ─────────────────────────────
  it('发动+弃同花色手牌 → P2 可出闪,不扣血', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const judge = makeCard('j1', '桃', '♥', '5'); // 判定为红桃
    // P2 手里需要一张红桃牌(同花色);用一张红桃杀当弃牌代价
    const sameSuit = makeCard('s1', '杀', '♥', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['界铁骑', '杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1', 's1'],
          skills: ['闪', '杀'],
        }),
      ],
      cardMap: { k1: kill, d1: dodge, j1: judge, s1: sameSuit },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应'); // 界铁骑 confirm
    await P1.respond('界铁骑', { choice: true });

    // 判定后 → P2 被询问弃同花色手牌(请求回应 requestType='铁骑/discard')
    P2.expectPending('请求回应');
    await P2.respond('界铁骑', { cardId: 's1' }); // 弃红桃杀

    // 弃了 → 正常询问闪
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });

    // 出闪抵消 → 不扣血
    expect(harness.state.players[1].health).toBe(4);
    // 弃的牌(s1)进弃牌堆,闪(d1)也进弃牌堆
    expect(harness.state.players[1].hand).not.toContain('s1');
    expect(harness.state.players[1].hand).not.toContain('d1');
  });

  // ─── 有同花色但不弃 → 强制命中 ─────────────────────────────
  it('发动+有同花色但不弃 → P2 不能出闪,扣血', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const judge = makeCard('j1', '桃', '♥', '5'); // 红桃
    const sameSuit = makeCard('s1', '杀', '♥', '8'); // P2 有但选择不弃
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['界铁骑', '杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1', 's1'],
          skills: ['闪', '杀'],
        }),
      ],
      cardMap: { k1: kill, d1: dodge, j1: judge, s1: sameSuit },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应');
    await P1.respond('界铁骑', { choice: true });

    // P2 选择不弃(超时/pass)
    P2.expectPending('请求回应');
    await P2.pass();

    // 没弃 → 强制命中
    expect(harness.state.players[1].health).toBe(3);
    // P2 的闪和同花色杀都还在手里(没能用出)
    expect(harness.state.players[1].hand).toContain('d1');
    expect(harness.state.players[1].hand).toContain('s1');
  });

  // ─── 无同花色手牌 → 直接强制命中 ─────────────────────────────
  it('发动+P2 无同花色手牌 → 直接强制命中,无弃牌询问', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♣', '2'); // 梅花闪
    const judge = makeCard('j1', '桃', '♥', '5'); // 判定红桃,P2 无红桃
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['界铁骑', '杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: ['d1'],
          skills: ['闪'],
        }),
      ],
      cardMap: { k1: kill, d1: dodge, j1: judge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应');
    await P1.respond('界铁骑', { choice: true });

    // 无同花色 → 跳过弃牌询问,直接强制命中
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].hand).toContain('d1');
  });

  // ─── 不发动 → 正常询问闪 ─────────────────────────────
  it('不发动界铁骑 → P2 正常出闪抵消,无非锁定技失效', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['界铁骑', '杀'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['d1'], skills: ['闪'] }),
      ],
      cardMap: { k1: kill, d1: dodge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应');
    await P1.respond('界铁骑', { choice: false });

    // 无判定 → 询问闪正常
    P2.expectPending('询问闪');
    await P2.respond('闪', { cardId: 'd1' });
    expect(harness.state.players[1].health).toBe(4);
    // 未发动 → 目标未被加压制标签
    expect(harness.state.players[1].tags).not.toContain('界铁骑/非锁定技失效');
  });

  // ─── 非锁定技失效:目标的反馈不触发 ─────────────────────────────
  it('发动后目标的非锁定技(反馈)本回合失效,受伤后不触发', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '桃', '♣', '5'); // 判定梅花
    // P2(司马懿)无同花色手牌(无梅花)→ 强制命中,受伤
    // 反馈锁定技不会触发(被压制)
    const state: GameState = createGameState({
      players: [
        // P1 多一张装备可被反馈的牌,以验证反馈确实未触发
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1', 'p1'],
          skills: ['界铁骑', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: ['反馈'],
          health: 4,
        }),
      ],
      cardMap: {
        k1: kill,
        j1: judge,
        p1: makeCard('p1', '桃', '♦', '3'),
      },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应');
    await P1.respond('界铁骑', { choice: true });

    // 判定为梅花,P2 无手牌 → 直接强制命中
    // 反馈(非锁定技)被压制,不应出现 反馈/confirm 询问
    expect(harness.state.players[1].health).toBe(3);
    expect(harness.state.players[1].tags).toContain('界铁骑/非锁定技失效');
    // 无 pending(反馈未触发)
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 锁定技不受压制:目标的锁定技(界毅重)在非锁定技失效下仍生效 ──
  // 防守 isLocked 契约:isHookSuppressed 对 isLocked=true 的技能返回 false。
  // 界毅重①是锁定技(检测有效性 before-hook:来源体力≥自己→黑杀无效)。
  // 若 isLocked 缺失,界铁骑压制会误吞界毅重→杀命中;修复后→杀被无效。
  it('锁定技不受非锁定技失效压制:界毅重黑杀无效仍生效', async () => {
    const kill = makeCard('k1', '杀', '♠', '7'); // 黑杀
    const judge = makeCard('j1', '桃', '♣', '5'); // 判定梅花
    // P1(界马超)HP4 ≥ P2(界于禁)HP3 → 界毅重①条件满足;P2 无手牌→铁骑强制命中路径
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['界铁骑', '杀'],
          health: 4,
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [],
          skills: ['界毅重'],
          health: 3,
        }),
      ],
      cardMap: { k1: kill, j1: judge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应'); // 界铁骑 confirm
    await P1.respond('界铁骑', { choice: true });

    // 界铁骑压制标签已设置(非锁定技失效对 P2 生效)
    expect(harness.state.players[1].tags).toContain('界铁骑/非锁定技失效');
    // 界毅重①是锁定技→不受压制→检测有效性 cancel 黑杀→P2 不扣血
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 回合结束清标签:下回合目标非锁定技恢复 ─────────────────────────────
  it('回合结束后 SUPPRESSION_TAG 被清除', async () => {
    const kill = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '桃', '♣', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['k1'],
          skills: ['界铁骑', '杀', '回合管理'],
        }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [] }),
      ],
      cardMap: { k1: kill, j1: judge },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'k1', [1]);
    P1.expectPending('请求回应');
    await P1.respond('界铁骑', { choice: true });

    // 强制命中 + 标签已加
    expect(harness.state.players[1].tags).toContain('界铁骑/非锁定技失效');

    // 推进到回合结束:不断 pass/end,直到回合结束清理
    // 通过直接 dispatch 回合结束 atom 模拟阶段推进
    const { applyAtom } = await import('../../src/engine/create-engine');
    await applyAtom(harness.state, { type: '回合结束', player: 0 });
    harness.processAllEvents();

    // 标签被清除
    expect(harness.state.players[1].tags).not.toContain('界铁骑/非锁定技失效');
  });
});
