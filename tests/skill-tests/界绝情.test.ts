// 界绝情(界张春华·锁定技)测试:
//   "锁定技,你即将造成的伤害视为失去体力。"
//
// 覆盖:
//   1. 春华出杀P1,P1不闪 → P1失去1点体力(atom 流出现 失去体力,不出现 造成伤害)
//   2. 春华杀伤害值=1 → 目标体力-1(与正常伤害扣血量一致)
//   3. 反馈/奸雄不触发(因为已转为失去体力,无造成伤害事件)—— 反馈 owner=来源 不触发
//   4. 春华自己受伤时,正常走 造成伤害(她不是来源,绝情不干预)
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
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界张春华',
    health: opts.health ?? 3,
    maxHealth: opts.maxHealth ?? opts.health ?? 3,
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

describe('界绝情', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 取本局 atom 历史中所有 atom 类型序列(忽略 notify)
  function atomTypes(): string[] {
    return (harness.state.atomHistory as Array<{ kind: string; atom?: { type: string } }>)
      .filter((e) => e.kind === 'atom' && e.atom)
      .map((e) => e.atom!.type);
  }

  // ─── 1. 春华出杀 → 目标失去体力(不出现造成伤害事件) ────────────
  it('春华杀P1,P1不闪 → P1失去1点体力(atom 流为 失去体力,非 造成伤害)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: '春华', hand: ['k1'], skills: ['界绝情', '杀'] }),
        makePlayer({
          index: 1,
          name: 'P1',
          character: '曹操',
          skills: ['闪'],
        }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('春华');
    const P1 = harness.player('P1');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    // P1 不闪
    await P1.pass();

    // P1 体力 -1(P1 maxHealth 默认 3,故 3 - 1 = 2)
    expect(harness.state.players[1].health).toBe(2);
    // atom 历史中应该有 失去体力,且它替代了 造成伤害
    const types = atomTypes();
    expect(types).toContain('失去体力');
    // 在杀→询问闪→没闪之后,应有 失去体力 而非 造成伤害
    const lastDamageish = types.filter((t) => t === '造成伤害' || t === '失去体力').pop();
    expect(lastDamageish).toBe('失去体力');
    void P0;
  });

  // ─── 2. 春华自己受伤时,正常走造成伤害 ────────────────────
  it('春华自己受伤(被杀),正常走造成伤害(她不是来源,绝情不干预)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '春华',
          hand: [],
          skills: ['界绝情', '闪'],
        }),
        makePlayer({
          index: 1,
          name: '攻击者',
          character: '张飞',
          hand: ['k1'],
          skills: ['杀'],
        }),
      ],
      cardMap: { k1: slash },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('攻击者');
    const P0 = harness.player('春华');

    await P1.useCardAndTarget('杀', 'k1', [0]);
    // 春华不闪
    await P0.pass();

    expect(harness.state.players[0].health).toBe(2); // 3 - 1
    const types = atomTypes();
    expect(types).toContain('造成伤害');
  });

  // ─── 3. 反馈不触发(因伤害转为失去体力) ────────────────────
  it('伤害转为失去体力 → 目标的反馈不触发(无造成伤害事件)', async () => {
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: '春华',
          hand: ['k1', 'extra'],
          skills: ['界绝情', '杀'],
        }),
        makePlayer({
          index: 1,
          name: '司马懿',
          character: '司马懿',
          hand: [],
          skills: ['反馈', '闪'],
        }),
      ],
      cardMap: { k1: slash, extra: makeCard('e1', '桃', '♥', '5') },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('春华');
    const P1 = harness.player('司马懿');

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P1.pass();

    // 反馈没有触发:春华仍持有 extra(若反馈触发,春华会被询问是否拿牌)
    // 确认无 反馈/confirm pending
    expect(harness.state.pendingSlots.size).toBe(0);
    expect(harness.state.players[0].hand).toContain('extra');
  });
});
