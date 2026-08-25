// 界放逐(界曹丕·被动技)测试 —— 来源:2026-08-25 bug 审查修复回归;归并建议:与
// tests/skill-tests/放逐.test.ts(标版)同族,如后续合并武将测试文件可并入该文件。
//
//   修复点:官方逐字「当你受到伤害后,你可以令一名其他角色翻面,并令其摸X张牌
//   (X为你已损失体力值)」——原实现从不给目标添加翻面标签(只摸牌+清除已有标签),
//   「翻面」动作缺失。修复后镜像标版 放逐:flipFaceDown 加 '放逐/翻面' 标签,
//   目标准备阶段消费标签跳过整回合。
//
// 验证:
//   1. 端到端:P1(界曹丕)被杀受伤 → 选 P0 翻面 + 摸 X 张
//   2. 不发动:目标不摸牌不翻面
//   3. X = 已损失体力值
//   4. 翻面生效:目标下一回合准备阶段被跳过(镜像标版 放逐 的 skip 机制)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, waitForStable } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

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
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '曹丕',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
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

function buildDeck(cardMap: Record<string, Card>, n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `dk${i}`;
    cardMap[id] = makeCard(id, '杀', '♠', String(i + 2));
    ids.push(id);
  }
  return ids;
}

describe('界放逐', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 端到端:发动界放逐 ────────────────────
  it('P1(界曹丕)受伤 → 选 P0 翻面 + 摸 X=1 张', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash, p1s: makeCard('p1s', '闪', '♥', '2') };
    const deck = buildDeck(cardMap, 5);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1s'],
          skills: ['界放逐', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass(); // 不出闪

    // 受伤后询问发动
    P1.expectPending('请求回应');
    await P1.respond('界放逐', { choice: true });
    // 选目标 P0
    P1.expectPending('请求回应');
    await P1.respond('界放逐', { target: 0 });

    // X = 已损失体力 = 3 - 2 = 1(P0 出杀后手牌 0 → 摸 1)
    expect(harness.state.players[0].hand.length).toBe(1);
    // 修复点回归:P0 必须被真实翻面(获得翻面标签)
    expect(harness.state.players[0].tags).toContain('放逐/翻面');
    expect(harness.state.players[1].health).toBe(2);
  });

  // ─── 不发动 ────────────────────
  it('不发动界放逐:目标不摸牌不翻面', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash, p1s: makeCard('p1s', '闪', '♥', '2') };
    const deck = buildDeck(cardMap, 5);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1s'],
          skills: ['界放逐', '闪'],
          health: 3,
          maxHealth: 3,
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    P1.expectPending('请求回应');
    await P1.respond('界放逐', { choice: false });

    expect(harness.state.players[1].health).toBe(2);
    expect(harness.state.players[0].hand.length).toBe(0);
    expect(harness.state.players[0].tags).not.toContain('放逐/翻面');
  });

  // ─── X 随已损失体力变化 ────────────────────
  it('X = 已损失体力值:P1 已损 1 血再受伤,X=2 摸 2 张', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const cardMap: Record<string, Card> = { k1: slash, p1s: makeCard('p1s', '闪', '♥', '2') };
    const deck = buildDeck(cardMap, 5);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: ['k1'], skills: ['杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: ['p1s'],
          skills: ['界放逐', '闪'],
          health: 2,
          maxHealth: 3,
        }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    P1.expectPending('请求回应');
    await P1.respond('界放逐', { choice: true });
    P1.expectPending('请求回应');
    await P1.respond('界放逐', { target: 0 });

    // X = 受伤后已损失体力 = 3 - 1 = 2
    expect(harness.state.players[0].hand.length).toBe(2);
    expect(harness.state.players[0].tags).toContain('放逐/翻面');
  });

  // ─── 翻面生效:目标下一回合准备阶段被跳过 ────────────────────
  it('翻面:目标准备阶段开始时标签被消费且回合推进到下家', async () => {
    const cardMap: Record<string, Card> = {};
    const deck = buildDeck(cardMap, 5);
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', skills: ['闪'] }),
        // P1(界曹丕)存活,skip hooks 注册在 P1 座次
        makePlayer({ index: 1, name: 'P1', skills: ['界放逐'] }),
      ],
      cardMap,
      zones: { deck, discardPile: [], processing: [] },
      currentPlayerIndex: 0,
      phase: '准备',
      turn: { round: 2, phase: '准备', vars: {} },
    });
    state.players[0].tags = ['放逐/翻面'];
    await harness.setup(state);

    // 模拟 回合管理 回合启动序列
    await applyAtom(harness.state, { type: '回合开始', player: 0 });
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '准备' });
    void applyAtom(harness.state, { type: '阶段结束', player: 0, phase: '准备' });
    await waitForStable(harness.state);

    expect(harness.state.players[0].tags).not.toContain('放逐/翻面');
    expect(harness.state.currentPlayerIndex).toBe(1);
  });
});
