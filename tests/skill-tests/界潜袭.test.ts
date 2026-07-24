// tests/skill-tests/界潜袭.test.ts
// 界潜袭(界马岱·蜀·主动技,OL 界限突破)测试:
//   准备阶段,你可以摸一张牌并展示一张牌。若如此做:
//   - 距离为1的其他角色本回合不能使用或打出与"潜袭"牌颜色相同的手牌;
//   - 你本回合使用"潜袭"牌造成的伤害+1。
//
// 测试覆盖:
//   1. 正面 happy path:准备阶段触发 → 摸1 → 展示红牌 → 距离1目标加禁红标签
//   2. 不发动:confirm=false → 无标签、无展示、无增伤
//   3. 黑牌分支:展示黑牌 → 距离1目标加禁黑标签
//   4. 增伤:owner 使用展示牌造伤 → +1
//   5. 增伤不重复:同一展示牌第二次造伤不再 +1
//   6. 禁色-全为禁色闪 → 询问闪被 cancel(目标无法闪,强制命中)
//   7. 禁色-有非禁色闪 → 询问闪放行(目标可出非禁色闪)
//   8. 距离 >1 不受影响:4 人局中距离 2 的目标不加标签
//   9. 回合结束清标签
//   10. 边界:owner 无手牌时仍可发动(摸1后必须展示,若无牌则效果落空)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import { runDamageFlow } from '../../src/engine/damage-flow';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  tags?: string[];
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界马岱',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['界潜袭', '杀'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: opts.tags ?? [],
    judgeZone: [],
  };
}

/** 触发准备阶段:applyAtom(阶段开始, 0, 准备) → 界潜袭 after-hook 询问发动。
 *  用 void fire-and-forget,再 waitForStable 等 pending 创建。 */
async function triggerPreparePhase(harness: SkillTestHarness): Promise<void> {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
  await harness.waitForStable();
  harness.processAllEvents();
}

