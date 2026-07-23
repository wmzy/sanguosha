// 断肠(蔡文姬·锁定技)测试
//   杀死蔡文姬的角色立即失去所有技能直到游戏结束(装备仍生效)。
//
// 验证:
//   1. 被杀致死 → 杀手失去武将技(保留 DEFAULT_SKILLS)
//   2. 杀手装备自带技能保留(FAQ)
//   3. 未死亡(存活)→ 断肠不触发,杀手技能不变
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  subtype?: string,
): Card {
  const color = suit === '♥' || suit === '♦' ? '红' : '黑';
  return { id, name, suit, color, rank, type, ...(subtype ? { subtype } : {}) };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: GameState['players'][number]['equipment'];
}): GameState['players'][number] {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '蔡文姬',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 推进所有 pending(求桃流程)直到无 pending */
async function drainPendings(harness: SkillTestHarness): Promise<void> {
  while (harness.state.pendingSlots.size > 0) {
    const slot = [...harness.state.pendingSlots.values()][0];
    const target = (slot.atom as { target?: number }).target;
    await harness.player(target ?? 0).pass();
    await harness.waitForStable();
  }
}

describe('断肠', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 被杀致死:杀手失去武将技 ────────────────────
  it('被杀致死:杀手失去武将技(保留默认技能)', async () => {
    const slash = mkCard('k1', '杀', '♠', '7');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '蔡文姬', hand: [], skills: ['悲歌', '断肠'], health: 1 }),
          mkPlayer({
            index: 1,
            name: 'P1',
            character: '关羽',
            hand: ['k1'],
            skills: ['杀', '武圣'],
          }),
        ],
        cardMap: { k1: slash },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const P0 = harness.player('蔡文姬');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass(); // 不闪
    await harness.waitForStable();
    // 蔡文姬无手牌 → 悲歌不发动;进入求桃流程 → 无人救 → 死亡 → 断肠触发
    await drainPendings(harness);

    expect(harness.state.players[0].alive).toBe(false);
    // 杀手失去武将技「武圣」,保留默认技能「使用牌」「打出牌」
    expect(harness.state.players[1].skills).not.toContain('武圣');
    expect(harness.state.players[1].skills).toContain('使用牌');
  });

  // ─── 装备技能保留 ────────────────────────────
  it('装备自带技能保留(FAQ)', async () => {
    const slash = mkCard('k1', '杀', '♠', '7');
    const nu = mkCard('np1', '诸葛连弩', '♣', 'A', '装备牌', '武器');
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: '蔡文姬', hand: [], skills: ['悲歌', '断肠'], health: 1 }),
          mkPlayer({
            index: 1,
            name: 'P1',
            character: '关羽',
            hand: ['k1'],
            skills: ['杀', '武圣', '诸葛连弩'],
            equipment: { 武器: 'np1' },
          }),
        ],
        cardMap: { k1: slash, np1: nu },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const P0 = harness.player('蔡文姬');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass();
    await harness.waitForStable();
    await drainPendings(harness);

    expect(harness.state.players[0].alive).toBe(false);
    // 武将技「武圣」被移除
    expect(harness.state.players[1].skills).not.toContain('武圣');
    // 装备技能「诸葛连弩」与默认技能「使用牌」「打出牌」保留
    expect(harness.state.players[1].skills).toContain('诸葛连弩');
    expect(harness.state.players[1].skills).toContain('使用牌');
  });

  // ─── 未死亡:断肠不触发 ────────────────────────────
  it('未死亡:断肠不触发,杀手技能不变', async () => {
    const slash = mkCard('k1', '杀', '♠', '7');
    await harness.setup(
      createGameState({
        players: [
          // 满血:受 1 点杀伤后仍存活(3→2)
          mkPlayer({ index: 0, name: '蔡文姬', hand: [], skills: ['悲歌', '断肠'], health: 3 }),
          mkPlayer({
            index: 1,
            name: 'P1',
            character: '关羽',
            hand: ['k1'],
            skills: ['杀', '武圣'],
          }),
        ],
        cardMap: { k1: slash },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const P0 = harness.player('蔡文姬');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    await P0.pass(); // 不闪
    await harness.waitForStable();

    // 蔡文姬存活,未死亡 → 断肠不触发
    expect(harness.state.players[0].alive).toBe(true);
    expect(harness.state.players[0].health).toBe(2);
    expect(harness.state.players[1].skills).toContain('武圣');
    expect(harness.state.pendingSlots.size).toBe(0);
  });
});
