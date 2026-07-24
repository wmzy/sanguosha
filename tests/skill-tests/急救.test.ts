// tests/skill-tests/急救.test.ts
// 急救(华佗·群雄)技能测试:
//   回合外,你可以将一张红色手牌当【桃】使用。
//
// 回合外【桃】的唯一用途是濒死求桃救援,故急救只暴露 respond action:
//   当存在针对自己的 桃/求桃 pending 时,弃一张红色手牌,触发救援(求桃/已救)。
//
// 验证:
//   1. 正面:回合外濒死求桃 → 红色手牌当桃自救,血量回升,牌进弃牌堆
//   2. 正面:回合外红色手牌当桃救他人(3 人)
//   3. 负面:黑色牌当桃 → 拒绝
//   4. 负面:无求桃 pending → 拒绝
//   5. 负面:不在手牌的红色牌 → 拒绝
//   6. 负面:装备区红色牌 → 拒绝(当前范围仅支持红色手牌)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
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
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '华佗',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? 3,
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

describe('急救', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:回合外自救 ───────────────────────

  it('respond:回合外濒死求桃 → 红色手牌当桃自救,血量回升,牌进弃牌堆', async () => {
    const slash = makeCard('c1', '杀', '♠', 'A');
    const redCard = makeCard('r1', '过河拆桥', '♥', 'A', '锦囊牌'); // 红色
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: '华佗',
          hand: ['r1'],
          skills: ['急救', '桃', '闪'],
          health: 1,
          maxHealth: 3,
        }),
      ],
      cardMap: { c1: slash, r1: redCard },
      currentPlayerIndex: 0, // P0 回合 → 华佗处于"回合外"
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const HuaTuo = harness.player('华佗');

    // P0 出杀 → 华佗不闪 → HP=0 → 濒死 → 求桃
    // 模块 C:逆时针从当前回合 P0 起:P0 → 华佗(濒死者)
    await P0.useCardAndTarget('杀', 'c1', [1]);
    await HuaTuo.pass();
    expect(harness.state.players[1].health).toBe(0);
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    // 第一问 P0(target=0)→ 无桃 pass
    let slotAtom = [...harness.state.pendingSlots.values()][0].atom as {
      type?: string;
      requestType?: string;
      target?: number;
    };
    expect(slotAtom.requestType).toBe('桃/求桃');
    expect(slotAtom.target).toBe(0);
    await P0.pass();

    // 第二问 华佗(target=1)→ 急救自救
    slotAtom = [...harness.state.pendingSlots.values()][0].atom as {
      type?: string;
      requestType?: string;
      target?: number;
    };
    expect(slotAtom.target).toBe(1);

    // 华佗用急救:红色手牌当桃自救
    await HuaTuo.respond('急救', { cardId: 'r1' });

    // 血量回升到 1,红色牌进弃牌堆,华佗手牌清空
    expect(harness.state.players[1].health).toBe(1);
    expect(harness.state.zones.discardPile).toContain('r1');
    expect(harness.state.players[1].hand).not.toContain('r1');
  });

  // ─── 正面:回合外救他人(3 人) ───────────────

  it('respond:回合外红色手牌当桃救他人', async () => {
    const slash = makeCard('c1', '杀', '♠', 'A');
    const redCard = makeCard('r1', '决斗', '♦', '4', '锦囊牌'); // 红色(方块)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: '华佗',
          hand: ['r1'],
          skills: ['急救', '桃'],
          health: 3,
          maxHealth: 3,
        }),
        makePlayer({
          index: 2,
          name: 'P2',
          skills: ['闪'],
          health: 1,
          maxHealth: 4,
        }),
      ],
      cardMap: { c1: slash, r1: redCard },
      currentPlayerIndex: 0, // P0 回合 → 华佗处于"回合外"
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');
    const HuaTuo = harness.player('华佗');

    // P0 出杀 → P2 不闪 → HP=0 → 濒死 → 求桃依次问 P2、P0、华佗
    await P0.useCardAndTarget('杀', 'c1', [2]);
    await P2.pass();
    expect(harness.state.players[2].health).toBe(0);

    // 求桃先问濒死者 P2(无桃跳过),再问 P0(跳过),最后问华佗
    await P2.pass();
    await P0.pass();

    // 此时轮到华佗被问
    const slot = [...harness.state.pendingSlots.values()][0].atom as {
      target?: number;
      requestType?: string;
    };
    expect(slot.target).toBe(1);

    // 华佗用急救救 P2
    await HuaTuo.respond('急救', { cardId: 'r1' });
    expect(harness.state.players[2].health).toBe(1);
    expect(harness.state.zones.discardPile).toContain('r1');
  });

  // ─── 负面 ─────────────────────────────────

  it('respond:黑色牌当桃 → 拒绝', async () => {
    const slash = makeCard('c1', '杀', '♠', 'A');
    const blackCard = makeCard('b1', '过河拆桥', '♠', 'A', '锦囊牌'); // 黑色
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: '华佗',
          hand: ['b1'],
          skills: ['急救', '桃', '闪'],
          health: 1,
          maxHealth: 3,
        }),
      ],
      cardMap: { c1: slash, b1: blackCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const HuaTuo = harness.player('华佗');

    await P0.useCardAndTarget('杀', 'c1', [1]);
    await HuaTuo.pass();
    expect(harness.state.players[1].health).toBe(0);

    // 黑色牌不能当桃
    await HuaTuo.expectRejected({ skillId: '急救', actionType: 'respond', params: { cardId: 'b1' } });
  });

  it('respond:无求桃 pending → 拒绝', async () => {
    const redCard = makeCard('r1', '过河拆桥', '♥', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: '华佗',
          hand: ['r1'],
          skills: ['急救', '桃'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap: { r1: redCard },
      currentPlayerIndex: 0, // P0 回合,华佗回合外
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const HuaTuo = harness.player('华佗');

    // 当前无任何 pending → 急救不可用
    await HuaTuo.expectRejected({ skillId: '急救', actionType: 'respond', params: { cardId: 'r1' } });
  });

  it('respond:不在手牌的红色牌 → 拒绝', async () => {
    const slash = makeCard('c1', '杀', '♠', 'A');
    const redCardElsewhere = makeCard('rX', '过河拆桥', '♥', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: '华佗',
          hand: [],
          skills: ['急救', '桃', '闪'],
          health: 1,
          maxHealth: 3,
        }),
      ],
      cardMap: { c1: slash, rX: redCardElsewhere },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const HuaTuo = harness.player('华佗');

    await P0.useCardAndTarget('杀', 'c1', [1]);
    await HuaTuo.pass();
    expect(harness.state.players[1].health).toBe(0);

    // rX 不在华佗手牌中
    await HuaTuo.expectRejected({
      skillId: '急救',
      actionType: 'respond',
      params: { cardId: 'rX' },
    });
  });

  // ─── 负面:装备区红色牌(当前范围仅支持手牌) ────

  it('respond:装备区红色牌当桃 → 拒绝(当前范围仅支持红色手牌)', async () => {
    const slash = makeCard('c1', '杀', '♠', 'A');
    const redEquip = makeCard('re', '赤兔', '♥', 'Q', '装备牌'); // 红色装备
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['c1'],
          skills: ['杀'],
          health: 4,
          maxHealth: 4,
        }),
        makePlayer({
          index: 1,
          name: '华佗',
          hand: [],
          skills: ['急救', '桃', '闪'],
          health: 1,
          maxHealth: 3,
        }),
      ],
      cardMap: { c1: slash, re: redEquip },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    // 手动将红色牌放入华佗装备区(模拟已装备)
    (state.players[1].equipment as Record<string, string>)['-1马'] = 're';
    await harness.setup(state);
    const P0 = harness.player('P0');
    const HuaTuo = harness.player('华佗');

    await P0.useCardAndTarget('杀', 'c1', [1]);
    await HuaTuo.pass();
    expect(harness.state.players[1].health).toBe(0);

    // 装备区红色牌不被接受(当前范围仅支持红色手牌)
    await HuaTuo.expectRejected({
      skillId: '急救',
      actionType: 'respond',
      params: { cardId: 're' },
    });
  });
});
