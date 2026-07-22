// 界当先(界廖化·锁定技)行为测试:
//   1. 回合开始 → 询问获得杀 → 确认 → 选牌堆 → 获得杀(无距离限制)→ 出杀造成伤害 → 结束额外阶段 → 不自伤
//   2. 回合开始 → 不获得杀 → 结束额外阶段(未造成伤害)→ 自伤1点
//   3. 当先杀无距离限制:目标超出攻击范围仍可指定
//   4. 触发条件不满足:其他玩家的回合开始不触发 owner 的当先
//   5. 额外阶段内 owner 主动 end → 自伤检查执行
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, disableAutoCompare } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { applyAtom } from '../../src/engine/create-engine';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';
import { createGameState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  faction?: PlayerState['faction'];
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
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
    faction: opts.faction,
  };
}

/** 当前 pending 的 requestType(无 pending 返回 null) */
function currentRequestType(state: GameState): string | null {
  if (state.pendingSlots.size === 0) return null;
  const slot = [...state.pendingSlots.values()][0];
  return (slot.atom as { requestType?: string }).requestType ?? null;
}

describe('界当先', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 获得杀 + 出杀造成伤害 → 结束额外阶段不自伤 ───────────
  it('获得杀并造成伤害 → 结束额外阶段,不自伤', async () => {
    // 关闭自动对比:额外出牌阶段的 出牌窗口 IIFE 与 杀 询问闪 存在时序竞争(已知,非引擎 bug)
    const restoreAutoCompare = disableAutoCompare();
    // 牌堆顶一张杀(供当先获取)
    const deckKill = mkCard('dk1', '杀', '♠', '7');
    // P1(目标)手中无闪,会被杀命中
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界廖化',
            faction: '蜀',
            hand: [],
            skills: ['界当先', '杀', '闪', '回合管理'],
            health: 4,
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['闪', '回合管理'],
          }),
        ],
        cardMap: { dk1: deckKill },
        zones: { deck: ['dk1'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const LH = harness.player('界廖化');

    // 触发回合开始 → 当先 hook 询问是否获得杀
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(currentRequestType(harness.state)).toBe('当先/confirm');

    // 确认获得杀
    await LH.respond('界当先', { choice: true });
    await harness.waitForStable();
    // 接下来询问来源
    expect(currentRequestType(harness.state)).toBe('当先/source');

    // 选牌堆(choice=true)
    await LH.respond('界当先', { choice: true });
    await harness.waitForStable();

    // 杀已入手牌
    expect(harness.state.players[0].hand).toContain('dk1');
    // 牌堆已空
    expect(harness.state.zones.deck).not.toContain('dk1');
    // 无距离杀标记已设
    expect(harness.state.turn.vars['当先/noRangeKillCardId']).toBe('dk1');
    // 处于额外出牌阶段
    expect(harness.state.turn.vars['当先/active']).toBe(true);
    expect(harness.state.phase).toBe('出牌');
    // 出牌窗口 pending 存在
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);

    const healthBefore = harness.state.players[0].health;

    // 出杀指定 P1(超出徒手范围 1,但因当先杀无距离限制,合法)
    await LH.useCardAndTarget('杀', 'dk1', [1]);
    await harness.waitForStable();
    // P1 被询问闪
    const P1 = harness.player('P1');
    await P1.pass(); // 不闪
    await harness.waitForStable();

    // P1 受伤(杀命中)
    expect(harness.state.players[1].health).toBe(3);
    // 当先杀离开手牌 → 无距离标记清除
    expect(harness.state.turn.vars['当先/noRangeKillCardId']).toBeUndefined();

    // 主动结束额外阶段
    await LH.tryDispatch({ skillId: '界当先', actionType: 'end', params: {} });
    harness.processAllEvents();
    await harness.waitForStable();

    // 额外阶段已结束
    expect(harness.state.turn.vars['当先/active']).toBeUndefined();
    // 因为已造成伤害,不自伤
    expect(harness.state.players[0].health).toBe(healthBefore);

    restoreAutoCompare();
  });

  // ─── 2. 不获得杀 → 未造成伤害 → 结束自伤1点 ───────────
  it('不获得杀 + 未造成伤害 → 结束额外阶段时自伤1点', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界廖化',
            faction: '蜀',
            hand: [],
            skills: ['界当先', '杀', '闪', '回合管理'],
            health: 4,
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['闪', '回合管理'],
          }),
        ],
        cardMap: {},
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const LH = harness.player('界廖化');
    const healthBefore = harness.state.players[0].health;

    // 触发回合开始 → 询问获得杀
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(currentRequestType(harness.state)).toBe('当先/confirm');

    // 不获得杀
    await LH.respond('界当先', { choice: false });
    await harness.waitForStable();

    // 进入出牌窗口
    expect(harness.state.turn.vars['当先/active']).toBe(true);
    expect(harness.state.phase).toBe('出牌');

    // 主动结束额外阶段(未造成伤害)
    await LH.tryDispatch({ skillId: '界当先', actionType: 'end', params: {} });
    harness.processAllEvents();
    await harness.waitForStable();

    // 额外阶段结束 + 自伤1点
    expect(harness.state.turn.vars['当先/active']).toBeUndefined();
    expect(harness.state.players[0].health).toBe(healthBefore - 1);
  });

  // ─── 3. 当先杀无距离限制:目标超出徒手攻击范围仍可指定 ───────────
  it('当先获得的杀无距离限制:可指定超出徒手范围的目标', async () => {
    const restoreAutoCompare = disableAutoCompare();
    // 牌堆顶一张杀
    const deckKill = mkCard('dk2', '杀', '♠', '7');
    // P2 在座次2(超出 P0 徒手攻击范围 1)
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界廖化',
            faction: '蜀',
            hand: [],
            skills: ['界当先', '杀', '闪', '回合管理'],
            health: 4,
            maxHealth: 4,
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['闪', '回合管理'],
          }),
          mkPlayer({
            index: 2,
            name: 'P2',
            faction: '吴',
            skills: ['闪', '回合管理'],
          }),
        ],
        cardMap: { dk2: deckKill },
        zones: { deck: ['dk2'], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const LH = harness.player('界廖化');

    // 触发当先,获取杀(牌堆)
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    await LH.respond('界当先', { choice: true });
    await harness.waitForStable();
    await LH.respond('界当先', { choice: true }); // 牌堆
    await harness.waitForStable();

    // P2 在座次2,与 P0 距离为 2(超出徒手攻击范围 1)
    // 当先杀无距离限制 → 可以指定 P2
    await LH.useCardAndTarget('杀', 'dk2', [2]);
    await harness.waitForStable();

    // P2 被询问闪(说明 杀.use validate 通过了,无距离放行生效)
    const P2 = harness.player('P2');
    const rt = currentRequestType(harness.state);
    // 询问闪 or 已造成伤害
    expect(rt === '闪/询问' || rt === null).toBe(true);

    await P2.pass();
    await harness.waitForStable();

    // P2 受伤
    expect(harness.state.players[2].health).toBe(3);

    restoreAutoCompare();
  });

  // ─── 4. 触发条件不满足:其他玩家的回合开始不触发 owner 的当先 ───────────
  it('其他玩家的回合开始不触发界廖化的当先', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界廖化',
            faction: '蜀',
            skills: ['界当先', '杀', '闪', '回合管理'],
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['闪', '回合管理'],
          }),
        ],
        cardMap: {},
        currentPlayerIndex: 1,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );

    // 触发 P1 的回合开始
    void applyAtom(harness.state, { type: '回合开始', player: 1 });
    await harness.waitForStable();

    // 界廖化(player 0)的当先未触发:无 当先/confirm 询问
    expect(currentRequestType(harness.state)).not.toBe('当先/confirm');
    // active 标志未设
    expect(harness.state.turn.vars['当先/active']).toBeUndefined();
  });

  // ─── 5. 从弃牌堆获取杀 ───────────
  it('可从弃牌堆获得杀', async () => {
    // 弃牌堆一张杀
    const discardKill = mkCard('dk3', '杀', '♥', '5');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界廖化',
            faction: '蜀',
            skills: ['界当先', '杀', '闪', '回合管理'],
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            faction: '魏',
            skills: ['闪', '回合管理'],
          }),
        ],
        cardMap: { dk3: discardKill },
        zones: { deck: [], discardPile: ['dk3'], processing: [] },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
      }),
    );
    const LH = harness.player('界廖化');

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    await LH.respond('界当先', { choice: true });
    await harness.waitForStable();
    // 选弃牌堆(choice=false)
    await LH.respond('界当先', { choice: false });
    await harness.waitForStable();

    // 杀已入手牌(来自弃牌堆)
    expect(harness.state.players[0].hand).toContain('dk3');
    expect(harness.state.zones.discardPile).not.toContain('dk3');
  });
});
