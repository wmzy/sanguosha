// 直谏(张昭张纮·吴·主动技):出牌阶段,你可以将手牌中的一张装备牌
//   置于一名其他角色的装备区(不得替换原装备),然后摸一张牌。
//
// 实现(registerAction use):
//   1. validate:自己回合 + 出牌阶段 + 无阻塞 pending + 存活 + 手牌中有装备牌 +
//      目标为其他存活角色 + 目标对应装备栏位为空(不得替换)
//   2. execute:移动牌(自己手牌→目标手牌)→ 装备(目标)→ 添加技能(装备自带技能)→ 摸牌(1)
//
// 验证:
//   1. 正面:正常使用 → 装备到他人空装备区 + 摸1张
//   2. 负面:目标已有装备(同栏位)→ 拒绝
//   3. 负面:对自己使用 → 拒绝
//   4. 负面:非装备牌 → 拒绝
//   5. 负面:非自己回合 → 拒绝
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
    tags: [],
    judgeZone: [],
  };
}

describe('直谏', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:正常使用 → 装备到他人 + 摸1张 ──────────────────────

  it('正面:将装备牌置于他人空装备区 → 装备成功 + 摸1张', async () => {
    const armor = makeEquip('rw', '仁王盾', '防具', '♣', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['rw'], skills: ['直谏'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { rw: armor },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const handBefore = harness.state.players[0].hand.length;
    await P1.useCardAndTarget('直谏', 'rw', [1]);

    // P2 装备区有防具
    expect(harness.state.players[1].equipment['防具']).toBe('rw');
    // P2 技能包含仁王盾(装备自带技能)
    expect(harness.state.players[1].skills).toContain('仁王盾');
    // P1 摸了1张牌(装备牌已出,摸1张回来)
    expect(harness.state.players[0].hand.length).toBe(handBefore); // -1(出装备) +1(摸牌) = 0
    // 装备牌不在 P1 手牌中
    expect(harness.state.players[0].hand).not.toContain('rw');
  });

  it('正面:将武器牌置于他人空武器区 → 装备成功 + 摸1张', async () => {
    const weapon = makeEquip('w1', '诸葛连弩', '武器', '♦', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['w1'], skills: ['直谏'] }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { w1: weapon },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('直谏', 'w1', [1]);

    expect(harness.state.players[1].equipment['武器']).toBe('w1');
    expect(harness.state.players[1].skills).toContain('诸葛连弩');
  });

  // ─── 负面:目标已有同栏位装备 → 拒绝 ─────────────────────────

  it('负面:目标已有防具 → 拒绝(不得替换)', async () => {
    const armor1 = makeEquip('rw1', '仁王盾', '防具', '♣', '2');
    const armor2 = makeEquip('rw2', '白银狮子', '防具', '♣', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['rw2'], skills: ['直谏'] }),
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

    await P1.expectRejected({
      skillId: '直谏',
      actionType: 'use',
      params: { cardId: 'rw2', targets: [1] },
    });

    // P2 装备未变
    expect(harness.state.players[1].equipment['防具']).toBe('rw1');
  });

  // ─── 负面:对自己使用 → 拒绝 ─────────────────────────────────

  it('负面:对自己使用 → 拒绝', async () => {
    const armor = makeEquip('rw', '仁王盾', '防具', '♣', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['rw'], skills: ['直谏'] }),
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
      skillId: '直谏',
      actionType: 'use',
      params: { cardId: 'rw', targets: [0] },
    });
  });

  // ─── 负面:非装备牌 → 拒绝 ───────────────────────────────────

  it('负面:非装备牌(基本牌)→ 拒绝', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['k1'], skills: ['直谏'] }),
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
      skillId: '直谏',
      actionType: 'use',
      params: { cardId: 'k1', targets: [1] },
    });
  });

  // ─── 负面:非自己回合 → 拒绝 ─────────────────────────────────

  it('负面:非自己回合 → 拒绝', async () => {
    const armor = makeEquip('rw', '仁王盾', '防具', '♣', '2');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['rw'], skills: ['直谏'] }),
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
      skillId: '直谏',
      actionType: 'use',
      params: { cardId: 'rw', targets: [1] },
    });
  });
});
