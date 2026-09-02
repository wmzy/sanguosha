// 卢植(群·风林火山,OL hero/407)技能测试:
//   明任(被动):游戏开始摸2张+置任;结束阶段可换任
//   贞良(主动·转换技):阳弃同色牌伤人;阴回合外同色入弃牌堆令摸牌
//
// 测试覆盖:
//   明任——开局摸2+置任 / 结束阶段换任
//   贞良阳——弃同色牌造成伤害+翻阴 / 异色拒绝 / 超出攻击范围拒绝 / 限一次
//   贞良阴——回合外打出同色闪入弃牌堆→令摸牌+翻阳 / 异色不触发 / 自己回合不触发
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { setSkillModuleOverride } from '../../src/engine/skills/lifecycle';
import 明任Mod from '../../src/engine/skills/明任';
import 贞良Mod from '../../src/engine/skills/贞良';
import { createGameState, suitColor } from '../../src/engine/types';
import { applyAtom } from '../../src/engine/core/apply';
import type { Card, GameState, Json, Mark, PlayerState } from '../../src/engine/types';

// 本地注册(subagent 不碰 index.ts;主 agent 统一注册)
setSkillModuleOverride('明任', async () => 明任Mod);
setSkillModuleOverride('贞良', async () => 贞良Mod);

const REN_MARK_ID = '明任/任';

function mkCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦' = '♠',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function mkPlayer(opts: {
  index: number;
  name: string;
  character?: string;
  hand?: string[];
  skills?: string[];
  health?: number;
  maxHealth?: number;
  marks?: Mark[];
  vars?: Record<string, Json>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: opts.character ?? '卢植',
    health: opts.health ?? opts.maxHealth ?? 3,
    maxHealth: opts.maxHealth ?? 3,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: opts.vars ?? {},
    marks: opts.marks ?? [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 预置任标记(payload.cardId 指向 cardMap 中的一张牌) */
function renMark(cardId: string, player = 0): Mark {
  return { id: REN_MARK_ID, scope: player, payload: { cardId } };
}

/** 读取玩家的任牌 id */
function renCardId(state: GameState, player: number): string | undefined {
  const m = state.players[player]?.marks.find((mk) => mk.id === REN_MARK_ID);
  return (m?.payload as { cardId?: string } | undefined)?.cardId;
}

function getState(state: GameState, ownerId: number): '阳' | '阴' {
  return state.players[ownerId]?.vars['贞良/态'] === '阴' ? '阴' : '阳';
}

describe('明任', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 1. 游戏开始(首次回合开始)→ 摸2张 + 选一张手牌置为任
  it('首次回合开始 → 摸2张牌并置一张手牌为"任"', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['明任', '贞良'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: {
          c1: mkCard('c1', '杀', '♠', '7'),
          d1: mkCard('d1', '杀', '♥', '3'),
          d2: mkCard('d2', '闪', '♣', '4'),
        },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
        zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      }),
    );
    const P0 = harness.player('P0');

    expect(renCardId(harness.state, 0)).toBeUndefined();
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();

    // 摸了 d1, d2(手牌 c1,d1,d2)→ 询问选一张置任
    expect(harness.state.players[0].hand).toEqual(expect.arrayContaining(['c1', 'd1', 'd2']));
    P0.expectPending('请求回应'); // 明任/选牌
    await P0.respond('明任', { cardIds: ['d1'] });
    await harness.waitForStable();

    // d1 置为任(弃置入弃牌堆 earmark + 加任标记)
    expect(renCardId(harness.state, 0)).toBe('d1');
    expect(harness.state.players[0].hand).toEqual(['c1', 'd2']);
    expect(harness.state.zones.discardPile).toContain('d1');
  });

  // 2. 初始化仅触发一次
  it('游戏开始初始化仅触发一次', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['明任', '贞良'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: {
          c1: mkCard('c1', '杀'),
          d1: mkCard('d1', '杀', '♥'),
          d2: mkCard('d2', '杀', '♣'),
          d3: mkCard('d3', '杀', '♦'),
          d4: mkCard('d4', '杀', '♠'),
        },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
        zones: { deck: ['d1', 'd2', 'd3', 'd4'], discardPile: [], processing: [] },
      }),
    );
    const P0 = harness.player('P0');

    // 牌堆方向约定:deck 末尾=牌堆顶(最先摸),故 d4、d3 被摸入
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    await P0.respond('明任', { cardIds: ['d4'] });
    await harness.waitForStable();
    expect(renCardId(harness.state, 0)).toBe('d4');

    // 再次回合开始 → 不再触发摸牌+置任
    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    expect(renCardId(harness.state, 0)).toBe('d4'); // 任不变
    expect(harness.state.players[0].hand).toEqual(['c1', 'd3']); // 未再摸牌
  });

  // 3. 结束阶段可用手牌替换任
  it('结束阶段 → 用手牌替换"任"', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: 'P0',
            hand: ['c2'],
            skills: ['明任', '贞良'],
            marks: [renMark('c1')], // 预置任=c1(♠黑)
          }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: {
          c1: mkCard('c1', '杀', '♠', '7'),
          c2: mkCard('c2', '桃', '♥', '5'),
        },
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: { round: 1, phase: '回合结束', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    expect(renCardId(harness.state, 0)).toBe('c1');
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();

    // 询问是否替换
    P0.expectPending('请求回应');
    await P0.respond('明任', { choice: true });
    await harness.waitForStable();

    // 选一张手牌作为新任
    P0.expectPending('请求回应');
    await P0.respond('明任', { cardIds: ['c2'] });
    await harness.waitForStable();

    // 任已替换为 c2;c1 已在弃牌堆(初始化置任时弃置,替换仅去标记不动物理牌)
    expect(renCardId(harness.state, 0)).toBe('c2');
    expect(harness.state.players[0].hand).toEqual([]);
    expect(harness.state.zones.discardPile).toContain('c2');
  });

  // 4. 结束阶段选择不替换 → 任不变
  it('结束阶段选择不替换 → 任不变', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: 'P0',
            hand: ['c2'],
            skills: ['明任', '贞良'],
            marks: [renMark('c1')],
          }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: {
          c1: mkCard('c1', '杀', '♠'),
          c2: mkCard('c2', '桃', '♥'),
        },
        currentPlayerIndex: 0,
        phase: '回合结束',
        turn: { round: 1, phase: '回合结束', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '回合结束' });
    await harness.waitForStable();
    P0.expectPending('请求回应');
    await P0.respond('明任', { choice: false });
    await harness.waitForStable();

    expect(renCardId(harness.state, 0)).toBe('c1'); // 不变
    expect(harness.state.players[0].hand).toEqual(['c2']); // 未弃置
  });
});

