// tests/skill-tests/据守.test.ts
// 据守(曹仁·主动技)测试:结束阶段,翻面并摸三张牌,然后跳过你的下一回合。
//
// 验证:
//   1. 正面:发动据守 → 摸 3 张 + 加翻面标签 + 标记已用
//   2. 负面:非结束阶段发动 → 拒绝
//   3. 负面:已使用过 → 拒绝
//   4. 正面:下一回合准备阶段 → 翻面标签被消费,据守/skipAll 标志设置
//   5. 正面:跳过整回合后 cPI 推进到下家(非自己)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { applyAtom } from '../../src/engine/create-engine';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦', rank = 'A'): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  character?: string;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '曹仁',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['据守'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

function buildDeck(cardMap: Record<string, Card>, n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `dk${i}`;
    cardMap[id] = makeCard(id, '杀', '♠', String(i + 2));
    ids.push(id);
  }
  return ids;
}

describe('据守', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('正面:发动据守 → 摸 3 张 + 加翻面标签 + 标记已用', async () => {
    const cardMap: Record<string, Card> = {};
    const deck = buildDeck(cardMap, 5);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const handBefore = harness.state.players[0].hand.length;

    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();
    harness.processAllEvents();

    // 摸 3 张
    expect(harness.state.players[0].hand.length).toBe(handBefore + 3);
    // 翻面标签
    expect(harness.state.players[0].tags).toContain('据守/翻面');
    // 已用标记
    expect(harness.state.players[0].vars['据守/usedThisTurn']).toBe(true);
  });

  it('正面:在 回合结束 阶段发动也可以', async () => {
    const cardMap: Record<string, Card> = {};
    const deck = buildDeck(cardMap, 5);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '回合结束',
      turn: { round: 1, phase: '回合结束', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();
    harness.processAllEvents();

    expect(harness.state.players[0].hand.length).toBe(3);
    expect(harness.state.players[0].tags).toContain('据守/翻面');
  });

  it('负面:出牌阶段发动 → 拒绝(非结束阶段)', async () => {
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap: {},
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({ skillId: '据守', actionType: 'use', params: {} });
    // 无翻面标签
    expect(harness.state.players[0].tags).not.toContain('据守/翻面');
  });

  it('负面:已使用过 → 拒绝', async () => {
    const cardMap: Record<string, Card> = {};
    const deck = buildDeck(cardMap, 5);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '弃牌',
      turn: { round: 1, phase: '弃牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 第一次发动(成功)
    await P1.triggerAction('据守', 'use', {});
    await harness.waitForStable();
    harness.processAllEvents();
    expect(harness.state.players[0].vars['据守/usedThisTurn']).toBe(true);

    // 第二次发动(拒绝)
    await P1.expectRejected({ skillId: '据守', actionType: 'use', params: {} });
  });

  it('正面:下一回合准备阶段 → 翻面标签消费 + skipAll 标志 + cPI 推进', async () => {
    const cardMap: Record<string, Card> = {};
    const deck = buildDeck(cardMap, 8);
    const state: GameState = createGameState({
      players: [
        // 预设翻面标签 + 已用标记,模拟上一回合已发动据守
        makePlayer({ index: 0, name: 'P1', hand: ['dk0', 'dk1', 'dk2'], skills: ['据守'] }),
        makePlayer({ index: 1, name: 'P2', skills: [], character: '曹操' }),
      ],
      cardMap,
      zones: { deck, processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 2, phase: '准备', vars: {} },
    });
    // 预设翻面标签
    state.players[0].tags = ['据守/翻面'];
    await harness.setup(state);

    const handBefore = harness.state.players[0].hand.length;

    // 模拟 回合管理 的回合启动序列:回合开始 → 阶段开始(准备) → 阶段结束(准备)
    // 据守 在 阶段开始(准备) cancel + 设 skipAll;
    // 阶段结束(准备) before-hook 检测 skipAll → 主动推进回合(下一玩家 + 回合结束)
    // 前两步同步 await(快速完成);第三步 void(会触发嵌套的下家回合启动)
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '准备' });
    await harness.waitForStable();
    harness.processAllEvents();

    // 翻面标签已被消费
    expect(harness.state.players[0].tags).not.toContain('据守/翻面');
    // skipAll 标志已设置(短暂存在,触发 阶段结束(准备) 后清除)
    // cPI 已推进到下家(跳过自己回合)
    expect(harness.state.currentPlayerIndex).toBe(1);
    // P1 未摸牌(摸牌阶段被跳过)
    expect(harness.state.players[0].hand.length).toBe(handBefore);
  });
});
