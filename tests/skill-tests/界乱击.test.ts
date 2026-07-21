// 界乱击(界袁绍·群·转化技)测试:
//   transform:两张同花色手牌当【万箭齐发】(影子卡)。
//   use(覆盖万箭齐发.use,仅界袁绍座次):"少选一个目标"询问后正常结算。
//
// OL 官方(hero/450):"你可以将两张花色相同的手牌当【万箭齐发】使用。
//   你使用【万箭齐发】可以少选一个目标。"
//
// 模型:preceding=[界乱击.transform cardIds=[id1,id2]] + 主 action=万箭齐发.use
//   (万箭齐发 cardId = `${id1}#${id2}#界乱击`,影子卡)。
//
// 验证:
//   1. 正面:两张♥同花色 → transformThenUse 万箭齐发 → 询问"少选一个目标" → 不排除 → P2/P3 都扣血
//   2. 正面:排除 P2 → 仅 P3 扣血,P2 不扣
//   3. 正面:排除所有(只剩一个目标时仍可询问;此处 3 人,排除后剩 2→1)
//   4. 真实万箭齐发牌:界袁绍使用真实万箭齐发牌也走界版(询问少选目标)
//   5. 负面:两张异花色(♠+♥)→ transform 被拒
//   6. 负面:1 张牌 → 拒绝
//   7. 负面:非自己回合 → transform 拒绝
//   8. 边界:只有 1 名其他角色时,询问出现但排除后无目标,无人扣血
//   9. availableActions:界乱击 transform 声明,prompt 卡过滤 min/max=2
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
  faction?: PlayerState['faction'];
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.name,
    health: opts.health ?? 4,
    maxHealth: opts.maxHealth ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? ['杀', '闪'],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: opts.faction,
  };
}

