// 界刚烈(界夏侯惇·被动技)测试
//   受到伤害后判定,非红桃则来源弃两张手牌或受 1 点伤害;然后界夏侯惇可将来源翻面。
//
// 验证:
//   1. 非红桃 + 来源选择受伤 → 来源扣 1 血 + 界夏侯惇选择翻面 → 来源获得翻面标签
//   2. 非红桃 + 来源选择弃牌 → 来源弃两张 + 界夏侯惇选择不翻面 → 无翻面标签
//   3. 红桃 → 判定无事,但仍可翻面
//   4. 来源手牌不足两张 → 强制受伤 + 翻面可选
//   5. 来源已翻面 → 不询问翻面
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
// 临时注册界刚烈(主 agent 会统一注册到 index.ts)
import { skillLoaders } from '../../src/engine/skills';
import * as 界刚烈Module from '../../src/engine/skills/界刚烈';
import type { SkillModule } from '../../src/engine/skill';
skillLoaders['界刚烈'] = async () => 界刚烈Module as unknown as SkillModule;

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
  tags?: string[];
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '界夏侯惇',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: opts.tags ?? [],
    judgeZone: [],
  };
}

describe('界刚烈', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 非红桃 + 选择受伤 + 选择翻面 ────────────────────
  it('非红桃:来源受伤后,界夏侯惇将其翻面', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5'); // 非红桃
    const extra1 = makeCard('e1', '闪', '♦', '3');
    const extra2 = makeCard('e2', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1', 'e1', 'e2'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge, e1: extra1, e2: extra2 },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // P1 不出闪
    // 刚烈判定(非红桃)后,询问来源 P0 二选一
    P0.expectPending('请求回应');
    await P0.respond('界刚烈', { choice: false }); // 选择受到伤害
    // 界版:询问界夏侯惇是否翻面
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: true }); // 选择翻面

    expect(harness.state.players[1].health).toBe(3); // P1 受杀 1 伤
    expect(harness.state.players[0].health).toBe(3); // P0 受刚烈 1 伤
    expect(harness.state.players[0].tags).toContain('刚烈/翻面');
  });

  // ─── 非红桃 + 选择弃牌 + 不翻面 ────────────────────
  it('非红桃:来源弃牌后,界夏侯惇选择不翻面', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♣', '5'); // 非红桃
    const extra1 = makeCard('e1', '闪', '♦', '3');
    const extra2 = makeCard('e2', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1', 'e1', 'e2'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge, e1: extra1, e2: extra2 },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    P0.expectPending('请求回应');
    await P0.respond('界刚烈', { choice: true }); // 选择弃两张手牌
    // 界版:询问是否翻面
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: false }); // 不翻面

    expect(harness.state.players[0].health).toBe(4); // P0 未受伤
    expect(harness.state.players[0].hand).toEqual([]); // 弃了两张
    expect(harness.state.players[0].tags).not.toContain('刚烈/翻面');
  });

  // ─── 红桃:判定无事但仍可翻面 ────────────────────
  it('红桃:刚烈判定无效果,但仍可将来源翻面', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♥', '5'); // 红桃
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    // 红桃:无二选一(无 P0 pending),但界版仍询问翻面
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: true }); // 翻面

    expect(harness.state.players[1].health).toBe(3); // P1 受杀 1 伤
    expect(harness.state.players[0].health).toBe(4); // P0 无刚烈伤害
    expect(harness.state.players[0].tags).toContain('刚烈/翻面');
  });

  // ─── 来源手牌不足两张:强制受伤 + 可翻面 ────────────────────
  it('来源手牌不足两张:强制受伤,然后可翻面', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5'); // 非红桃
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    // 手牌不足 → 强制受伤(无 P0 pending)→ 界版询问翻面
    P1.expectPending('请求回应');
    await P1.respond('界刚烈', { choice: true });

    expect(harness.state.players[0].health).toBe(3); // 强制受伤
    expect(harness.state.players[0].tags).toContain('刚烈/翻面');
  });

  // ─── 来源已翻面:不询问翻面 ────────────────────
  it('来源已翻面:不询问翻面', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const judge = makeCard('j1', '杀', '♠', '5'); // 非红桃
    const extra1 = makeCard('e1', '闪', '♦', '3');
    const extra2 = makeCard('e2', '桃', '♦', '4');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: ['k1', 'e1', 'e2'],
          skills: ['杀'],
          tags: ['放逐/翻面'], // 已翻面
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['界刚烈', '闪'] }),
      ],
      cardMap: { k1: slash, j1: judge, e1: extra1, e2: extra2 },
      zones: { deck: ['j1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();
    P0.expectPending('请求回应');
    await P0.respond('界刚烈', { choice: false }); // 受伤

    // 来源已翻面 → 不询问翻面(无 pending)
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].tags).toContain('放逐/翻面');
    expect(harness.state.players[0].tags).not.toContain('刚烈/翻面');
  });
});
