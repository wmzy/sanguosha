// 武烈(界孙坚·吴·限定技)测试(OL hero/458 官方逐字):
//   "限定技,结束阶段,你可以失去任意点体力,令X名其他角色获得'烈'标记
//    (X为以此法失去的体力值)。当有'烈'的角色受到伤害时,其移除'烈'并防止此伤害。"
//
// 测试场景:
//   1. 基础:孙坚发动武烈,失去2点体力,令2名角色各获1个「烈」
//   2. 「烈」防止伤害:持有「烈」的角色受到伤害 → 防止 + 移去1枚「烈」
//   3. 限定技只用一次:第二次结束阶段无法再触发
//   4. 不发动:结束阶段选择不发动 → 无效果
//   5. 失血致死:失去体力=当前体力 → 进入濒死(无桃)→ 死亡 → 不发标记
//
// 触发方式:直接 applyAtom(阶段开始, phase='回合结束') 触发武烈 after-hook。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  vars?: Record<string, unknown>;
  marks?: GameState['players'][number]['marks'];
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: (opts.vars ?? {}) as GameState['players'][number]['vars'],
    marks: opts.marks ?? [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 触发孙坚(player 0)的结束阶段 */
function triggerEndPhase(harness: SkillTestHarness): void {
  void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
}

describe('武烈', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 基础:发动武烈,失2体力,2名目标各获1个「烈」 ─────────────
  it('孙坚失2体力 → 2名其他角色各获1个「烈」标记', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙坚',
            character: '界孙坚',
            skills: ['武烈'],
            health: 4,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', skills: [] }),
        ],
        cardMap: {},
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: { round: 1, phase: '回合结束', vars: {} },
      }),
    );
    const SJ = harness.player('界孙坚');

    triggerEndPhase(harness);
    await harness.waitForStable();
    SJ.expectPending('请求回应');
    await SJ.respond('武烈', { choice: true }); // 发动
    await harness.waitForStable();
    // 失去体力询问
    await SJ.respond('武烈', { hpCount: 2 });
    await harness.waitForStable();
    // 选 2 名其他角色
    await SJ.respond('武烈', { targets: [1, 2] });
    await harness.waitForStable();

    // 孙坚失2体力(4→2),限定技已用
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[0].vars['武烈/used']).toBe(true);
    // P1/P2 各获1个「烈」标记
    expect(harness.state.players[1].marks.filter((m) => m.id === '武烈/烈').length).toBe(1);
    expect(harness.state.players[2].marks.filter((m) => m.id === '武烈/烈').length).toBe(1);
  });

  // ─── 「烈」防止伤害 + 移去1枚 ─────────────────────────────
  it('持有「烈」的角色受到伤害 → 防止伤害,移去1枚「烈」', async () => {
    const slash = mkCard('s1', '杀', '♠', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙坚',
            character: '界孙坚',
            skills: ['武烈'],
            health: 4,
            maxHealth: 4,
            // 直接预设限定技已用 + P1 持有「烈」(跳过发动流程)
            vars: { '武烈/used': true },
          }),
          mkPlayer({
            index: 1,
            name: 'P1',
            character: '反',
            hand: [],
            skills: ['杀'],
            health: 4,
            maxHealth: 4,
            marks: [{ id: '武烈/烈', scope: 1, payload: { source: 0 } }],
          }),
          mkPlayer({
            index: 2,
            name: 'P2',
            character: '反',
            hand: [slash.id],
            skills: ['杀'],
          }),
        ],
        cardMap: { s1: slash },
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 2,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );

    const P2 = harness.player('P2');
    const P1 = harness.player('P1');

    // P2 对 P1 出杀
    await P2.useCardAndTarget('杀', 's1', [1]);
    await P1.pass(); // P1 不出闪 → 应受到伤害
    await harness.waitForStable();

    // 武烈防止此伤害:P1 体力不变(仍是4),「烈」被移去
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[1].marks.filter((m) => m.id === '武烈/烈').length).toBe(0);
  });

  // ─── 限定技只用一次 ────────────────────────────────────────
  it('武烈已用 → 第二次结束阶段不再触发', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙坚',
            character: '界孙坚',
            skills: ['武烈'],
            health: 4,
            maxHealth: 4,
            vars: { '武烈/used': true }, // 已用
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
        ],
        cardMap: {},
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: { round: 2, phase: '回合结束', vars: {} },
      }),
    );

    triggerEndPhase(harness);
    await harness.waitForStable();
    // 已用过 → 不询问
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 不发动 ────────────────────────────────────────────────
  it('孙坚选择不发动 → 无效果', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙坚',
            character: '界孙坚',
            skills: ['武烈'],
            health: 4,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
        ],
        cardMap: {},
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: { round: 1, phase: '回合结束', vars: {} },
      }),
    );
    const SJ = harness.player('界孙坚');

    triggerEndPhase(harness);
    await harness.waitForStable();
    SJ.expectPending('请求回应');
    await SJ.respond('武烈', { choice: false }); // 不发动
    await harness.waitForStable();

    // 体力不变,限定技未用,无标记
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.players[0].vars['武烈/used']).toBeUndefined();
    expect(harness.state.players[1].marks.length).toBe(0);
  });

  // ─── 失血致死:失去全部体力,无桃救援 → 死亡 → 不发标记 ──────
  it('孙坚失去全部体力 → 濒死无人救 → 死亡 → 不发标记', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: '界孙坚',
            character: '界孙坚',
            skills: ['武烈'],
            health: 2,
            maxHealth: 4,
          }),
          mkPlayer({ index: 1, name: 'P1', character: '反', skills: [] }),
          mkPlayer({ index: 2, name: 'P2', character: '反', skills: [] }),
        ],
        cardMap: {},
        zones: { deck: [], discardPile: [], processing: [] },
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: { round: 1, phase: '回合结束', vars: {} },
      }),
    );
    const SJ = harness.player('界孙坚');

    triggerEndPhase(harness);
    await harness.waitForStable();
    SJ.expectPending('请求回应');
    await SJ.respond('武烈', { choice: true });
    await harness.waitForStable();
    // 选择失去 2 点体力(= 当前体力,会进入濒死)
    await SJ.respond('武烈', { hpCount: 2 });
    await harness.waitForStable();
    // 选 2 名目标
    await SJ.respond('武烈', { targets: [1, 2] });
    await harness.waitForStable();

    // 孙坚失2体力 → 体力0 → 进入濒死 → 求桃;无桃 → pass 掉所有求桃
    while (harness.state.pendingSlots.size > 0) {
      const slot = [...harness.state.pendingSlots.values()][0];
      const target = (slot.atom as { target?: number }).target ?? 0;
      await harness.player(target).pass();
      await harness.waitForStable();
    }

    // 孙坚死亡;限定技已用(标记在失血前已写);P1/P2 未获「烈」标记
    expect(harness.state.players[0].alive).toBe(false);
    expect(harness.state.players[0].vars['武烈/used']).toBe(true);
    expect(harness.state.players[1].marks.filter((m) => m.id === '武烈/烈').length).toBe(0);
    expect(harness.state.players[2].marks.filter((m) => m.id === '武烈/烈').length).toBe(0);
  });
});