function buildState(opts?: {
  p1Hand?: string[];
  p2Hand?: string[];
  p3Hand?: string[];
  extraCards?: Record<string, Card>;
  current?: number;
  players?: number;
}): GameState {
  const players: PlayerState[] = [
    makePlayer({
      index: 0,
      name: '界袁绍',
      faction: '群',
      hand: opts?.p1Hand ?? [],
      // 关键:DEFAULT_SKILLS (含 万箭齐发) 须在 界乱击 之前实例化,
      // 界乱击.onInit 才能 registerAction('万箭齐发', ownerId, 'use', ...) 覆盖标版。
      skills: ['万箭齐发', '闪', '界乱击'],
    }),
    makePlayer({
      index: 1,
      name: 'P2',
      faction: '群',
      hand: opts?.p2Hand ?? [],
      skills: ['闪'],
    }),
  ];
  if (!opts?.players || opts.players >= 3) {
    players.push(
      makePlayer({
        index: 2,
        name: 'P3',
        faction: '魏',
        hand: opts?.p3Hand ?? [],
        skills: ['闪'],
      }),
    );
  }
  return createGameState({
    players,
    cardMap: { ...(opts?.extraCards ?? {}) },
    currentPlayerIndex: opts?.current ?? 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('界乱击', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:两张♥当万箭齐发,不排除目标 → P2/P3 都扣血 ──────────

  it('transformThenUse:两张♥当万箭齐发 → 不排除 → P2/P3 都扣血', async () => {
    const c1 = makeCard('c1', '闪', '♥', '2');
    const c2 = makeCard('c2', '桃', '♥', '3');
    const state = buildState({
      p1Hand: ['c1', 'c2'],
      extraCards: { c1, c2 },
    });
    await harness.setup(state);
    const P1 = harness.player('界袁绍');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    await P1.transformThenUse('界乱击', { cardIds: ['c1', 'c2'] }, '万箭齐发', {
      cardId: 'c1#c2#界乱击',
    });
    await harness.waitForStable();

    // 询问"少选一个目标"(界袁绍 confirm/selectTarget)
    P1.expectPending('请求回应');
    await P1.respond('界乱击', {}); // 不选目标(放弃排除)
    await harness.waitForStable();

    // 排除后:P2 询问无懈 → pass,询问闪 → pass → 扣血
    // (无懈广播窗口可能合并)
    const slot2 = [...harness.state.pendingSlots.values()][0];
    if (slot2 && (slot2.atom as { type: string; requestType?: string }).type === '请求回应'
        && (slot2.atom as { requestType?: string }).requestType !== '__弃牌') {
      // 无懈可击广播
      await P2.pass();
      await harness.waitForStable();
    }
    // P2 询问闪
    P2.expectPending('询问闪');
    await P2.pass();
    await harness.waitForStable();

    // P3 无懈广播
    const slot3 = [...harness.state.pendingSlots.values()][0];
    if (slot3 && (slot3.atom as { type: string; requestType?: string }).type === '请求回应'
        && (slot3.atom as { requestType?: string }).requestType !== '__弃牌') {
      await P3.pass();
      await harness.waitForStable();
    }
    P3.expectPending('询问闪');
    await P3.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(3); // P2 扣 1 血
    expect(harness.state.players[2].health).toBe(3); // P3 扣 1 血
    // 影子万箭齐发最终进弃牌堆
    expect(harness.state.zones.discardPile).toContain('c1#c2#界乱击');
  });

  // ─── 2. 正面:排除 P2 → 仅 P3 扣血,P2 不扣 ──────────────────

  it('少选目标:排除 P2 → 仅 P3 扣血,P2 不扣', async () => {
    const c1 = makeCard('c1', '闪', '♥', '2');
    const c2 = makeCard('c2', '桃', '♥', '3');
    const state = buildState({
      p1Hand: ['c1', 'c2'],
      extraCards: { c1, c2 },
    });
    await harness.setup(state);
    const P1 = harness.player('界袁绍');
    const P2 = harness.player('P2');
    const P3 = harness.player('P3');

    await P1.transformThenUse('界乱击', { cardIds: ['c1', 'c2'] }, '万箭齐发', {
      cardId: 'c1#c2#界乱击',
    });
    await harness.waitForStable();

    // 询问"少选一个目标" → 排除 P2
    P1.expectPending('请求回应');
    await P1.respond('界乱击', { target: 1 });
    await harness.waitForStable();

    // P2 被排除,不应被询问闪(可能 P3 无懈广播先)
    // P3 无懈广播 → pass
    const slot3 = [...harness.state.pendingSlots.values()][0];
    if (slot3 && (slot3.atom as { type: string; requestType?: string }).type === '请求回应'
        && (slot3.atom as { requestType?: string }).requestType !== '__弃牌') {
      await P3.pass();
      await harness.waitForStable();
    }
    // P3 询问闪 → pass → 扣血
    P3.expectPending('询问闪');
    await P3.pass();
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(4); // P2 未扣血
    expect(harness.state.players[2].health).toBe(3); // P3 扣 1 血
  });

  // ─── 3. 真实万箭齐发牌:界袁绍使用真实牌也走界版(询问少选) ──────

  it('真实万箭齐发牌:界袁绍使用 → 走界版(询问少选目标)', async () => {
    const wj = makeCard('wj', '万箭齐发', '♥', 'A', '锦囊牌');
    const state = buildState({
      p1Hand: ['wj'],
      extraCards: { wj },
      players: 2, // 2 人后,排除 P2 后无目标 → 无人扣血,但锦囊应走完流程
    });
    await harness.setup(state);
    const P1 = harness.player('界袁绍');

    await P1.useCard('万箭齐发', 'wj');
    await harness.waitForStable();

    // 询问"少选一个目标"(界版覆盖生效)
    P1.expectPending('请求回应');
    // 排除 P2(2 人局只有 P2 是目标,排除后无目标 → 无人扣血)
    await P1.respond('界乱击', { target: 1 });
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(4); // P2 被排除,未扣血
    // 锦囊正常结算进弃牌堆
    expect(harness.state.zones.discardPile).toContain('wj');
  });

  // ─── 4. 负面:两张异花色(♠+♥)→ 拒绝 ─────────────────────

  it('transform:两张异花色(♠+♥)→ 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const c2 = makeCard('c2', '桃', '♥', '3');
    const state = buildState({
      p1Hand: ['c1', 'c2'],
      extraCards: { c1, c2 },
    });
    await harness.setup(state);
    const P1 = harness.player('界袁绍');

    await P1.expectRejected({
      skillId: '界乱击',
      actionType: 'transform',
      params: { cardIds: ['c1', 'c2'] },
    });
  });

  // ─── 5. 负面:1 张牌 → 拒绝 ────────────────────────────────

  it('transform:1 张牌 → 拒绝(需要 2 张)', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const state = buildState({
      p1Hand: ['c1'],
      extraCards: { c1 },
    });
    await harness.setup(state);
    const P1 = harness.player('界袁绍');

    await P1.expectRejected({
      skillId: '界乱击',
      actionType: 'transform',
      params: { cardIds: ['c1'] },
    });
  });

  // ─── 6. 负面:同一张牌 → 拒绝 ──────────────────────────────

  it('transform:同一张牌 → 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const state = buildState({
      p1Hand: ['c1'],
      extraCards: { c1 },
    });
    await harness.setup(state);
    const P1 = harness.player('界袁绍');

    await P1.expectRejected({
      skillId: '界乱击',
      actionType: 'transform',
      params: { cardIds: ['c1', 'c1'] },
    });
  });

  // ─── 7. 负面:非自己回合 → 拒绝 ────────────────────────────

  it('transform:非自己回合 → 拒绝', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const c2 = makeCard('c2', '闪', '♠', '3');
    const state = buildState({
      p1Hand: ['c1', 'c2'],
      extraCards: { c1, c2 },
      current: 1, // P2 回合
    });
    await harness.setup(state);
    const P1 = harness.player('界袁绍');

    await P1.expectRejected({
      skillId: '界乱击',
      actionType: 'transform',
      params: { cardIds: ['c1', 'c2'] },
    });
  });

  // ─── 8. rollback:万箭齐发.use 失败 → 两张原卡还原,影子卡删除 ──

  it('transform rollback:万箭齐发.use 失败(非法 cardId)→ 两张原卡还原,影子删除', async () => {
    const c1 = makeCard('c1', '闪', '♥', '2');
    const c2 = makeCard('c2', '桃', '♥', '3');
    const state = buildState({
      p1Hand: ['c1', 'c2'],
      extraCards: { c1, c2 },
    });
    await harness.setup(state);
    const P1 = harness.player('界袁绍');

    await P1.expectRejected({
      skillId: '万箭齐发',
      actionType: 'use',
      params: { cardId: 'wrong-id' },
      preceding: [{ skillId: '界乱击', actionType: 'transform', params: { cardIds: ['c1', 'c2'] } }],
    });

    expect(harness.state.cardMap['c1#c2#界乱击']).toBeUndefined();
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c1', 'c2']));
    expect(harness.state.players[0].hand).toHaveLength(2);
  });

  // ─── 9. availableActions:界乱击 transform 声明,prompt 卡过滤 min=2 max=2 ──

  it('availableActions:界乱击 transform 声明,prompt 卡过滤 min=2 max=2', async () => {
    const c1 = makeCard('c1', '杀', '♠', '2');
    const c2 = makeCard('c2', '闪', '♠', '3');
    const c3 = makeCard('c3', '桃', '♥', 'A');
    const state = buildState({
      p1Hand: ['c1', 'c2', 'c3'],
      extraCards: { c1, c2, c3 },
    });
    await harness.setup(state);
    const P1 = harness.player('界袁绍');
    P1.processEvents();

    const actions = P1.availableActions().filter((a) => a.skillId === '界乱击');
    expect(actions.length).toBeGreaterThan(0);
    const transform = actions.find((a) => a.actionType === 'transform');
    expect(transform).toBeDefined();
    // 卡过滤 min/max = 2
    const prompt = transform!.prompt as { cardFilter?: { min?: number; max?: number } };
    expect(prompt.cardFilter?.min).toBe(2);
    expect(prompt.cardFilter?.max).toBe(2);
  });
});
