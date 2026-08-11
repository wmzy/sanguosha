// tests/skill-tests/耀武.test.ts
// 耀武(华雄·群·锁定技,官方 hero/214 逐字):
//   锁定技,当一名角色使用红色【杀】对你造成伤害时,其选择回复1点体力或摸一张牌。
//
// 验证:
//   1. 红杀造成伤害 → 来源被询问选择;选「摸一张牌」→ 来源手牌+1
//   2. 红杀造成伤害 → 来源选「回复1点体力」→ 来源体力+1(须不满血)
//   3. 黑杀造成伤害 → 不触发耀武(无询问、来源无收益)
//   4. 红色非杀(如红色锦囊)伤害 → 不触发(须红色杀)
//   5. 超时不选 → 默认摸一张牌(锁定技,来源必得收益)
//   6. 华雄为伤害目标(锁定技归属方)而非来源;收益归来源方
//   7. respond 校验:option 非法 / 无 pending → 拒绝
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { skillLoaders } from '../../src/engine/skills';
import * as 耀武Module from '../../src/engine/skills/耀武';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';
import type { SkillModule } from '../../src/engine/types';

// 本地注册 耀武 技能模块(主 agent 统一在 skills/index.ts 注册;测试本地兜底)
skillLoaders['耀武'] = async () => 耀武Module as unknown as SkillModule;

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
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

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

