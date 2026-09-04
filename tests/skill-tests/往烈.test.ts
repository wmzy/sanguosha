// tests/skill-tests/往烈.test.ts
// 往烈(陈到·蜀·被动技,OL hero/409)测试:
//   你出牌阶段使用的首张牌无距离限制。当你于出牌阶段使用基本牌或普通锦囊牌时,
//   你可以令此牌不能被响应,然后你本阶段不能再使用牌。
//
// 验证:
//   1. 首张牌无距离·杀:首张杀命中超距 P3(距离 2)
//   2. 首张牌无距离·顺手牵羊:首张顺手牵羊对超距 P3 生效
//   3. 第二张牌恢复正常距离:用桃后杀超距 P3 被拒
//   4. 发动往烈·杀不可被闪:杀直接命中,P2 无机会出闪
//   5. 不发动往烈·正常询问闪:P2 可出闪
//   6. 发动往烈·锦囊不可被无懈:无中生有不被无懈可击
//   7. 发动后禁出牌:任何牌使用被拒
//   8. 装备/延时锦囊不触发往烈选择(但仍计首张)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import { createGameState } from '../../src/engine/types';
import type { Card, Faction, PlayerState } from '../../src/engine/types';

// 注册往烈技能(subagent 不碰 index.ts,测试中直接赋值)
setSkillModuleOverride('往烈', () => import('../../src/engine/skills/往烈').then((m) => m.default));

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
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
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  faction?: Faction;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '陈到',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['往烈'],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
    faction: opts.faction ?? '蜀',
    identity: '忠臣',
  };
}

const DECK_IDS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
function seedDeckCards(state: ReturnType<typeof createGameState>): void {
  for (const id of DECK_IDS) {
    state.cardMap[id] = makeCard(id, '杀', '♠');
  }
}

