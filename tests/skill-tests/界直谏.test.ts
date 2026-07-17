// 界直谏(界张昭张纮·吴·主动技·OL 界限突破版):
//   出牌阶段,你可以将一张装备牌置入一名其他角色的装备区(可替换原装备),然后摸一张牌。
//
// 验证:
//   1. 主动 use:置装备于他人空装备区 + 摸1张
//   2. 【OL 核心差异·可替换】目标已有同栏位装备 → 替换(旧装备入弃牌堆)+ 摸1张
//   3. 【被动已删除】自己出牌阶段用装备通用装装备 → 不再摸牌(OL 版无此被动)
//   4. 【不误触发】他人装装备时,自己的界直谏不摸牌(player 隔离)
//   5. 负面:对自己使用 → 拒绝
//   6. 负面:非装备牌 → 拒绝
//   7. 负面:非自己回合主动 use → 拒绝
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
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

/** 装备牌工厂 */
function makeEquip(
  id: string,
  name: string,
  subtype: '武器' | '防具' | '进攻马' | '防御马' | '宝物',
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '装备牌', subtype };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  equipment?: Record<string, string>;
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

describe('界直谏(OL 界限突破版)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 主动 use:置装备于他人空装备区 + 摸1张 ───────────────

  it('主动 use:将装备牌置于他人空装备区 → 装备成功 + 摸1张', async () => {
    const armor = makeEquip('rw', '仁王盾', '防具', '♣', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['rw'], skills: ['界直谏'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { rw: armor },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const handBefore = harness.state.players[0].hand.length; // 1
    await P1.useCardAndTarget('界直谏', 'rw', [1]);

    // P2 装备区有防具 + 仁王盾技能挂载
    expect(harness.state.players[1].equipment['防具']).toBe('rw');
    expect(harness.state.players[1].skills).toContain('仁王盾');
    // P1:-1(出装备) +1(摸牌) = 净 0 → 手牌数不变(为摸到的牌)
    expect(harness.state.players[0].hand.length).toBe(handBefore);
    expect(harness.state.players[0].hand).not.toContain('rw');
  });

  it('主动 use:武器牌置于他人空武器区 → 装备成功 + 摸1张', async () => {
    const weapon = makeEquip('w1', '诸葛连弩', '武器', '♦', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['w1'], skills: ['界直谏'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('界直谏', 'w1', [1]);

    expect(harness.state.players[1].equipment['武器']).toBe('w1');
    expect(harness.state.players[1].skills).toContain('诸葛连弩');
  });

  // ─── 2.【OL 核心差异·可替换原装备】──────────────────────

  it('可替换:目标已有防具 → 旧防具入弃牌堆、新防具装备成功 + 摸1张', async () => {
    // 使用未注册技能的装备名,隔离替换机制本身(不牵涉 添加/移除技能)
    const armor1 = makeEquip('rw1', '测试防具甲', '防具', '♣', '2');
    const armor2 = makeEquip('rw2', '测试防具乙', '防具', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['rw2'], skills: ['界直谏'] }),
        makePlayer({ index: 1, name: 'P2', equipment: { 防具: 'rw1' } }),
      ],
      cardMap: { rw1: armor1, rw2: armor2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const handBefore = harness.state.players[0].hand.length; // 1
    await P1.useCardAndTarget('界直谏', 'rw2', [1]);

    // P2 防具被替换为 rw2
    expect(harness.state.players[1].equipment['防具']).toBe('rw2');
    // 旧防具 rw1 进弃牌堆
    expect(harness.state.zones.discardPile).toContain('rw1');
    // P1 摸1张:净 0
    expect(harness.state.players[0].hand.length).toBe(handBefore);
  });

  it('可替换(带技能装备):旧技能移除、新技能挂载', async () => {
    const armor1 = makeEquip('rw1', '仁王盾', '防具', '♣', '2');
    const armor2 = makeEquip('rw2', '白银狮子', '防具', '♣', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['rw2'], skills: ['界直谏'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['仁王盾'],
          equipment: { 防具: 'rw1' },
        }),
      ],
      cardMap: { rw1: armor1, rw2: armor2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('界直谏', 'rw2', [1]);

    // 旧技能仁王盾移除,新技能白银狮子挂载
    expect(harness.state.players[1].equipment['防具']).toBe('rw2');
    expect(harness.state.players[1].skills).not.toContain('仁王盾');
    expect(harness.state.players[1].skills).toContain('白银狮子');
    expect(harness.state.zones.discardPile).toContain('rw1');
  });

  // ─── 3.【被动已删除】自己装装备不再摸牌(OL 版无此被动)────

  it('【被动已删除】自己出牌阶段用装备通用装装备 → 不再摸牌', async () => {
    const armor = makeEquip('rw', '仁王盾', '防具', '♣', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['rw'], skills: ['界直谏', '装备通用'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { rw: armor },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('装备通用', 'rw');

    // 装备到自己
    expect(harness.state.players[0].equipment['防具']).toBe('rw');
    // OL 版无"使用装备牌摸牌"被动:出装备后手牌为 0(无额外摸牌)
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── 4.【不误触发】他人装装备,自己的界直谏不摸牌 ──────────

  it('【不误触发】他人装装备时,自己的界直谏不摸牌', async () => {
    const armor = makeEquip('rw', '仁王盾', '防具', '♣', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['界直谏'] }),
        makePlayer({ index: 1, name: 'P2', hand: ['rw'], skills: ['装备通用'] }),
      ],
      cardMap: { rw: armor },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P2 = harness.player('P2');

    await P2.useCard('装备通用', 'rw');

    expect(harness.state.players[1].equipment['防具']).toBe('rw');
    expect(harness.state.players[0].hand.length).toBe(0); // P1 不摸牌
  });

  // ─── 负面用例 ─────────────────────────────────────────────

  it('负面:对自己使用 → 拒绝', async () => {
    const armor = makeEquip('rw', '仁王盾', '防具', '♣', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['rw'], skills: ['界直谏'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { rw: armor },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界直谏',
      actionType: 'use',
      params: { cardId: 'rw', targets: [0] },
    });
  });

  it('负面:非装备牌(基本牌)→ 拒绝', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['界直谏'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界直谏',
      actionType: 'use',
      params: { cardId: 'k1', targets: [1] },
    });
  });

  it('负面:非自己回合主动 use → 拒绝', async () => {
    const armor = makeEquip('rw', '仁王盾', '防具', '♣', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['rw'], skills: ['界直谏'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { rw: armor },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '界直谏',
      actionType: 'use',
      params: { cardId: 'rw', targets: [1] },
    });
  });
});