describe('贞良(阳)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 1. 阳:弃一张与任同色的牌 → 对攻击范围内角色造成1伤害 → 翻阴
  it('弃同色牌对攻击范围内角色造成1点伤害,翻转为阴', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: 'P0',
            hand: ['r1', 'b1'],
            skills: ['明任', '贞良'],
            marks: [renMark('renR')], // 任=红
          }),
          mkPlayer({ index: 1, name: 'P1', character: '张飞', health: 4, maxHealth: 4 }),
        ],
        cardMap: {
          renR: mkCard('renR', '杀', '♥', '5'),
          r1: mkCard('r1', '杀', '♦', '7'), // 红
          b1: mkCard('b1', '闪', '♠', '2'), // 黑
        },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    expect(getState(harness.state, 0)).toBe('阳');
    await P0.triggerAction('贞良', 'use', { target: 1, cardId: 'r1' });
    await harness.waitForStable();

    expect(harness.state.players[1].health).toBe(3); // 受 1 伤害
    expect(harness.state.players[0].hand).toEqual(['b1']); // r1 已弃置
    expect(harness.state.zones.discardPile).toContain('r1');
    expect(getState(harness.state, 0)).toBe('阴'); // 翻阴
    // 本回合已用
    expect(harness.state.players[0].vars['贞良/usedThisTurn']).toBe(true);
  });

  // 2. 阳:弃异色牌 → 拒绝
  it('弃与任异色的牌 → 拒绝', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: 'P0',
            hand: ['b1'],
            skills: ['明任', '贞良'],
            marks: [renMark('renR')], // 任=红
          }),
          mkPlayer({ index: 1, name: 'P1', character: '张飞', health: 4, maxHealth: 4 }),
        ],
        cardMap: {
          renR: mkCard('renR', '杀', '♥', '5'),
          b1: mkCard('b1', '闪', '♠', '2'), // 黑,与红任异色
        },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '贞良',
      actionType: 'use',
      params: { target: 1, cardId: 'b1' },
    });
    expect(getState(harness.state, 0)).toBe('阳'); // 未发动
    expect(harness.state.players[1].health).toBe(4); // 未受伤
  });

  // 3. 阳:目标超出攻击范围 → 拒绝
  it('目标超出攻击范围 → 拒绝', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: 'P0',
            hand: ['r1'],
            skills: ['明任', '贞良'],
            marks: [renMark('renR')],
          }),
          mkPlayer({ index: 1, name: 'P1', character: '张飞', health: 4, maxHealth: 4 }),
          mkPlayer({ index: 2, name: 'P2', character: '刘备', health: 4, maxHealth: 4 }),
          mkPlayer({ index: 3, name: 'P3', character: '曹操', health: 4, maxHealth: 4 }),
        ],
        cardMap: {
          renR: mkCard('renR', '杀', '♥'),
          r1: mkCard('r1', '杀', '♦'),
        },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    // 4 人环形:P0→P2 距离 2,徒手攻击范围 1 → 超出
    await P0.expectRejected({
      skillId: '贞良',
      actionType: 'use',
      params: { target: 2, cardId: 'r1' },
    });
    expect(getState(harness.state, 0)).toBe('阳');
  });

  // 4. 阳:本回合已用过 → 拒绝
  it('本回合已用过贞良阳 → 拒绝', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: 'P0',
            hand: ['r1', 'r2'],
            skills: ['明任', '贞良'],
            marks: [renMark('renR')],
            vars: { '贞良/usedThisTurn': true },
          }),
          mkPlayer({ index: 1, name: 'P1', character: '张飞', health: 4, maxHealth: 4 }),
        ],
        cardMap: {
          renR: mkCard('renR', '杀', '♥'),
          r1: mkCard('r1', '杀', '♦'),
          r2: mkCard('r2', '杀', '♥'),
        },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '贞良',
      actionType: 'use',
      params: { target: 1, cardId: 'r1' },
    });
  });

  // 5. 阳:阴态时无法发动阳
  it('阴态时发动阳 → 拒绝', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: 'P0',
            hand: ['r1'],
            skills: ['明任', '贞良'],
            marks: [renMark('renR')],
            vars: { '贞良/态': '阴' },
          }),
          mkPlayer({ index: 1, name: 'P1', character: '张飞', health: 4, maxHealth: 4 }),
        ],
        cardMap: {
          renR: mkCard('renR', '杀', '♥'),
          r1: mkCard('r1', '杀', '♦'),
        },
        currentPlayerIndex: 0,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '贞良',
      actionType: 'use',
      params: { target: 1, cardId: 'r1' },
    });
  });
});

