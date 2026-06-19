// tests/skill-tests/八卦阵.test.ts
// 八卦阵(防具)技能测试:
//   onInit:询问闪 before hook → 判定牌堆顶;红色视为出闪(放虚拟闪进处理区);
//          黑色 → 不放虚拟闪,正常询问闪
//   实现细节:在 询问闪 atom.beforeHook 中 applyAtom(判定) → 判定牌进弃牌堆,
//            读弃牌堆顶判定牌花色。红色 → 创建虚拟闪(进 processing),
//            杀检查处理区发现闪就视为闪避。
//
// 验证:
//   1. 正面:装备八卦阵 → equipment.防具 = id,玩家 skills 含 '八卦阵'
//   2. 正面:判定成功(红色)→ P2 出杀 P1 不出闪 → P1 不扣血(虚拟闪抵消)
//   3. 正面:判定失败(黑色)→ P2 出杀 P1 不出闪 → P1 扣 1 血
//   4. 正面:P1 有真闪 + 八卦阵判定红色 → 真闪 + 虚拟闪都进弃牌堆,无伤害
//   5. 负面:非自己回合装八卦阵 → 拒绝
//   6. 负面:装备不存在的牌 → 拒绝
//   7. 负面:八卦阵判定黑色 + P1 出真闪 → 正常闪避
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function makeEquip(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', subtype: '武器' | '防具' | '进攻马' | '防御马' | '宝物', rank = 'A', range?: number): Card {
  return { id, name, suit, rank, type: '装备牌', subtype, range };
}

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A', type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌'): Card {
  return { id, name, suit, rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  equipment?: Record<string, string>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['装备通用'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
  };
}

describe('八卦阵', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 正面:装备八卦阵 ─────────────────────────

  it('use:装八卦阵 → equipment.防具 = id,玩家 skills 增加八卦阵', async () => {
    const bagua = makeEquip('b1', '八卦阵', '♣', '防具', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['b1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { b1: bagua },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.useCard('装备通用', 'b1');

    expect(harness.state.players[0].equipment['防具']).toBe('b1');
    expect(harness.state.players[0].skills).toContain('八卦阵');
    expect(harness.state.players[0].hand).not.toContain('b1');
  });

  // ─── 正面:八卦阵判定成功(红色)= 视为出闪 → 不扣血 ────────────

  it('判定成功(红色 ♥):P2 杀 P1 → P1 不出闪仍不扣血(虚拟闪抵消)', async () => {
    // P1 装好八卦阵(预加载 skill 实例)
    // P2 对 P1 出杀,P1 判定牌为红色(♥) → 视为出闪 → 不扣血
    const bagua = makeEquip('b1', '八卦阵', '♣', '防具', 'A');
    const slash = makeCard('s1', '杀', '♠', 'A');
    // deck 顶放红色牌(让八卦阵判定翻到红桃)
    const judgeCard = makeCard('j1', '桃', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['装备通用', '闪', '八卦阵'], equipment: { '防具': 'b1' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['s1'], skills: ['杀'] }),
      ],
      cardMap: { b1: bagua, s1: slash, j1: judgeCard },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 八卦阵预装在 P1 上
    expect(harness.state.players[0].skills).toContain('八卦阵');
    expect(harness.state.players[0].equipment['防具']).toBe('b1');

    // P2 出杀对 P1
    await P2.useCardAndTarget('杀', 's1', [0]);

    // P1 不出真闪(没闪牌)→ 八卦阵判定翻开 ♥ j1 → 视为出闪(虚拟闪进处理区)
    // 杀检查处理区发现闪 → 不造成伤害
    expect(harness.state.players[0].health).toBe(4);
    // 判定牌已进弃牌堆
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  it('判定成功(红色 ♦):同样视为出闪', async () => {
    const bagua = makeEquip('b1', '八卦阵', '♣', '防具', 'A');
    const slash = makeCard('s1', '杀', '♠', 'A');
    const judgeCard = makeCard('j1', '杀', '♦', '7'); // 方块红色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['装备通用', '闪', '八卦阵'], equipment: { '防具': 'b1' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['s1'], skills: ['杀'] }),
      ],
      cardMap: { b1: bagua, s1: slash, j1: judgeCard },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCardAndTarget('杀', 's1', [0]);

    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  // ─── 正面:判定失败(黑色)= 不视为闪 → 正常询问闪 → 扣血 ────────────

  it('判定失败(黑色 ♠):P2 杀 P1 → P1 不出闪 → 扣 1 血', async () => {
    const bagua = makeEquip('b1', '八卦阵', '♣', '防具', 'A');
    const slash = makeCard('s1', '杀', '♠', 'A');
    const judgeCard = makeCard('j1', '杀', '♠', '5'); // 黑桃黑色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['装备通用', '闪', '八卦阵'], equipment: { '防具': 'b1' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['s1'], skills: ['杀'] }),
      ],
      cardMap: { b1: bagua, s1: slash, j1: judgeCard },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCardAndTarget('杀', 's1', [0]);
    // 八卦阵判定翻开 ♠ → 不视为闪 → 进入询问闪 pending
    // P1 没有闪牌 → pass() 触发 fireTimeout → 无闪 → 扣血
    await P1.pass();

    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  it('判定失败(黑色 ♣):同样不视为闪', async () => {
    const bagua = makeEquip('b1', '八卦阵', '♣', '防具', 'A');
    const slash = makeCard('s1', '杀', '♠', 'A');
    const judgeCard = makeCard('j1', '桃', '♣', '5'); // 梅花黑色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['装备通用', '闪', '八卦阵'], equipment: { '防具': 'b1' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['s1'], skills: ['杀'] }),
      ],
      cardMap: { b1: bagua, s1: slash, j1: judgeCard },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P2.useCardAndTarget('杀', 's1', [0]);
    await P1.pass();

    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  // ─── 正面:P1 有真闪 → 出真闪 → 正常闪避,八卦阵判定仍生效 ────────────

  it('判定成功 + P1 出真闪:P1 仍正常闪避(虚拟闪不入正库)', async () => {
    const bagua = makeEquip('b1', '八卦阵', '♣', '防具', 'A');
    const slash = makeCard('s1', '杀', '♠', 'A');
    const dodge = makeCard('d1', '闪', '♥', '2');
    const judgeCard = makeCard('j1', '桃', '♥', '5'); // 红色
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['d1'], skills: ['装备通用', '闪', '八卦阵'], equipment: { '防具': 'b1' } }),
        makePlayer({ index: 1, name: 'P2', hand: ['s1'], skills: ['杀'] }),
      ],
      cardMap: { b1: bagua, s1: slash, d1: dodge, j1: judgeCard },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 先验证 respondableCards:在询问闪 pending 中,P1 应该可以出闪(d1)
    await P2.useCardAndTarget('杀', 's1', [0]);
    // 现在 pending 是 询问闪(P1 出闪),respondableCards 应该返回 [d1]
    const info = P1.respondInfo();
    expect(info?.skillId).toBe('闪');
    const cards = P1.respondableCards();
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe('d1');

    // P1 出真闪 → 闪避成功,不扣血
    await P1.respond('闪', { cardId: 'd1' });
    expect(harness.state.players[0].health).toBe(4);
    // 闪牌进弃牌堆(注意:八卦阵也放了虚拟闪,但被杀结算时 drain 闪牌区会一起移走)
    expect(harness.state.zones.discardPile).toEqual(expect.arrayContaining(['d1']));
    // 判定牌 j1 进弃牌堆
    expect(harness.state.zones.discardPile).toContain('j1');
  });

  // ─── 负面:非自己回合装八卦阵 → 拒绝 ────────────

  it('负面:非自己回合装八卦阵 → 拒绝', async () => {
    const bagua = makeEquip('b1', '八卦阵', '♣', '防具', 'A');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['b1'] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { b1: bagua },
      currentPlayerIndex: 1, // P2 的回合
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '装备通用', actionType: 'use', params: { cardId: 'b1' },
    });
  });

  // ─── 负面:装备不存在的牌 → 拒绝 ────────────

  it('负面:装备不存在的牌 → 拒绝', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [] }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '装备通用', actionType: 'use', params: { cardId: 'nonexistent' },
    });
  });
});