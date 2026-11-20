// tests/engine/deck-direction.test.ts
// 牌堆方向一致性:zones.deck 的「末尾 = 牌堆顶」(docs/architecture/引擎架构.md:1546)。
//
// 摸牌 / 置创牌 / 整理牌堆 / 观星 / 遗计 / 界称象 / 界恂恂 / 罪论 / 涯角 均按此约定取牌,
// 判定 / 红颜 / 五谷丰登 曾按「deck[0] = 牌堆顶」取牌——两套方向并存导致:
//   1. 判定翻开的牌不是牌堆顶(观星/遗计/恂恂 置顶的牌对判定完全无效);
//   2. 判定的牌与随后摸牌抽出的牌不是同一张(观星无法控判定);
//   3. 五谷丰登亮出的不是牌堆顶的牌。
// 本文件锁定「取牌方向唯一」这一可观察契约。
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, makeCard as sharedMakeCard, makePlayer as sharedMakePlayer } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import { runJudgeFlow } from '../../src/engine/flows/judge';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♥',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return sharedMakeCard(id, name, suit, rank, type);
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  character?: string;
}): PlayerState {
  return sharedMakePlayer({ ...opts, character: opts.character ?? opts.name });
}

/** deck 按「末尾 = 牌堆顶」书写:数组最后一项是下一张会被摸/判定的牌。 */
function makeState(deck: string[], cardMap: Record<string, Card>): GameState {
  const state = createGameState({
    players: [makePlayer({ index: 0, name: 'P1' }), makePlayer({ index: 1, name: 'P2' })],
    cardMap,
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
  state.zones = { deck: [...deck], discardPile: [], processing: [] };
  return state;
}

describe('牌堆方向:末尾 = 牌堆顶', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('判定 翻开的是牌堆顶(deck 末尾),而非牌堆底', async () => {
    const bottom = makeCard('bottom', '杀', '♠', '2');
    const top = makeCard('top', '闪', '♥', '7');
    const state = makeState(['bottom', 'top'], { bottom, top });
    await harness.setup(state);

    const judged = await runJudgeFlow(state, 0, '测试判定');
    expect(judged).toBe('top');
  });

  it('判定 消耗牌堆顶后,摸牌 抽出的仍是新的牌堆顶(两机制方向一致)', async () => {
    const bottom = makeCard('bottom', '杀', '♠', '2');
    const middle = makeCard('middle', '桃', '♣', '5');
    const top = makeCard('top', '闪', '♥', '7');
    const state = makeState(['bottom', 'middle', 'top'], { bottom, middle, top });
    await harness.setup(state);

    expect(await runJudgeFlow(state, 0, '测试判定')).toBe('top');
    await applyAtom(state, { type: '摸牌', player: 0, count: 1 });
    expect(state.players[0].hand).toEqual(['middle']);
    expect(state.zones.deck).toEqual(['bottom']);
  });

  it('红颜 把牌堆顶的黑桃视为红桃(改判对象 = 实际翻开的牌)', async () => {
    const bottom = makeCard('bottom', '桃', '♥', '3');
    const top = makeCard('top', '杀', '♠', '5');
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['红颜'], character: '小乔' }),
        makePlayer({ index: 1, name: 'P2' }),
      ],
      cardMap: { bottom, top },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['bottom', 'top'], discardPile: [], processing: [] };
    await harness.setup(state);

    const judged = await runJudgeFlow(state, 0, '测试判定');
    expect(judged).toBe('top');
    expect(state.cardMap['top'].suit).toBe('♥');
  });

  it('五谷丰登 亮出的是牌堆顶(deck 末尾逐张翻出),reveal 顺序 = 先顶后次顶', async () => {
    const bottom = makeCard('bottom', '杀', '♠', '2');
    const inner = makeCard('inner', '桃', '♥', '3');
    const top2 = makeCard('top2', '酒', '♣', '5');
    const top1 = makeCard('top1', '闪', '♦', '7');
    const wugu = makeCard('wg1', '五谷丰登', '♥', '9', '锦囊牌');
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['wg1'], skills: ['五谷丰登'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['五谷丰登'] }),
      ],
      cardMap: { bottom, inner, top2, top1, wg1: wugu },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: ['bottom', 'inner', 'top2', 'top1'], discardPile: [], processing: [] };
    await harness.setup(state);

    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    await P1.useCard('五谷丰登', 'wg1');
    // 选牌前的无懈可击广播 → pass(没人打)
    await P1.pass();

    // 两名存活角色 → 亮 2 张;reveal 顺序 = 从 deck 末尾逐张:先 top1(顶),再 top2
    expect(harness.state.localVars['五谷丰登/亮牌']).toEqual(['top1', 'top2']);
    expect(harness.state.zones.deck).toEqual(['bottom', 'inner']);

    await P1.respond('五谷丰登', { cardId: 'top1' });
    await P1.pass();
    await P2.respond('五谷丰登', { cardId: 'top2' });
    await harness.waitForStable();

    // 亮出的两张牌各被选走;牌堆底部的 bottom/inner 不受影响
    expect(harness.state.players[0].hand).toContain('top1');
    expect(harness.state.players[1].hand).toContain('top2');
    expect(harness.state.zones.deck).toEqual(['bottom', 'inner']);
  });
});