describe('贞良(阴)', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 1. 阴:回合外打出同色闪入弃牌堆 → 令一名角色摸一张牌 → 翻阳
  it('回合外打出与任同色的闪入弃牌堆 → 令一名角色摸一张牌,翻为阳', async () => {
    await harness.setup(
      createGameState({
        players: [
          // P0 阴态,任=红,手牌仅一张红闪
          mkPlayer({
            index: 0,
            name: 'P0',
            hand: ['shan'],
            skills: ['明任', '贞良'],
            marks: [renMark('renR')],
            vars: { '贞良/态': '阴' },
          }),
          mkPlayer({ index: 1, name: 'P1', character: '张飞', health: 4, maxHealth: 4, hand: ['s1'] }),
          mkPlayer({ index: 2, name: 'P2', character: '刘备', health: 4, maxHealth: 4, hand: [] }),
        ],
        cardMap: {
          renR: mkCard('renR', '杀', '♥', '5'),
          shan: mkCard('shan', '闪', '♦', '2'), // 红闪,与红任同色
          s1: mkCard('s1', '杀', '♠', '7'),
          dd0: mkCard('dd0', '杀', '♣'),
        },
        currentPlayerIndex: 1, // P1 回合(P0 回合外)
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
        zones: { deck: ['dd0'], discardPile: [], processing: [] },
      }),
    );
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');
    const P2 = harness.player('P2');

    expect(getState(harness.state, 0)).toBe('阴');

    // P1 对 P0 出杀
    await P1.useCardAndTarget('杀', 's1', [0]);
    await harness.waitForStable();

    // 询问闪 → P0 出红闪
    P0.expectPending('询问闪');
    await P0.respond('闪', { cardId: 'shan' });
    await harness.waitForStable();

    // 红闪入弃牌堆,与红任同色 → 阴触发:confirm
    P0.expectPending('请求回应');
    await P0.respond('贞良', { choice: true });
    await harness.waitForStable();

    // 选 P2 摸一张牌
    P0.expectPending('请求回应');
    await P0.respond('贞良', { target: 2 });
    await harness.waitForStable();

    // P2 摸一张(dd0)
    expect(harness.state.players[2].hand).toEqual(['dd0']);
    // P0 未受伤(闪抵消了杀)
    expect(harness.state.players[0].health).toBe(3);
    // 翻为阳
    expect(getState(harness.state, 0)).toBe('阳');
  });

  // 2. 阴:打出与任异色的闪 → 不触发
  it('回合外打出与任异色的牌 → 不触发阴', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: 'P0',
            hand: ['shan'],
            skills: ['明任', '贞良'],
            marks: [renMark('renR')], // 任=红
            vars: { '贞良/态': '阴' },
          }),
          mkPlayer({ index: 1, name: 'P1', character: '张飞', health: 4, maxHealth: 4, hand: ['s1'] }),
        ],
        cardMap: {
          renR: mkCard('renR', '杀', '♥', '5'),
          shan: mkCard('shan', '闪', '♠', '2'), // 黑闪,与红任异色
          s1: mkCard('s1', '杀', '♠', '7'),
        },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    await P1.useCardAndTarget('杀', 's1', [0]);
    await harness.waitForStable();
    P0.expectPending('询问闪');
    await P0.respond('闪', { cardId: 'shan' });
    await harness.waitForStable();

    // 黑闪与红任异色 → 不触发阴;杀被抵消,P0 不受伤
    expect(harness.state.players[0].health).toBe(3);
    expect(getState(harness.state, 0)).toBe('阴'); // 未翻转
    expect(harness.state.pendingSlots.size).toBe(0); // 无 pending
  });

  // 3. 阴:自己回合打出 → 不触发(仅回合外)
  it('自己回合打出同色牌 → 不触发阴', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: 'P0',
            hand: ['shan', 's0'],
            skills: ['明任', '贞良'],
            marks: [renMark('renR')], // 任=红
            vars: { '贞良/态': '阴' },
          }),
          mkPlayer({ index: 1, name: 'P1', character: '张飞', health: 4, maxHealth: 4, hand: ['shan1'] }),
        ],
        cardMap: {
          renR: mkCard('renR', '杀', '♥', '5'),
          shan: mkCard('shan', '闪', '♦', '2'), // 红闪
          s0: mkCard('s0', '杀', '♠', '7'),
          shan1: mkCard('shan1', '闪', '♣', '2'),
        },
        currentPlayerIndex: 0, // P0 自己回合
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    // P0 对 P1 出杀 → P1 出闪 → 杀入弃牌堆(但是 P0 自己回合,不触发阴)
    await P0.useCardAndTarget('杀', 's0', [1]);
    await harness.waitForStable();
    P1.expectPending('询问闪');
    await P1.respond('闪', { cardId: 'shan1' });
    await harness.waitForStable();

    // P0 自己回合:即便有同色牌入弃牌堆也不触发阴
    expect(getState(harness.state, 0)).toBe('阴'); // 未翻转
  });

  // 4. 阴:选择不发动 → 不翻转
  it('阴触发但选择不发动 → 不翻转,保持阴态', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({
            index: 0,
            name: 'P0',
            hand: ['shan'],
            skills: ['明任', '贞良'],
            marks: [renMark('renR')],
            vars: { '贞良/态': '阴' },
          }),
          mkPlayer({ index: 1, name: 'P1', character: '张飞', health: 4, maxHealth: 4, hand: ['s1'] }),
        ],
        cardMap: {
          renR: mkCard('renR', '杀', '♥', '5'),
          shan: mkCard('shan', '闪', '♦', '2'),
          s1: mkCard('s1', '杀', '♠', '7'),
        },
        currentPlayerIndex: 1,
        phase: '出牌',
        turn: { round: 1, phase: '出牌', vars: {} },
      }),
    );
    const P1 = harness.player('P1');
    const P0 = harness.player('P0');

    await P1.useCardAndTarget('杀', 's1', [0]);
    await harness.waitForStable();
    P0.expectPending('询问闪');
    await P0.respond('闪', { cardId: 'shan' });
    await harness.waitForStable();

    // 阴触发 confirm → 不发动
    P0.expectPending('请求回应');
    await P0.respond('贞良', { choice: false });
    await harness.waitForStable();

    expect(getState(harness.state, 0)).toBe('阴'); // 未翻转
    expect(harness.state.players[0].health).toBe(3); // 闪抵消杀
  });

  // 回归(2026-08-26):浏览器 AwaitingPrompt 对 useCard 型 pending 是两步式选牌,
  // 只发 respond{cardId}(无 cardIds);点「不回应」发 respond{}。修复前 validate
  // 只认 cardIds 数组 → 浏览器玩家永远无法置任/换任(贞良断粮)。
  it('浏览器形状:仅 {cardId} 单数也能完成置任', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['明任', '贞良'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: {
          c1: mkCard('c1', '杀', '♠', '7'),
          d1: mkCard('d1', '杀', '♥', '3'),
          d2: mkCard('d2', '闪', '♣', '4'),
        },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
        zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      }),
    );
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    await P0.respond('明任', { cardId: 'd1' }); // 两步式 UI 真实形状
    await harness.waitForStable();

    expect(renCardId(harness.state, 0)).toBe('d1');
    expect(harness.state.players[0].hand).toEqual(['c1', 'd2']);
    expect(harness.state.zones.discardPile).toContain('d1');
  });

  it('浏览器形状:{}(不回应)视为放弃置任,不卡询问', async () => {
    await harness.setup(
      createGameState({
        players: [
          mkPlayer({ index: 0, name: 'P0', hand: ['c1'], skills: ['明任', '贞良'] }),
          mkPlayer({ index: 1, name: 'P1', character: '曹操' }),
        ],
        cardMap: {
          c1: mkCard('c1', '杀', '♠', '7'),
          d1: mkCard('d1', '杀', '♥', '3'),
          d2: mkCard('d2', '闪', '♣', '4'),
        },
        currentPlayerIndex: 0,
        phase: '准备',
        turn: { round: 1, phase: '准备', vars: {} },
        zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
      }),
    );
    const P0 = harness.player('P0');

    void applyAtom(harness.state, { type: '回合开始', player: 0 });
    await harness.waitForStable();
    await P0.respond('明任', {});
    await harness.waitForStable();

    expect(renCardId(harness.state, 0)).toBeUndefined(); // 未置任
    expect(harness.state.pendingSlots.size).toBe(0); // 询问已结束
  });
});
