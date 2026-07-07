// 救援(孙权·主公技)测试
//   其他吴势力角色对濒死状态的你使用【桃】时,该角色额外回复1点体力。
//
// 验证:
//   1. happy path:吴角色出桃救濒死主公孙权 → 救援触发,该吴角色额外 +1 体力
//   2. 非吴势力:蜀角色出桃救孙权 → 救援不触发
//   3. 非主公:孙权不在主公位(座次≠0) → 救援不触发
//   4. 自救:孙权自己出桃自救 → 救援不触发("其他角色"限制)
//
// 备注:事实来源为 docs/research/武将技能/吴国/孙权.md(任务描述与此冲突,以文档为准)。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, Faction, GameState, Json, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suit === '♠' || suit === '♣' ? '黑' : '红', rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  health?: number;
  maxHealth?: number;
  alive?: boolean;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  vars?: Record<string, Json>;
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: opts.faction ?? '吴',
  };
}

describe('救援', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── happy path ────────────────────────────────────────────
  it('吴角色出桃救濒死主公孙权 → 救援触发,该吴角色额外 +1 体力', async () => {
    const peach = makeCard('peach', '桃', '♥', '5');
    const state: GameState = createGameState({
      players: [
        // P0 = 孙权(主公位 0,吴),体力 1,即将被打入濒死
        makePlayer({
          index: 0,
          name: '孙权',
          character: '孙权',
          health: 1,
          maxHealth: 4,
          skills: ['救援'],
          faction: '吴',
        }),
        // P1 = 甘宁(吴),持桃,救援者
        makePlayer({
          index: 1,
          name: '甘宁',
          character: '甘宁',
          health: 3,
          maxHealth: 4,
          hand: ['peach'],
          skills: ['桃'],
          faction: '吴',
        }),
      ],
      cardMap: { peach },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('孙权');
    const P1 = harness.player('甘宁');

    // 造成1点伤害:孙权 1 → 0,进入濒死求桃流程
    void applyAtom(harness.state, { type: '造成伤害', target: 0, amount: 1, source: 1 });
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(0);

    // 求桃先问濒死者孙权(无桃) → pass
    P0.expectPending('请求回应');
    await P0.pass();

    // 再问甘宁 → 出桃救援
    P1.expectPending('请求回应');
    await P1.respond('桃', { cardId: 'peach' });

    // 孙权被救回 0 → 1
    expect(harness.state.players[0].health).toBe(1);
    // 救援触发:甘宁额外回复1点 3 → 4
    expect(harness.state.players[1].health).toBe(4);
    // 桃已用掉,进弃牌堆
    expect(harness.state.zones.discardPile).toContain('peach');
  });

  // ─── 非吴势力救援者 → 救援不触发 ────────────────────────────
  it('蜀势力角色出桃救孙权 → 救援不触发(仅吴势力)', async () => {
    const peach = makeCard('peach', '桃', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '孙权',
          character: '孙权',
          health: 1,
          maxHealth: 4,
          skills: ['救援'],
          faction: '吴',
        }),
        // P1 = 蜀势力角色(非吴),持桃
        makePlayer({
          index: 1,
          name: '张飞',
          character: '张飞',
          health: 3,
          maxHealth: 4,
          hand: ['peach'],
          skills: ['桃'],
          faction: '蜀',
        }),
      ],
      cardMap: { peach },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('孙权');
    const P1 = harness.player('张飞');

    void applyAtom(harness.state, { type: '造成伤害', target: 0, amount: 1, source: 1 });
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(0);

    // 孙权无桃 → pass;张飞出桃救援
    await P0.pass();
    await P1.respond('桃', { cardId: 'peach' });

    // 孙权被救回 0 → 1
    expect(harness.state.players[0].health).toBe(1);
    // 救援不触发:张飞是蜀势力,不额外回复
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 孙权非主公(座次≠0) → 救援不触发 ────────────────────────
  it('孙权不在主公位 → 救援不触发(主公技限制)', async () => {
    const peach = makeCard('peach', '桃', '♥', '5');
    const state: GameState = createGameState({
      players: [
        // P0 = 甘宁(吴),救援者;占据主公位 0 但此处非主公技持有者
        makePlayer({
          index: 0,
          name: '甘宁',
          character: '甘宁',
          health: 3,
          maxHealth: 4,
          hand: ['peach'],
          skills: ['桃'],
          faction: '吴',
        }),
        // P1 = 孙权(吴),座次 1 → 非主公位,救援不生效
        makePlayer({
          index: 1,
          name: '孙权',
          character: '孙权',
          health: 1,
          maxHealth: 4,
          skills: ['救援'],
          faction: '吴',
        }),
      ],
      cardMap: { peach },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('孙权');
    const P0 = harness.player('甘宁');

    // 孙权(座次1)受伤 → 濒死;求桃从濒死者(P1)开始问
    void applyAtom(harness.state, { type: '造成伤害', target: 1, amount: 1, source: 0 });
    await harness.waitForStable();
    expect(harness.state.players[1].health).toBe(0);

    // 先问孙权(P1,无桃) → pass;再问甘宁(P0) → 出桃救援
    await P1.pass();
    await P0.respond('桃', { cardId: 'peach' });

    // 孙权被救回 0 → 1
    expect(harness.state.players[1].health).toBe(1);
    // 救援不触发:孙权不在主公位(ownerId!==0),甘宁不额外回复
    expect(harness.state.players[0].health).toBe(3);
  });

  // ─── 孙权自救 → 救援不触发("其他角色"限制) ──────────────────
  it('孙权自己出桃自救 → 救援不触发(仅其他角色)', async () => {
    const peach = makeCard('peach', '桃', '♥', '5');
    const state: GameState = createGameState({
      players: [
        // P0 = 孙权(主公位 0,吴),自持桃
        makePlayer({
          index: 0,
          name: '孙权',
          character: '孙权',
          health: 1,
          maxHealth: 4,
          hand: ['peach'],
          skills: ['救援', '桃'],
          faction: '吴',
        }),
        makePlayer({
          index: 1,
          name: '甘宁',
          character: '甘宁',
          health: 4,
          maxHealth: 4,
          faction: '吴',
        }),
      ],
      cardMap: { peach },
      zones: { deck: [], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('孙权');

    // 孙权 1 → 0,濒死;求桃先问孙权自己
    void applyAtom(harness.state, { type: '造成伤害', target: 0, amount: 1, source: 1 });
    await harness.waitForStable();
    expect(harness.state.players[0].health).toBe(0);

    // 孙权自己出桃自救
    P0.expectPending('请求回应');
    await P0.respond('桃', { cardId: 'peach' });

    // 孙权被救回 0 → 1;救援不触发(自救),不会额外 +1(否则会是 2)
    expect(harness.state.players[0].health).toBe(1);
  });
});
