// tests/skill-tests/界荐言.test.ts
// 界荐言(界徐庶·主动技)测试:
//   出牌阶段限一次，你可以声明一种牌的类别或颜色，然后连续亮出牌堆顶的牌，
//   直到亮出符合你声明的牌为止，选择一名男性角色，该角色获得此牌，
//   再将其余以此法亮出的牌置入弃牌堆。
//
// 验证:
//   1. 类别声明(基本牌):翻到第一张基本牌给目标,其余入弃牌堆
//   2. 颜色声明(红):翻到第一张红色牌给目标
//   3. 第一张就匹配:翻一张就停
//   4. 限一次:第二次发动被拒
//   5. 不在出牌阶段/不是自己回合 → 拒绝
//   6. 目标必须是男性(若全为女性无候选,拒绝)
//   7. 牌堆耗尽无匹配 → 所有翻开入弃牌堆,无目标收牌
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
// 临时注册界荐言(主 agent 会统一注册到 index.ts)
import { skillLoaders } from '../../src/engine/skills';
import * as 界荐言Module from '../../src/engine/skills/界荐言';
import type { SkillModule } from '../../src/engine/skill';
skillLoaders['界荐言'] = async () => 界荐言Module as unknown as SkillModule;

import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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
  character?: string;
  alive?: boolean;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界徐庶',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: opts.alive ?? true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['界荐言'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