describe('往烈', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 首张牌无距离·杀 ────────────────────────────────

  it('首张牌无距离: 杀命中超距 P3(4人环 P1→P3 距离2 > 徒手范围1)', async () => {
    const cardMap: Record<string, Card> = {
      s1: makeCard('s1', '杀', '♠', '7'),
    };
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', character: '陈到', hand: ['s1'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: ['闪'] }),
        makePlayer({ index: 2, name: 'P3', character: '刘备', health: 4, skills: ['闪'] }),
        makePlayer({ index: 3, name: 'P4', character: '孙权', health: 4, skills: ['闪'] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    // 首张杀指定超距 P3 → 往烈豁免 → 接受
    await P1.useCardAndTarget('杀', 's1', [2]);
    // 使用时 → 往烈选择(杀是基本牌) → 不发动
    await P1.respond('往烈', { choice: false });
    // P3 正常被询问闪 → 不出
    await P3.pass();
    // P3 受伤 4→3
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 首张牌无距离·顺手牵羊 ──────────────────────────

  it('首张牌无距离: 顺手牵羊对超距 P3 生效', async () => {
    const cardMap: Record<string, Card> = {
      sn: makeCard('sn', '顺手牵羊', '♠', 'J', '锦囊牌'),
      target: makeCard('target', '杀', '♥', '3'),
    };
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', character: '陈到', hand: ['sn'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: ['无懈可击'] }),
        makePlayer({
          index: 2,
          name: 'P3',
          character: '刘备',
          health: 4,
          hand: ['target'],
          skills: [],
        }),
        makePlayer({ index: 3, name: 'P4', character: '孙权', health: 4, skills: ['无懈可击'] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 首张顺手牵羊指定超距 P3 → 往烈豁免 → 接受
    await P1.useCardAndTarget('顺手牵羊', 'sn', [2]);
    // 使用时 → 往烈选择(顺手牵羊是普通锦囊) → 不发动
    await P1.respond('往烈', { choice: false });
    // 无懈可击广播 → 无人出
    await P2.pass();
    await harness.player('P3').pass();
    await harness.player('P4').pass();
    // P1 选牌:P3 的 target 牌
    await P1.respond('顺手牵羊', { cardId: 'target' });
    await harness.waitForStable();

    // target 牌从 P3 手牌转移到 P1 手牌
    expect(harness.state.players[0].hand).toContain('target');
    expect(harness.state.players[2].hand).not.toContain('target');
  });

  // ─── 第二张牌恢复正常距离 ──────────────────────────

  it('第二张牌恢复正常距离: 用桃(首张)后杀超距 P3 被拒', async () => {
    const cardMap: Record<string, Card> = {
      p1: makeCard('p1', '桃', '♥', '5'),
      s1: makeCard('s1', '杀', '♠', '7'),
    };
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '陈到',
          health: 3,
          hand: ['p1', 's1'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: ['闪'] }),
        makePlayer({ index: 2, name: 'P3', character: '刘备', health: 4, skills: ['闪'] }),
        makePlayer({ index: 3, name: 'P4', character: '孙权', health: 4, skills: ['闪'] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 首张:用桃(自回复,target=wounded 需显式自指)→ 往烈选择(桃是基本牌)→ 不发动
    await P1.useCardAndTarget('桃', 'p1', [0]);
    await P1.respond('往烈', { choice: false });
    expect(harness.state.players[0].health).toBe(4);
    expect(harness.state.turn.vars['往烈/首张已用']).toBe(true);

    // 第二张:杀超距 P3(距离2 > 范围1)→ 被拒
    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 's1', targets: [2] },
    });
  });

  // ─── 发动往烈·杀不可被闪 ────────────────────────────

  it('发动往烈: 杀不可被闪(P2 无机会出闪,直接受伤)', async () => {
    const cardMap: Record<string, Card> = {
      s1: makeCard('s1', '杀', '♠', '7'),
      dodge: makeCard('dodge', '闪', '♥', '2'),
    };
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', character: '陈到', hand: ['s1'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          health: 4,
          hand: ['dodge'],
          skills: ['闪'],
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 杀 P2 → 往烈选择 → 发动
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P1.respond('往烈', { choice: true });

    // 不可被闪:无 pending(询问闪被 cancel)
    expect(harness.state.pendingSlots.size).toBe(0);
    // P2 受伤 4→3
    expect(harness.state.players[1].health).toBe(3);
    // P2 的闪仍在手(没机会出)
    expect(harness.state.players[1].hand).toContain('dodge');
    // 往烈禁出牌已设置
    expect(harness.state.turn.vars['往烈/禁出牌']).toBe(0);
  });

  // ─── 不发动往烈·正常询问闪 ──────────────────────────

  it('不发动往烈: 杀正常询问闪(P2 可出闪抵消)', async () => {
    const cardMap: Record<string, Card> = {
      s1: makeCard('s1', '杀', '♠', '7'),
      dodge: makeCard('dodge', '闪', '♥', '2'),
    };
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', character: '陈到', hand: ['s1'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          health: 4,
          hand: ['dodge'],
          skills: ['闪'],
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // 杀 P2 → 往烈选择 → 不发动
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P1.respond('往烈', { choice: false });
    // 正常询问闪 → P2 出闪抵消
    await P2.respond('闪', { cardId: 'dodge' });
    // P2 不受伤
    expect(harness.state.players[1].health).toBe(4);
    // 往烈禁出牌未设置
    expect(harness.state.turn.vars['往烈/禁出牌']).toBeUndefined();
  });

  // ─── 发动往烈·锦囊不可被无懈 ────────────────────────

  it('发动往烈: 无中生有不可被无懈(直接摸2张)', async () => {
    const cardMap: Record<string, Card> = {
      ex: makeCard('ex', '无中生有', '♥', '7', '锦囊牌'),
      wuxie: makeCard('wuxie', '无懈可击', '♠', 'J', '锦囊牌'),
    };
    (cardMap.wuxie as Card & { trickSubtype?: string }).trickSubtype = '响应锦囊';
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', character: '陈到', hand: ['ex'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          character: '曹操',
          health: 4,
          hand: ['wuxie'],
          skills: ['无懈可击'],
        }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 无中生有(自目标)→ 往烈选择 → 发动
    await P1.useCard('无中生有', 'ex');
    await P1.respond('往烈', { choice: true });

    // 不可被无懈:无 pending(无懈可击广播被 cancel)→ 直接摸2张
    expect(harness.state.pendingSlots.size).toBe(0);
    // 从牌堆顶摸 2 张(deck 末尾 d6/d5)
    expect(harness.state.players[0].hand).toHaveLength(2);
    expect(harness.state.players[0].hand).toContain('d6');
    expect(harness.state.players[0].hand).toContain('d5');
    // P2 的无懈仍在手(没机会出)
    expect(harness.state.players[1].hand).toContain('wuxie');
    // 往烈禁出牌已设置
    expect(harness.state.turn.vars['往烈/禁出牌']).toBe(0);
  });

  // ─── 发动后禁出牌 ────────────────────────────────────

  it('发动后禁出牌: 往烈发动后任何牌使用被拒', async () => {
    const cardMap: Record<string, Card> = {
      s1: makeCard('s1', '杀', '♠', '7'),
      s2: makeCard('s2', '杀', '♠', '8'),
    };
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', character: '陈到', hand: ['s1', 's2'] }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: ['闪'] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 杀 P2 → 往烈选择 → 发动
    await P1.useCardAndTarget('杀', 's1', [1]);
    await P1.respond('往烈', { choice: true });
    expect(harness.state.players[1].health).toBe(3);

    // 再出杀 → 被拒(本阶段不能再使用牌)
    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 's2', targets: [1] },
    });
  });

  // ─── 往烈选择仅对基本牌/普通锦囊牌触发 ──────────────

  it('基本牌可发动往烈: 桃也触发选择(可发动后禁出牌)', async () => {
    const cardMap: Record<string, Card> = {
      p1: makeCard('p1', '桃', '♥', '5'),
      s1: makeCard('s1', '杀', '♠', '7'),
    };
    const state = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          character: '陈到',
          health: 3,
          hand: ['p1', 's1'],
        }),
        makePlayer({ index: 1, name: 'P2', character: '曹操', health: 4, skills: ['闪'] }),
      ],
      zones: { deck: [...DECK_IDS], discardPile: [], processing: [] },
      cardMap,
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    seedDeckCards(state);
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 桃(基本牌)→ 往烈选择 → 发动
    await P1.useCardAndTarget('桃', 'p1', [0]);
    await P1.respond('往烈', { choice: true });
    expect(harness.state.players[0].health).toBe(4);

    // 发动后禁出牌:杀被拒
    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 's1', targets: [1] },
    });
  });
});
