// 界将驰(界曹彰·主动技)测试,OL hero/599 官方逐字:
//   "摸牌阶段结束时，你可以选择一项：
//    1.摸一张牌，你本回合使用【杀】的次数-1，且【杀】不计入手牌上限；
//    2.重铸一张牌，且本回合使用【杀】的次数+1，【杀】无距离限制。"
//
// 验证:
//   1. 选项①:摸一张牌 + 杀次数-1(出杀被拒) + 杀不计入手牌上限
//   2. 选项②:重铸一张手牌(弃+摸)+ 杀次数+1(可出两次)+ 杀无距离限制
//   3. 不发动(询问①取消)
//   4. 跳过摸牌阶段(兵粮寸断式)→ 不触发将驰
//   5. 杀不计入手牌上限:验证弃牌阶段手牌上限计算
//   6. 杀无距离限制:验证对超距目标出杀放行
//   7. 选项②重铸:手牌为空时不进入 PICK 询问
//   8. 选项①杀次数-1 与装备连弩(∞)叠加:仍阻断(blocker 优先)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { slashMax, slashUsed } from '../../src/engine/slash-quota';
import { handLimit } from '../../src/engine/hand-limit';
import type { Card, GameState } from '../../src/engine/types';

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
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界曹彰',
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

describe('界将驰', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 选项①:摸一张牌 + 杀次数-1(阻断)+ 杀不计入手牌上限 ────────────
  it('选项①:摸一张牌,本回合不能出杀,杀不计入手牌上限', async () => {
    const d1 = makeCard('d1', '桃', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界将驰'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { d1 },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 阶段开始(摸牌)→ 标记正常开始;再走 阶段结束 → 触发将驰
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    // 询问①:是否发动?
    P0.expectPending('请求回应');
    await P0.respond('界将驰', { choice: true }); // 发动
    await harness.waitForStable();
    // 询问②:选①还是②?当前手牌为空,跳过(自动走①)
    // 验证:摸了一张牌(d1 入手牌)+ turn.vars['将驰/choice1']=0
    expect(harness.state.players[0].hand).toContain('d1');
    expect(harness.state.turn.vars['将驰/choice1']).toBe(0);

    // 杀次数-1:canSlash=false(默认基础1→0)
    expect(slashMax(harness.state, 0)).toBe(1); // 基础上限不变(blocker 独立)
    expect(slashUsed(harness.state)).toBe(0);
    // 验证阻断:模拟杀牌出杀应被拒
    const slash = makeCard('s1', '杀', '♠', '7');
    harness.state.cardMap['s1'] = slash;
    harness.state.players[0].hand.push('s1');
    await P0.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 's1', targets: [1] },
    });
  });

  // ─── 选项①杀不计入手牌上限:验证 handLimit 把杀牌加回 ────────────
  it('选项①:杀不计入手牌上限(handLimit = 体力 + 杀牌数)', async () => {
    // 设 P0 体力=2,手牌含 3 张杀 → 默认上限 2;选项①后上限 = 2+3 = 5
    const s1 = makeCard('s1', '杀', '♠', '7');
    const s2 = makeCard('s2', '杀', '♥', '8');
    const s3 = makeCard('s3', '杀', '♣', '9');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 's2', 's3'],
          skills: ['界将驰'],
          health: 2,
          maxHealth: 4,
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { s1, s2, s3 },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 触发将驰并选①
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    await P0.respond('界将驰', { choice: true }); // 发动
    await harness.waitForStable();
    // 询问②(手牌非空,要选)
    P0.expectPending('请求回应');
    await P0.respond('界将驰', { choice: true }); // ①摸一张
    await harness.waitForStable();

    // 选项①激活:handLimit 应为 体力(2) + 杀牌数(3) = 5
    expect(harness.state.turn.vars['将驰/choice1']).toBe(0);
    expect(handLimit(harness.state, 0)).toBe(5);
  });

  // ─── 选项②:重铸一张手牌 + 杀次数+1 ────────────
  it('选项②:重铸一张手牌(弃+摸),杀次数+1', async () => {
    // P0 手牌 [x1](重铸代价);牌堆顶 [d1](重铸后摸到)
    // deck 末尾为顶,故 [s1(底), d1(顶)] → 摸牌取 d1
    const x1 = makeCard('x1', '闪', '♥', '3');
    const d1 = makeCard('d1', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['x1'], skills: ['界将驰'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { x1, d1 },
      zones: { deck: ['d1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 触发将驰
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    await P0.respond('界将驰', { choice: true }); // 发动
    await harness.waitForStable();
    // 询问②:选①或②?
    P0.expectPending('请求回应');
    await P0.respond('界将驰', { choice: false }); // ②重铸一张
    await harness.waitForStable();
    // 询问③:选哪张手牌重铸
    P0.expectPending('请求回应');
    await P0.respond('界将驰', { cardId: 'x1' });
    await harness.waitForStable();

    // 重铸:x1 进弃牌堆,d1 入手牌(净手牌数不变)
    expect(harness.state.zones.discardPile).toContain('x1');
    expect(harness.state.players[0].hand).toContain('d1');
    expect(harness.state.players[0].hand).not.toContain('x1');
    expect(harness.state.players[0].hand).toHaveLength(1);

    // 杀次数+1:slashMax=2(基础1+provider加1)
    expect(slashMax(harness.state, 0)).toBe(2);
    expect(harness.state.turn.vars['将驰/choice2']).toBe(0);
  });

  // ─── 选项②杀无距离限制:预置 turn.vars,3 人座次跨距出杀 ────────────
  it('选项②:杀无距离限制(可对超距目标出杀)', async () => {
    // 3 人座次,无武器时 P0 攻击范围=1,P2(距离 2)超距
    // 预置 turn.vars['将驰/choice2']=0 模拟选项②已发动
    const slash = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['界将驰', '杀'],
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
        makePlayer({ index: 2, name: 'P2', character: '刘备' }),
      ],
      cardMap: { s1: slash },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: { '将驰/choice2': 0 } },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');

    // 对 P2(超距)出杀:应放行(无距离限制)
    await P0.useCardAndTarget('杀', 's1', [2]);
    await harness.waitForStable();
    await P2.pass(); // 不出闪
    await harness.waitForStable();

    // P2 受伤 → 杀成功(证明无距离限制生效)
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 不发动(询问①取消) ────────────────────
  it('不发动:询问①取消 → 无效果', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['x1'], skills: ['界将驰'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { x1: makeCard('x1', '闪', '♥', '3') },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    await P0.respond('界将驰', { choice: false }); // 不发动
    await harness.waitForStable();

    expect(harness.state.turn.vars['将驰/choice1']).toBeUndefined();
    expect(harness.state.turn.vars['将驰/choice2']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['x1']); // 手牌未变
  });

  // ─── 跳过摸牌阶段(兵粮寸断式)→ 不触发将驰 ────────────
  it('跳过摸牌阶段:normalDrawPhase 标记缺失 → 不触发', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界将驰'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 直接走 阶段结束(摸牌),不先走 阶段开始(摸牌)→ 标记缺失 → 不触发
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '摸牌' });
    await harness.waitForStable();

    // 不应有将驰询问 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.turn.vars['将驰/choice1']).toBeUndefined();
    expect(harness.state.turn.vars['将驰/choice2']).toBeUndefined();
    void P0; // 防止 unused
  });

  // ─── 选项②超时(PICK 阶段无 cardId)→ 不发动 ────────────
  it('选项② PICK 超时 → 不发动(无副作用)', async () => {
    const x1 = makeCard('x1', '闪', '♥', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['x1'], skills: ['界将驰'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { x1 },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '摸牌' });
    await harness.waitForStable();
    await P0.respond('界将驰', { choice: true }); // 发动
    await harness.waitForStable();
    await P0.respond('界将驰', { choice: false }); // ②重铸
    await harness.waitForStable();
    // PICK 询问:超时(pass)
    P0.expectPending('请求回应');
    await P0.pass(); // 超时
    await harness.waitForStable();

    // 不发动:无 choice2 标记,手牌未变
    expect(harness.state.turn.vars['将驰/choice2']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(['x1']);
    expect(harness.state.zones.discardPile).toEqual([]);
  });

  // ─── 选项②杀次数+1:可连出两张杀 ────────────
  it('选项②:可连续出两次杀(slashMax=2)', async () => {
    // 准备:已发动选项②,进入出牌阶段,P0 有两张杀
    const s1 = makeCard('s1', '杀', '♠', '7');
    const s2 = makeCard('s2', '杀', '♣', '8');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1', 's2'],
          skills: ['界将驰', '杀'],
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { s1, s2 },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: { '将驰/choice2': 0 } },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // slashMax 应为 2
    expect(slashMax(harness.state, 0)).toBe(2);

    // 第一次出杀
    await P0.useCardAndTarget('杀', 's1', [1]);
    await harness.waitForStable();
    await P1.pass(); // 不出闪
    await harness.waitForStable();
    expect(harness.state.players[1].health).toBe(3);
    expect(slashUsed(harness.state)).toBe(1);

    // 第二次出杀(应允许,次数+1 后上限 2)
    await P0.useCardAndTarget('杀', 's2', [1]);
    await harness.waitForStable();
    await P1.pass();
    await harness.waitForStable();
    expect(harness.state.players[1].health).toBe(2);
    expect(slashUsed(harness.state)).toBe(2);
  });

  // ─── 选项①杀阻断:blocker 优先于其他无限源(连弩) ────────────
  it('选项①+诸葛连弩:blocker 阻断出杀(阻断优先)', async () => {
    const s1 = makeCard('s1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['s1'],
          skills: ['界将驰', '杀', '诸葛连弩'],
        }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: { s1 },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: { '将驰/choice1': 0 } },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 连弩提供 ∞,但 blocker 阻断 → 出杀应被拒
    await P0.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 's1', targets: [1] },
    });
  });

  // ─── turn.vars 在回合结束自动清空(由 回合结束 atom 处理) ────────────
  it('turn.vars 在回合结束自动清空', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['界将驰'] }),
        makePlayer({ index: 1, name: 'P1', character: '曹操' }),
      ],
      cardMap: {},
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: { '将驰/choice1': 0, '将驰/choice2': 0 } },
    });
    await harness.setup(state);

    // 触发回合结束 atom → turn.vars 自动清空
    void applyAtom(harness.state, { type: '回合结束', player: 0 });
    await harness.waitForStable();

    expect(harness.state.turn.vars['将驰/choice1']).toBeUndefined();
    expect(harness.state.turn.vars['将驰/choice2']).toBeUndefined();
  });
});