describe('界荐言', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 类别声明(基本牌) ─────────────────────────────
  it('类别声明(基本牌):翻到第一张基本牌给目标,其余入弃牌堆', async () => {
    // 牌堆:deck=[锦囊, 装备, 杀(基本牌)](顶在末尾,先摸杀)
    // 翻开顺序:杀(基本牌,匹配) → 停
    // 翻开张数:1(只翻一张匹配的就停)
    const equip = makeCard('equip1', '诸葛连弩', '♣', 'A', '装备牌');
    const trick = makeCard('trick1', '过河拆桥', '♠', 'A', '锦囊牌');
    const kill = makeCard('kill1', '杀', '♦', 'A', '基本牌');
    // 让顶部三张依次为:装备、锦囊、杀(翻牌顺序:杀→锦囊→装备? 不,从顶往下翻)
    // deck 末尾 = 牌堆顶 = 最先翻 = 杀(基本牌)→ 停
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界荐言'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '曹操', // 男性
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { equip1: equip, trick1: trick, kill1: kill },
      zones: { deck: ['equip1', 'trick1', 'kill1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.useCard('界荐言', '_unused'); // use 无 cardId(声明 + 目标在后续询问)
    await harness.waitForStable();
    harness.processAllEvents();

    // 询问声明
    P0.expectPending('请求回应');
    await P0.respond('界荐言', { declaration: '基本牌' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 询问目标
    P0.expectPending('请求回应');
    await P0.respond('界荐言', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 收到杀(匹配的基本牌),其他牌未翻开
    expect(harness.state.players[1].hand).toContain('kill1');
    // 装备和锦囊仍在牌堆(未翻开)
    expect(harness.state.zones.deck).toContain('equip1');
    expect(harness.state.zones.deck).toContain('trick1');
    // 处理区清空
    expect(harness.state.zones.processing.length).toBe(0);
    // 限一次标记
    expect(harness.state.players[0].vars['界荐言/usedThisTurn']).toBe(true);
  });

  // ─── 2. 颜色声明(红) ─────────────────────────────────
  it('颜色声明(红):翻多张直到红色牌', async () => {
    // 牌堆从底到顶:[黑杀, 黑闪, 红桃] → 翻牌顺序:红桃(顶,红)→停? 不对
    // deck 末尾 = 顶 = 最先翻 = 红桃(红) → 停
    // 但为了让"翻多张",需让顶部第一张是非红色
    // deck=[红桃(底), 黑杀, 黑闪(顶)] → 先翻 黑闪(黑),再翻 黑杀(黑),再翻 红桃(红)→停
    const heart = makeCard('heart1', '桃', '♥', 'A', '基本牌'); // 红
    const blackSlash = makeCard('bs1', '杀', '♠', 'A', '基本牌'); // 黑
    const blackDodge = makeCard('bd1', '闪', '♣', 'A', '基本牌'); // 黑
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界荐言'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { heart1: heart, bs1: blackSlash, bd1: blackDodge },
      // deck[0]=底=heart1(最后翻),deck[1]=bs1,deck[2]=顶=bd1(最先翻)
      zones: { deck: ['heart1', 'bs1', 'bd1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.useCard('界荐言', '_unused');
    await harness.waitForStable();
    harness.processAllEvents();
    await P0.respond('界荐言', { declaration: '红' });
    await harness.waitForStable();
    harness.processAllEvents();
    await P0.respond('界荐言', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 收到 heart1(第一张红色)
    expect(harness.state.players[1].hand).toContain('heart1');
    // 黑闪、黑杀 已翻开 → 入弃牌堆
    expect(harness.state.zones.discardPile).toContain('bs1');
    expect(harness.state.zones.discardPile).toContain('bd1');
    // 红桃已给目标,不在弃牌堆
    expect(harness.state.zones.discardPile).not.toContain('heart1');
    // 牌堆耗尽(三张都被翻完)
    expect(harness.state.zones.deck.length).toBe(0);
  });

  // ─── 3. 第一次就匹配 ─────────────────────────────────
  it('第一张就匹配:只翻一张就停', async () => {
    const kill = makeCard('kill1', '杀', '♠', 'A', '基本牌'); // 黑色基本牌
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界荐言'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { kill1: kill },
      zones: { deck: ['kill1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.useCard('界荐言', '_unused');
    await harness.waitForStable();
    harness.processAllEvents();
    await P0.respond('界荐言', { declaration: '黑' });
    await harness.waitForStable();
    harness.processAllEvents();
    await P0.respond('界荐言', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // P1 收到杀(黑色匹配)
    expect(harness.state.players[1].hand).toContain('kill1');
    // 无弃牌(只翻一张,且匹配)
    expect(harness.state.zones.discardPile.length).toBe(0);
  });

  // ─── 4. 限一次 ──────────────────────────────────────
  it('限一次:第二次发动被拒', async () => {
    const kill = makeCard('kill1', '杀', '♠', 'A', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界荐言'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { kill1: kill },
      zones: { deck: ['kill1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 第一次:成功
    await P0.useCard('界荐言', '_unused');
    await harness.waitForStable();
    harness.processAllEvents();
    await P0.respond('界荐言', { declaration: '黑' });
    await harness.waitForStable();
    harness.processAllEvents();
    await P0.respond('界荐言', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // 第二次:被拒(state.seq 不增加)
    const seqBefore = harness.state.seq;
    await P0.expectRejected({
      skillId: '界荐言',
      actionType: 'use',
      params: {},
    });
    expect(harness.state.seq).toBe(seqBefore);
  });

  // ─── 5. 不在出牌阶段/不是自己回合 → 拒绝 ───────────────
  it('不在出牌阶段 → 拒绝', async () => {
    const kill = makeCard('kill1', '杀', '♠', 'A', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界荐言'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { kill1: kill },
      zones: { deck: ['kill1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '摸牌', // 不是出牌阶段
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    const seqBefore = harness.state.seq;
    await P0.expectRejected({
      skillId: '界荐言',
      actionType: 'use',
      params: {},
    });
    expect(harness.state.seq).toBe(seqBefore);
  });

  // ─── 6. 目标必须是男性 ───────────────────────────────
  it('无男性候选 → 拒绝(use 阶段即拒)', async () => {
    const kill = makeCard('kill1', '杀', '♠', 'A', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界荐言'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '貂蝉', // 女性
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { kill1: kill },
      zones: { deck: ['kill1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    const seqBefore = harness.state.seq;
    await P0.expectRejected({
      skillId: '界荐言',
      actionType: 'use',
      params: {},
    });
    expect(harness.state.seq).toBe(seqBefore);
  });

  // ─── 7. 牌堆耗尽无匹配 ───────────────────────────────
  it('牌堆耗尽无匹配 → 所有翻开入弃牌堆', async () => {
    // 声明装备牌,但牌堆只有基本牌和锦囊 → 全部翻开入弃牌堆
    const kill = makeCard('kill1', '杀', '♠', 'A', '基本牌');
    const trick = makeCard('trick1', '过河拆桥', '♠', 'A', '锦囊牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [], skills: ['界荐言'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          skills: [],
          character: '曹操',
          health: 4,
          maxHealth: 4,
        }),
      ],
      cardMap: { kill1: kill, trick1: trick },
      zones: { deck: ['kill1', 'trick1'], discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.useCard('界荐言', '_unused');
    await harness.waitForStable();
    harness.processAllEvents();
    await P0.respond('界荐言', { declaration: '装备牌' });
    await harness.waitForStable();
    harness.processAllEvents();
    await P0.respond('界荐言', { target: 1 });
    await harness.waitForStable();
    harness.processAllEvents();

    // 无匹配:所有翻开的牌入弃牌堆
    expect(harness.state.zones.discardPile).toContain('kill1');
    expect(harness.state.zones.discardPile).toContain('trick1');
    expect(harness.state.zones.deck.length).toBe(0);
    // P1 没收到牌
    expect(harness.state.players[1].hand.length).toBe(0);
    // 但荐言仍算用过(限一次已计)
    expect(harness.state.players[0].vars['界荐言/usedThisTurn']).toBe(true);
  });
});