/** P1(source) 出杀打 P2(华雄·耀武)。opts 控制杀的颜色/类型、P1 体力、牌堆顶。 */
function buildState(opts?: {
  slashSuit?: '♠' | '♥' | '♣' | '♦';
  slashName?: string;
  slashType?: '基本牌' | '锦囊牌' | '装备牌';
  p1Health?: number;
  deck?: string[];
}): GameState {
  const suit = opts?.slashSuit ?? '♥'; // 默认红杀
  const slash = makeCard(
    'c1',
    opts?.slashName ?? '杀',
    suit,
    'A',
    opts?.slashType ?? '基本牌',
  );
  const cardMap: Record<string, Card> = { c1: slash };
  const deck: string[] = [];
  for (const id of opts?.deck ?? ['d1']) {
    cardMap[id] = makeCard(id, '闪', '♠', '2');
    deck.push(id);
  }
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: 'P1',
        hand: ['c1'],
        skills: ['杀'],
        health: opts?.p1Health ?? 4,
        maxHealth: 4,
      }),
      makePlayer({
        index: 1,
        name: '华雄',
        hand: [],
        skills: ['耀武'],
        health: 6,
        maxHealth: 6,
      }),
      makePlayer({ index: 2, name: 'P3', hand: [], skills: [] }),
    ],
    cardMap,
    zones: { deck, processing: [], discardPile: [] },
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('耀武', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('红杀造成伤害 → 来源选「摸一张牌」→ 来源手牌 +1,华雄体力 -1', async () => {
    await harness.setup(buildState({ slashSuit: '♥' }));
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    // 华雄无手牌:询问闪走 skip,直接扣血 → 耀武触发 → 来源(P1)被询问选择
    P1.expectPending('请求回应');

    // P1 选摸一张牌
    await P1.respond('耀武', { option: 'draw' });

    // 华雄扣血 6 → 5
    expect(harness.state.players[1].health).toBe(5);
    // P1 出杀后 c1 离手,耀武令其摸一张(d1)→ 手牌 = [d1]
    expect(harness.state.players[0].hand).toEqual(['d1']);
    expect(harness.state.zones.deck).toEqual([]);
  });

  it('红杀造成伤害 → 来源选「回复1点体力」→ 来源体力 +1(不满血时)', async () => {
    await harness.setup(buildState({ slashSuit: '♦', p1Health: 3 }));
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    P1.expectPending('请求回应');

    // P1 选回复1点体力(当前 3/4)
    await P1.respond('耀武', { option: 'recover' });

    // 华雄扣血 6 → 5;P1 回复 3 → 4(满血)
    expect(harness.state.players[1].health).toBe(5);
    expect(harness.state.players[0].health).toBe(4);
    // P1 出杀后未摸牌,手牌为空
    expect(harness.state.players[0].hand).toEqual([]);
  });

  it('黑杀造成伤害 → 不触发耀武(无询问、来源无收益)', async () => {
    await harness.setup(buildState({ slashSuit: '♠' }));
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    // 黑杀不触发耀武:无 pending,华雄直接扣血
    expect(harness.state.pendingSlots.size).toBe(0);

    // 华雄扣血 6 → 5
    expect(harness.state.players[1].health).toBe(5);
    // P1 无收益:出杀后手牌为空,牌堆未动
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.deck).toEqual(['d1']);
  });

  it('红色非杀(红色锦囊牌名不为杀)→ 不触发耀武', async () => {
    // 用一张红色「决斗」锦囊牌冒充伤害来源牌(走直接伤害 flow,避免锦囊使用流程)
    const card = makeCard('c9', '决斗', '♥', 'A', '锦囊牌');
    const d1 = makeCard('d1', '闪', '♠', '2');
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: [], health: 3, maxHealth: 4 }),
        makePlayer({
          index: 1,
          name: '华雄',
          hand: [],
          skills: ['耀武'],
          health: 6,
          maxHealth: 6,
        }),
      ],
      cardMap: { c9: card, d1 },
      zones: { deck: ['d1'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    // 直接对华雄造成红色「决斗」伤害(绕过锦囊使用流程,聚焦耀武判定)
    const { runDamageFlow } = await import('../../src/engine/flows/damage');
    void runDamageFlow(harness.state, 0, 1, 1, 'c9');
    await harness.waitForStable();

    // 红色锦囊(非杀)→ 不触发耀武:无 pending
    expect(harness.state.pendingSlots.size).toBe(0);
    // 华雄扣血 6 → 5;P1 无收益(手牌空、体力不变、牌堆未动)
    expect(harness.state.players[1].health).toBe(5);
    expect(harness.state.players[0].health).toBe(3);
    expect(harness.state.players[0].hand).toEqual([]);
  });

  it('超时不选 → 默认摸一张牌(锁定技,来源必得收益)', async () => {
    await harness.setup(buildState({ slashSuit: '♥' }));
    const P1 = harness.player('P1');

    await P1.useCardAndTarget('杀', 'c1', [1]);
    P1.expectPending('请求回应');

    // 来源超时不选(pass = fireTimeout)→ 耀武默认摸一张牌
    await P1.pass();

    // 华雄扣血 6 → 5;P1 默认摸一张(d1)
    expect(harness.state.players[1].health).toBe(5);
    expect(harness.state.players[0].hand).toEqual(['d1']);
    expect(harness.state.zones.deck).toEqual([]);
  });

  it('酒+红杀造成2点伤害 → 耀武只触发一次(每次伤害事件一次,非每点)', async () => {
    // 直接对华雄造成2点红色杀伤害,验证只询问一次
    const slash = makeCard('c9', '杀', '♥', 'A');
    const d1 = makeCard('d1', '闪', '♠', '2');
    const d2 = makeCard('d2', '闪', '♣', '3');
    const state = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: [], health: 4, maxHealth: 4 }),
        makePlayer({
          index: 1,
          name: '华雄',
          hand: [],
          skills: ['耀武'],
          health: 6,
          maxHealth: 6,
        }),
      ],
      cardMap: { c9: slash, d1, d2 },
      zones: { deck: ['d1', 'd2'], processing: [], discardPile: [] },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    const { runDamageFlow } = await import('../../src/engine/flows/damage');
    void runDamageFlow(harness.state, 0, 1, 2, 'c9');
    await harness.waitForStable();

    // 耀武只询问一次(2点伤害 = 1次伤害事件)
    P1.expectPending('请求回应');
    await P1.respond('耀武', { option: 'draw' });

    // 华雄扣血 6 → 4(2点);P1 只摸一张
    expect(harness.state.players[1].health).toBe(4);
    expect(harness.state.players[0].hand).toHaveLength(1);
    expect(harness.state.zones.deck).toHaveLength(1);
  });

  // ─── respond 校验 ─────────────────────────

  it('respond:option 非法 → 拒绝', async () => {
    await harness.setup(buildState({ slashSuit: '♥' }));
    const P1 = harness.player('P1');
    await P1.useCardAndTarget('杀', 'c1', [1]);
    P1.expectPending('请求回应');

    await P1.expectRejected({
      skillId: '耀武',
      actionType: 'respond',
      params: { option: 'invalid' },
    });
  });

  it('respond:无 pending → 拒绝', async () => {
    await harness.setup(buildState({ slashSuit: '♥' }));
    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '耀武',
      actionType: 'respond',
      params: { option: 'draw' },
    });
  });

  it('respond:合法 option 写入 localVars 并结算', async () => {
    await harness.setup(buildState({ slashSuit: '♥' }));
    const P1 = harness.player('P1');
    await P1.useCardAndTarget('杀', 'c1', [1]);
    P1.expectPending('请求回应');

    await P1.respond('耀武', { option: 'recover' });
    await harness.waitForStable();

    // 选择后 localVars 已清空(消费完毕)
    expect(harness.state.localVars['耀武/选择结果']).toBeUndefined();
  });
});
