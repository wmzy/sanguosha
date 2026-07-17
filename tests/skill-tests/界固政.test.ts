// 界固政(界张昭张纮·被动技·OL 界限突破版)测试:
//   每阶段限一次,当其他角色的至少两张牌因弃置而置入弃牌堆后,
//   你可以将其中一张牌交给该角色,然后你可以获得其余的牌。
//
// 触发方式:让 P1(制衡)在自己回合出牌阶段用制衡弃≥2张 → 弃置 afterHook 触发界固政。
//
// 验证:
//   A. 发动 + 选1张交给该角色 + 获得其余 → 该角色收回1张,自己获其余
//   B. 不发动(超时/拒绝)→ 无效果,弃牌留在弃牌堆
//   C. 发动 + 选1张交给 + 不获得其余 → 该角色收回1张,其余留弃牌堆
//   D. ≥2 门槛:仅弃1张 → 不触发
//   E. 每阶段限一次:同一阶段第二次弃置不再触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { createGameState } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/create-engine';
import { suitColor } from '../../src/shared/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';

function makeCard(id: string, name: string, suit: '♠' | '♥' | '♣' | '♦' = '♠'): Card {
  return { id, name, suit, color: suitColor(suit), rank: 'A', type: '基本牌' };
}

function makePlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '',
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: [],
    judgeZone: [],
    tags: [],
  };
}

/** 构建标准场景:P0=界张昭张纮(界固政),P1=制衡手(当前回合),P1 hand 可定制 */
function buildState(opts: { p1Hand: string[]; extraCards?: Record<string, Card> }): GameState {
  return createGameState({
    players: [
      makePlayer({
        index: 0,
        name: '界张昭张纮',
        character: '界张昭张纮',
        hand: [],
        skills: ['界固政'],
        health: 3,
        maxHealth: 3,
      }),
      makePlayer({
        index: 1,
        name: 'P1',
        character: '孙权',
        hand: opts.p1Hand,
        skills: ['制衡'],
        health: 4,
        maxHealth: 4,
      }),
    ],
    cardMap: {
      c1: makeCard('c1', '杀'),
      c2: makeCard('c2', '闪'),
      c3: makeCard('c3', '桃'),
      c4: makeCard('c4', '酒'),
      ...(opts.extraCards ?? {}),
    },
    currentPlayerIndex: 1, // P1 的回合
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界固政(OL 界限突破版)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── A. 发动 + 选1张交给 + 获得其余 ───────────────────────
  it('发动:弃[c1,c2] → 选 c1 交给 P1 + 获得 c2 → P1 收回 c1,自己获 c2', async () => {
    const state = buildState({ p1Hand: ['c1', 'c2', 'c3'] });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界张昭张纮');

    // P1 制衡弃 [c1,c2] → 界固政触发
    void (await P1.triggerAction('制衡', 'use', { cardIds: ['c1', 'c2'] }));

    // 第一步:是否发动 → 发动
    await P0.respond('界固政', { choice: true });
    // 第二步:选一张交给该角色 → 选 c1
    await P0.respond('界固政', { cardId: 'c1' });
    // 第三步:是否获得其余 → 获得
    await P0.respond('界固政', { choice: true });

    // c1 回到 P1 手牌(交给该角色)
    expect(harness.state.players[1].hand).toContain('c1');
    // c2 被自己获得
    expect(harness.state.players[0].hand).toContain('c2');
    // 弃牌堆不再含 c1/c2(都被移走)
    expect(harness.state.zones.discardPile).not.toContain('c1');
    expect(harness.state.zones.discardPile).not.toContain('c2');
  });

  // ─── B. 不发动(拒绝)→ 无效果,弃牌留弃牌堆 ────────────────
  it('不发动:弃[c1,c2] → 拒绝 → 无效果,弃牌留弃牌堆', async () => {
    const state = buildState({ p1Hand: ['c1', 'c2', 'c3'] });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界张昭张纮');

    void (await P1.triggerAction('制衡', 'use', { cardIds: ['c1', 'c2'] }));

    // 第一步:不发动
    await P0.respond('界固政', { choice: false });

    // 无后续询问
    P0.expectNoPending();
    // 弃牌仍留弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.zones.discardPile).toContain('c2');
    // 自己未获得任何牌
    expect(harness.state.players[0].hand.length).toBe(0);
    // 本阶段已触发标记置位(每阶段限一次)
    expect(harness.state.localVars['界固政/已触发']).toBe(true);
  });

  // ─── C. 发动 + 选1张交给 + 不获得其余 ─────────────────────
  it('发动+不获得其余:弃[c1,c2] → 选 c1 交给 + 不获得 → c2 留弃牌堆', async () => {
    const state = buildState({ p1Hand: ['c1', 'c2', 'c3'] });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界张昭张纮');

    void (await P1.triggerAction('制衡', 'use', { cardIds: ['c1', 'c2'] }));

    await P0.respond('界固政', { choice: true }); // 发动
    await P0.respond('界固政', { cardId: 'c1' }); // 选 c1 交给
    await P0.respond('界固政', { choice: false }); // 不获得其余

    P0.expectNoPending();
    // c1 回到 P1
    expect(harness.state.players[1].hand).toContain('c1');
    // c2 仍在弃牌堆(未获得)
    expect(harness.state.zones.discardPile).toContain('c2');
    // 自己未获得
    expect(harness.state.players[0].hand.length).toBe(0);
  });

  // ─── D. ≥2 门槛:仅弃1张 → 不触发 ────────────────────────
  it('门槛:仅弃1张[c1] → 不触发(无询问)', async () => {
    const state = buildState({ p1Hand: ['c1', 'c2'] });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界张昭张纮');

    void (await P1.triggerAction('制衡', 'use', { cardIds: ['c1'] }));

    // 累计仅1张 <2,不触发
    P0.expectNoPending();
    expect(harness.state.zones.discardPile).toContain('c1');
    expect(harness.state.localVars['界固政/已触发']).toBeUndefined();
  });

  // ─── E. 每阶段限一次:第二次弃置不再触发 ──────────────────
  it('每阶段限一次:第一次触发后,同阶段第二次弃置不再触发', async () => {
    const state = buildState({ p1Hand: ['c1', 'c2', 'c3', 'c4'] });
    await harness.setup(state);
    const P1 = harness.player('P1');
    const P0 = harness.player('界张昭张纮');

    // 第一次:制衡弃 [c1,c2] → 触发 → 拒绝
    void (await P1.triggerAction('制衡', 'use', { cardIds: ['c1', 'c2'] }));
    await P0.respond('界固政', { choice: false });
    P0.expectNoPending();
    expect(harness.state.localVars['界固政/已触发']).toBe(true);

    // 第二次:直接执行弃置 atom(制衡每回合限一次,故绕过制衡直接弃置),验证界固政不再触发
    await applyAtom(harness.state, { type: '弃置', player: 1, cardIds: ['c3', 'c4'] });
    await harness.waitForStable();
    harness.processAllEvents();
    P0.expectNoPending();
    // c3/c4 仍留弃牌堆(界固政未发动)
    expect(harness.state.zones.discardPile).toContain('c3');
    expect(harness.state.zones.discardPile).toContain('c4');
    // 自己仍未获得
    expect(harness.state.players[0].hand.length).toBe(0);
  });
});