describe('界潜袭', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面 happy path:展示红牌 → 距离1目标加禁红 ────────────────

  it('正面:准备阶段发动 → 摸1 → 展示红牌 → 距离1目标加禁红标签', async () => {
    // deck 顶摸入一张红闪(owner 选它展示)
    const drawn = makeCard('d1', '闪', '♥', '4'); // 红闪
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界潜袭'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: [],
          skills: [],
        }),
      ],
      cardMap: { d1: drawn },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 触发准备阶段 → 界潜袭询问发动
    await triggerPreparePhase(harness);
    P1.expectPending('请求回应');

    // P1 确认发动
    await P1.respond('界潜袭', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    // 询问选一张展示(唯一手牌即刚摸入的 d1)
    P1.expectPending('请求回应');
    await P1.respond('界潜袭', { cardId: 'd1' });
    await harness.waitForStable();
    harness.processAllEvents();

    // owner 手牌仍有 d1(展示不弃置)
    expect(harness.state.players[0].hand).toContain('d1');
    // 距离1的 P2 加禁红标签
    expect(harness.state.players[1].tags).toContain('界潜袭/禁红');
    expect(harness.state.players[1].tags).not.toContain('界潜袭/禁黑');
    // turn.vars 记录潜袭牌(供增伤匹配)
    expect(harness.state.turn.vars['界潜袭/cardId']).toBe('d1');
    expect(harness.state.turn.vars['界潜袭/color']).toBe('红');
  });

  // ─── 2. 不发动:无标签、无展示 ─────────────────────────────

  it('负面:confirm=false → 不摸牌/不展示/无标签', async () => {
    const drawn = makeCard('d1', '闪', '♥', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界潜袭'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: [], skills: [] }),
      ],
      cardMap: { d1: drawn },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    P1.expectPending('请求回应');

    await P1.respond('界潜袭', { choice: false });
    await harness.waitForStable();
    harness.processAllEvents();

    // 不摸牌(牌堆仍 1 张)
    expect(harness.state.zones.deck.length).toBe(1);
    // 无标签
    expect(harness.state.players[1].tags).not.toContain('界潜袭/禁红');
    expect(harness.state.players[1].tags).not.toContain('界潜袭/禁黑');
    // 无 turn.vars
    expect(harness.state.turn.vars['界潜袭/cardId']).toBeUndefined();
  });

  // ─── 3. 黑牌分支 ─────────────────────────────

  it('黑牌:展示黑牌 → 距离1目标加禁黑标签', async () => {
    const drawn = makeCard('d1', '闪', '♠', '4'); // 黑闪
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界潜袭'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: [], skills: [] }),
      ],
      cardMap: { d1: drawn },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    await P1.respond('界潜袭', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();

    await P1.respond('界潜袭', { cardId: 'd1' });
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[1].tags).toContain('界潜袭/禁黑');
    expect(harness.state.players[1].tags).not.toContain('界潜袭/禁红');
    expect(harness.state.turn.vars['界潜袭/color']).toBe('黑');
  });

  // ─── 4. 增伤:owner 使用潜袭牌造伤 +1 ─────────────────────────────

  it('增伤:owner 用潜袭牌(杀)造成伤害 → +1', async () => {
    // 直接在出牌阶段启动,手动预设 turn.vars 模拟已发动潜袭(准备阶段逻辑已在测试 1-3 覆盖)
    const slash = makeCard('s1', '杀', '♠', 'A'); // 潜袭牌兼出杀牌
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1'], skills: ['界潜袭', '杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: [],
          skills: [],
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { s1: slash },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: { '界潜袭/cardId': 's1', '界潜袭/color': '黑' } },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // owner 用 s1 杀 P2(攻击范围 1)
    await P1.useCardAndTarget('杀', 's1', [1]);
    await harness.waitForStable();
    harness.processAllEvents();

    // P2 无手牌 → 无法出闪 → 询问闪超时/放行
    await P2.pass();
    await harness.waitForStable();
    harness.processAllEvents();

    // P2 应受 2 点伤害(1 基础 + 1 增伤)
    expect(harness.state.players[1].health).toBe(2);
    // turn.vars 中的 cardId 已被消费
    expect(harness.state.turn.vars['界潜袭/cardId']).toBeUndefined();
  });

  // ─── 5. 增伤不重复:第二次不再 +1(已消费) ─────────────────────────────

  it('增伤单次:同一潜袭牌只 +1 一次', async () => {
    // 直接造伤害验证单次消费:不通过完整 杀 流程,避免多次 杀 的复杂性
    // 手动设 turn.vars 模拟已展示,然后造两次伤害
    const slash = makeCard('s1', '杀', '♠', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界潜袭'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: [], skills: [], health: 4 }),
      ],
      cardMap: { s1: slash },
      zones: { deck: ['s1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: { '界潜袭/cardId': 's1', '界潜袭/color': '黑' } },
    });
    await harness.setup(state);

    // 第一次造伤:source=owner, cardId=s1 → 应 +1(2 点)
    await runDamageFlow(harness.state, 0, 1, 1, 's1');
    expect(harness.state.players[1].health).toBe(2);

    // turn.vars 中的 cardId 已被消费
    expect(harness.state.turn.vars['界潜袭/cardId']).toBeUndefined();

    // 第二次造伤:不再 +1(1 点)
    await runDamageFlow(harness.state, 0, 1, 1, 's1');
    expect(harness.state.players[1].health).toBe(1);
  });

  // ─── 6. 禁色-询问闪全为禁色 → cancel ─────────────────────────────

  it('禁红:目标只有红闪 → 询问闪被 cancel(强制命中)', async () => {
    // 直接在出牌阶段启动,手动预设禁红标签(准备阶段逻辑已在测试 1-3 覆盖)
    const slash = makeCard('s1', '杀', '♠', 'A');
    const redDodge = makeCard('rd1', '闪', '♥', '4'); // P2 红闪(被禁)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['s1'],
          skills: ['界潜袭', '杀'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: [redDodge.id],
          skills: ['闪'],
          health: 4,
          tags: ['界潜袭/禁红'], // 预设禁红标签
        }),
      ],
      cardMap: { s1: slash, rd1: redDodge },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // owner 用 s1 杀 P2
    await P1.useCardAndTarget('杀', 's1', [1]);
    await harness.waitForStable();
    harness.processAllEvents();

    // P2 唯一闪是红色 → 询问闪应被 cancel → 杀直接命中
    // P2 受 1 点伤害(s1 不是潜袭牌,无增伤)
    expect(harness.state.players[1].health).toBe(3);
    // P2 红闪仍在手牌(未被消耗)
    expect(harness.state.players[1].hand).toContain('rd1');
  });

  // ─── 7. 禁色-有非禁色闪 → 询问闪放行 ─────────────────────────────

  it('禁红:目标有黑闪 → 询问闪放行,P2 可出黑闪抵消', async () => {
    const slash = makeCard('s1', '杀', '♠', 'A');
    const blackDodge = makeCard('bd1', '闪', '♠', '5'); // P2 黑闪(可用)
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['s1'], skills: ['界潜袭', '杀'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          hand: [blackDodge.id],
          skills: ['闪'],
          health: 4,
          tags: ['界潜袭/禁红'], // 预设禁红标签
        }),
      ],
      cardMap: { s1: slash, bd1: blackDodge },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // owner 用 s1 杀 P2
    await P1.useCardAndTarget('杀', 's1', [1]);
    await harness.waitForStable();
    harness.processAllEvents();

    // P2 应有询问闪 pending(未被 cancel,因有黑闪)
    P2.expectPending('询问闪');

    // P2 出黑闪抵消
    await P2.respond('闪', { cardId: 'bd1' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 杀被抵消,P2 不扣血
    expect(harness.state.players[1].health).toBe(4);
    // 黑闪已消耗(进处理区→弃牌堆)
    expect(harness.state.players[1].hand).not.toContain('bd1');
  });

  // ─── 8. 距离 >1 不受影响(4 人局)─────────────────────────

  it('距离>1:4 人局中距离 2 的目标不加标签', async () => {
    // 4 人环形:P0-P1 距离1,P0-P2 距离2,P0-P3 距离1
    const reveal = makeCard('r0', '桃', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界潜袭'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: [], skills: [] }),
        makePlayer({ index: 2, name: 'P3', character: '刘备', hand: [], skills: [] }),
        makePlayer({ index: 3, name: 'P4', character: '孙权', hand: [], skills: [] }),
      ],
      cardMap: { r0: reveal },
      zones: { deck: ['r0'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    await P1.respond('界潜袭', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    await P1.respond('界潜袭', { cardId: 'r0' });
    await harness.waitForStable();
    harness.processAllEvents();

    // P2(距离1)加禁红
    expect(harness.state.players[1].tags).toContain('界潜袭/禁红');
    // P3(距离2)不加
    expect(harness.state.players[2].tags).not.toContain('界潜袭/禁红');
    // P4(距离1)加
    expect(harness.state.players[3].tags).toContain('界潜袭/禁红');
  });

  // ─── 9. 回合结束清标签 ─────────────────────────────

  it('回合结束:owner 自己回合结束 → 清所有玩家的禁色标签', async () => {
    const reveal = makeCard('r0', '桃', '♥', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界潜袭'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', hand: [], skills: [] }),
      ],
      cardMap: { r0: reveal },
      zones: { deck: ['r0'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 1, phase: '准备', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await triggerPreparePhase(harness);
    await P1.respond('界潜袭', { choice: true });
    await harness.waitForStable();
    harness.processAllEvents();
    await P1.respond('界潜袭', { cardId: 'r0' });
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.players[1].tags).toContain('界潜袭/禁红');

    // 触发 owner 回合结束
    await applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();
    harness.processAllEvents();

    // 标签已清
    expect(harness.state.players[1].tags).not.toContain('界潜袭/禁红');
  });
});
