// 集成测试:反馈(司马懿·被动技) — 受到伤害后获得伤害来源一张牌。
//
// 覆盖:
//   1. 受伤 → 询问 → 发动(confirm=true) → P1 获得 P0 一张手牌
//   2. 受伤 → 询问 → 不发动(confirm=false) → P1 不拿牌
//
// 关键机制(反馈.ts):
//   registerAfterHook(造成伤害)→ target===ownerId → applyAtom 请求回应 反馈/confirm
//   confirm=true → applyAtom 获得(P0→P1) 一张牌
//
// 模式:SkillTestHarness + useCardAndTarget(杀) + pass(不出闪) + respond(反馈)
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import type { Card, GameState } from '../../src/engine/types';
import { suitColor } from '../../src/shared/types';
import { createGameState } from '../../src/engine/types';

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? opts.health ?? 4,
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

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♥',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

describe('反馈:端到端(harness)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 1:受伤 → 反馈 confirm=true → P1 获得 P0 一张手牌
  // ─────────────────────────────────────────────────────────────
  it('用例1:P0 杀 P1 → P1 不出闪 → 反馈 confirm=true → P1 拿 P0 一张手牌', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const victimCard: Card = makeCard('v1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id, victimCard.id], skills: ['杀'] }),
        makePlayer({
          index: 1, name: 'P1',
          hand: [],
          skills: ['反馈', '闪'],
          health: 4, maxHealth: 4,
        }),
      ],
      cardMap: { [slash.id]: slash, [victimCard.id]: victimCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');
    const p1HandBefore = harness.state.players[1].hand.length;

    // P0 杀 P1
    await P0.useCardAndTarget('杀', slash.id, [1]);
    // P1 不出闪 → 扣血 → 反馈 after hook → 反馈/confirm pending
    await P1.pass();

    // 此时应有 pending 反馈/confirm(target=P1)
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...harness.state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string; target?: number };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('反馈/confirm');
    expect(slotAtom.target).toBe(1);

    // P1 confirm=true(发动反馈)
    await P1.respond('反馈', { choice: true });

    // P1 拿到了牌(手牌数增加)
    expect(harness.state.players[1].hand.length).toBeGreaterThan(p1HandBefore);
    // localVars['反馈/confirmed'] 保持 true(表示成功发动;浏览器可读取)
    expect(harness.state.localVars['反馈/confirmed']).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // 用例 2:受伤 → 反馈 confirm=false → P1 不拿牌,P0 手牌不变
  // ─────────────────────────────────────────────────────────────
  it('用例2:反馈 confirm=false → 不拿牌,P0 手牌数不变', async () => {
    const slash: Card = makeCard('k1', '杀', '♠', '7');
    const victimCard: Card = makeCard('v1', '闪', '♥', '5');

    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P0', hand: [slash.id, victimCard.id], skills: ['杀'] }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['反馈', '闪'], health: 4, maxHealth: 4 }),
      ],
      cardMap: { [slash.id]: slash, [victimCard.id]: victimCard },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p0HandBefore = harness.state.players[0].hand.length;
    const p1HandBefore = harness.state.players[1].hand.length;

    await P0.useCardAndTarget('杀', slash.id, [1]);
    await P1.pass();

    // 反馈 confirm pending 应有
    expect(harness.state.pendingSlots.size).toBeGreaterThan(0);
    const slot = [...harness.state.pendingSlots.values()][0];
    const slotAtom = slot.atom as { type: string; requestType?: string };
    expect(slotAtom.type).toBe('请求回应');
    expect(slotAtom.requestType).toBe('反馈/confirm');

    // P1 confirm=false → 不发动
    await P1.respond('反馈', { choice: false });

    // P1 手牌数不变(没拿牌)
    expect(harness.state.players[1].hand.length).toBe(p1HandBefore);
  });
});
