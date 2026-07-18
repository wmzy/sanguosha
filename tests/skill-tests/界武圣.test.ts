// tests/skill-tests/界武圣.test.ts
// 界武圣(界关羽·转化技):将一张红色牌(手牌或装备区)当【杀】使用或打出。
//   你使用的方片【杀】无距离限制。(OL 界限突破官方)
//
// 本测试聚焦"方片杀无距离限制"被动增益(本任务新增),涵盖:
//   1. 方片红牌转化杀 → 命中超距目标(2 座位距离,徒手范围 1)
//   2. 红桃红牌转化杀 → 仍受距离限制,超距被拒
//   3. 物理方片杀 → 同样享受距离豁免(被动增益不限于武圣转化)
//   4. 装备区方片牌转化杀 → 命中超距目标
//   5. 无界武圣技能者用方片杀 → 超距仍被拒(对照)
//   6. 正常距离内方片杀 → 命中(基础回归)
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
  character?: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '界关羽',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? ['界武圣'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 4 人环形:P1(0)→P3(2) 座位距离 2,徒手范围 1 → 默认超距 */
function makeFourPlayerState(opts: {
  p1Hand?: string[];
  p1Equip?: Record<string, string>;
  p1Skills?: string[];
  cardMap?: Record<string, Card>;
}): GameState {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        hand: opts.p1Hand ?? [],
        equipment: opts.p1Equip,
        skills: opts.p1Skills ?? ['界武圣', '杀'],
      }),
      makePlayer({
        index: 1,
        name: 'P2',
        character: '曹操',
        skills: ['闪'],
      }),
      makePlayer({
        index: 2,
        name: 'P3',
        character: '刘备',
        skills: ['闪'],
      }),
      makePlayer({
        index: 3,
        name: 'P4',
        character: '孙权',
        skills: ['闪'],
      }),
    ],
    cardMap: opts.cardMap ?? {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界武圣', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 方片红牌转化杀 → 命中超距 ─────────────────────────────

  it('方片红牌转化杀 → 命中超距目标(徒手范围1,座位距离2)', async () => {
    const diamond = makeCard('c1', '桃', '♦', 'A'); // 方片红牌
    const state = makeFourPlayerState({
      p1Hand: ['c1'],
      cardMap: { c1: diamond },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    // 转化:方片桃当杀,目标 P3(超距)
    await P1.transformThenUse(
      '界武圣',
      { cardId: 'c1' },
      '杀',
      { cardId: 'c1#武圣', targets: [2] },
    );

    // P3 不闪 → 扣血(说明杀生效,距离豁免)
    await P3.pass();
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 红桃红牌转化杀 → 仍受距离限制 ─────────────────────────────

  it('红桃红牌转化杀 → 超距被拒(仅方片杀豁免)', async () => {
    const heart = makeCard('c1', '桃', '♥', 'A'); // 红桃红牌
    const state = makeFourPlayerState({
      p1Hand: ['c1'],
      cardMap: { c1: heart },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 转化成功,但 杀.use validate 因红桃(非方片)受距离限制 → 超距被拒
    // 期望整个 dispatch 被拒(主 action validate 失败 → rollback 转化)
    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 'c1#武圣', targets: [2] },
      preceding: [{ skillId: '界武圣', actionType: 'transform', params: { cardId: 'c1' } }],
    });

    // 转化被回滚:原卡仍在 P1 手牌
    expect(harness.state.players[0].hand).toContain('c1');
  });

  // ─── 物理方片杀 → 享受距离豁免 ─────────────────────────────

  it('物理方片杀 → 命中超距目标(被动增益适用所有方片杀,不限武圣转化)', async () => {
    const diamondKill = makeCard('k1', '杀', '♦', '6'); // 物理方片杀
    const state = makeFourPlayerState({
      p1Hand: ['k1'],
      cardMap: { k1: diamondKill },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    // 直接用物理方片杀打 P3(超距)
    await P1.useCardAndTarget('杀', 'k1', [2]);

    // P3 不闪 → 扣血(说明方片杀距离豁免生效,非武圣转化亦可)
    await P3.pass();
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 装备区方片红牌转化杀 → 命中超距 ─────────────────────────────

  it('装备区方片牌转化杀 → 命中超距目标(装备红色牌转化+方片豁免)', async () => {
    // 方片装备(赤兔进攻马,红色)— 用任意方片装备牌模拟
    const diamondEquip = makeCard('e1', '赤兔', '♦', 'A', '装备牌');
    const state = makeFourPlayerState({
      p1Equip: { 进攻马: 'e1' },
      cardMap: { e1: diamondEquip },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P3 = harness.player('P3');

    // 转化装备区方片赤兔当杀,目标 P3(超距)
    await P1.transformThenUse(
      '界武圣',
      { cardId: 'e1' },
      '杀',
      { cardId: 'e1#武圣', targets: [2] },
    );

    await P3.pass();
    expect(harness.state.players[2].health).toBe(3);
  });

  // ─── 无界武圣技能者用方片杀 → 超距仍被拒(对照) ─────────────

  it('无界武圣技能者用方片杀 → 超距被拒(被动增益仅界武圣持有者)', async () => {
    const diamondKill = makeCard('k1', '杀', '♦', '6');
    const state = makeFourPlayerState({
      p1Hand: ['k1'],
      p1Skills: ['杀'], // 无界武圣
      cardMap: { k1: diamondKill },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 无界武圣 → 方片杀仍受距离限制,超距被拒
    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 'k1', targets: [2] },
    });
  });

  // ─── 正常距离内方片杀 → 命中(回归) ─────────────────────────────

  it('正常距离内方片杀 → 命中相邻目标', async () => {
    const diamondKill = makeCard('k1', '杀', '♦', '6');
    const state = makeFourPlayerState({
      p1Hand: ['k1'],
      cardMap: { k1: diamondKill },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P2 = harness.player('P2');

    // P2 是相邻(座位距离 1,徒手范围内)
    await P1.useCardAndTarget('杀', 'k1', [1]);

    await P2.pass();
    expect(harness.state.players[1].health).toBe(3);
  });

  // ─── 黑桃杀超距 → 仍被拒(非红色,不转化,不豁免) ─────────────

  it('黑桃杀 → 超距被拒(非方片不豁免)', async () => {
    const spadeKill = makeCard('k1', '杀', '♠', '7');
    const state = makeFourPlayerState({
      p1Hand: ['k1'],
      cardMap: { k1: spadeKill },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    await P1.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 'k1', targets: [2] },
    });
  });
});
