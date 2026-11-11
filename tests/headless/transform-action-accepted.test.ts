// 客户端枚举出的转化技 action 必须能被引擎接受。
//
// 契约:影子卡 id 由客户端构造(浏览器 usePlayInteraction 与无头 availableActions 同约定):
//   `${选中牌 id 以 # 连接}#${skillId}`(skillId = 注册该 transform action 的技能 id)。
// 引擎的转化 execute 必须创建**同一个 id** 的影子卡,否则主 action(读 cardMap[影子 id])
// validate 恒失败 → 该转化技在浏览器与 AI 客户端整类不可用(按钮点了没反应/动作恒被拒)。
//
// 本用例不走技能测试 harness 的手写 id,而是先让客户端枚举出 action,再原样 dispatch,
// 从而锁死「客户端构造的 id == 引擎创建的 id」这条端到端契约。
import { describe, it, expect, beforeEach } from 'vitest';
import { enumerateAvailableActions } from '../../src/client/headless/availableActions';
import {
  registerSkillActions,
  clearRegistry,
  getActionsForPlayer,
} from '../../src/client/skillActionRegistry';
import { buildView, dispatch } from '../../src/engine/index';
import { registerSkillsFromState } from '../../src/engine/index';
import { createGameState, suitColor } from '../../src/engine/types';
import type { AvailableAction } from '../../src/client/headless/types';
import type { Card, GameState, PlayerState } from '../../src/engine/types';
import '../../src/engine/atoms';

function mkCard(id: string, name: string, suit: Card['suit'], rank: string): Card {
  return { id, name, suit, color: suitColor(suit), rank, type: '基本牌' };
}

function mkPlayer(index: number, name: string, hand: string[], skills: string[]): PlayerState {
  return {
    index,
    name,
    character: name,
    health: 4,
    maxHealth: 4,
    alive: true,
    hand,
    equipment: {},
    skills,
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
    faction: '群',
  };
}

/** 组装 state + 注册技能 + 注册客户端 action,返回当前座次枚举出的转化 action 列表 */
async function enumerateTransforms(opts: {
  players: PlayerState[];
  cardMap: Record<string, Card>;
  seat: number;
}): Promise<{ state: GameState; actions: AvailableAction[] }> {
  const state = createGameState({
    players: opts.players,
    cardMap: opts.cardMap,
    currentPlayerIndex: opts.seat,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
  state.zones = { deck: [], discardPile: [], processing: [] };
  await registerSkillsFromState(state);
  clearRegistry();
  for (const p of state.players) await registerSkillActions(p.index, p.skills);
  const view = buildView(state, opts.seat);
  const actions = enumerateAvailableActions(view, opts.seat, getActionsForPlayer(opts.seat));
  return { state, actions };
}

describe('客户端枚举的转化技 action 引擎可接受(影子 id 约定)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('界武圣:枚举出的红牌转化杀 action 被接受', async () => {
    const red = mkCard('r1', '闪', '♥', '5');
    const { state, actions } = await enumerateTransforms({
      players: [mkPlayer(0, 'P0', ['r1'], ['界武圣', '杀', '回合管理']), mkPlayer(1, 'P1', [], [])],
      cardMap: { r1: red },
      seat: 0,
    });

    const transform = actions.find((a) => a.message.preceding?.[0]?.skillId === '界武圣');
    expect(transform, '客户端应枚举出界武圣转化杀').toBeDefined();
    // 客户端构造的影子 id 约定:${cardId}#${skillId}
    expect(transform!.message.params.cardId).toBe('r1#界武圣');

    const result = await dispatch(state, {
      ...transform!.message,
      params: { ...transform!.message.params, targets: [1] },
      ownerId: 0,
      baseSeq: state.seq,
    });
    expect(result.accepted, '客户端枚举的界武圣转化必须被引擎接受').toBe(true);
  });

  it('界疠火:枚举出的非火杀转化 action 被接受', async () => {
    const kill = mkCard('k1', '杀', '♠', '7');
    const { state, actions } = await enumerateTransforms({
      players: [mkPlayer(0, 'P0', ['k1'], ['界疠火', '杀', '回合管理']), mkPlayer(1, 'P1', [], [])],
      cardMap: { k1: kill },
      seat: 0,
    });

    const transform = actions.find((a) => a.message.preceding?.[0]?.skillId === '界疠火');
    expect(transform, '客户端应枚举出界疠火转化杀').toBeDefined();
    expect(transform!.message.params.cardId).toBe('k1#界疠火');

    const result = await dispatch(state, {
      ...transform!.message,
      params: { ...transform!.message.params, targets: [1] },
      ownerId: 0,
      baseSeq: state.seq,
    });
    expect(result.accepted, '客户端枚举的界疠火转化必须被引擎接受').toBe(true);
  });

  it('界父魂(granted 武圣):枚举出的单张红牌转化杀 action 被接受', async () => {
    const red = mkCard('r1', '闪', '♥', '5');
    const { state } = await enumerateTransforms({
      players: [mkPlayer(0, 'P0', ['r1'], ['界父魂', '杀', '回合管理']), mkPlayer(1, 'P1', [], [])],
      cardMap: { r1: red },
      seat: 0,
    });
    // 授予武圣(父魂杀造成伤害后的本回合状态):state 侧标记 + view 侧投影镜像
    state.turn.vars['父魂/granted'] = 0;
    state.turn.vars['__view/0/杀/unlimited/父魂'] = true;

    const view = buildView(state, 0);
    const granted = enumerateAvailableActions(view, 0, getActionsForPlayer(0)).find(
      (a) => a.message.preceding?.[0]?.actionType === '武圣transform',
    );
    expect(granted, '授予武圣后客户端应枚举出 武圣transform 动作').toBeDefined();
    expect(granted!.message.params.cardId).toBe('r1#界父魂');

    const result = await dispatch(state, {
      ...granted!.message,
      params: { ...granted!.message.params, targets: [1] },
      ownerId: 0,
      baseSeq: state.seq,
    });
    expect(result.accepted, '客户端枚举的 granted 武圣转化必须被引擎接受').toBe(true);
  });

  it('界父魂:枚举出的两张牌转化杀 action 被接受', async () => {
    const c1 = mkCard('c1', '闪', '♥', '5');
    const c2 = mkCard('c2', '杀', '♠', '6');
    const { state, actions } = await enumerateTransforms({
      players: [
        mkPlayer(0, 'P0', ['c1', 'c2'], ['界父魂', '杀', '回合管理']),
        mkPlayer(1, 'P1', [], []),
      ],
      cardMap: { c1, c2 },
      seat: 0,
    });

    const transform = actions.find((a) => a.message.preceding?.[0]?.skillId === '界父魂');
    expect(transform, '客户端应枚举出界父魂转化杀').toBeDefined();
    expect(transform!.message.params.cardId).toBe('c1#c2#界父魂');

    const result = await dispatch(state, {
      ...transform!.message,
      params: { ...transform!.message.params, targets: [1] },
      ownerId: 0,
      baseSeq: state.seq,
    });
    expect(result.accepted, '客户端枚举的界父魂转化必须被引擎接受').toBe(true);
  });

  // 回归:无头 combosOk 此前只枚举手牌对(availableActions 的 matchingCards = me.hand.filter),
  // 而引擎 界父魂 的 validate 接受 手牌∪装备区 原料(cardInOwnZone)——手牌不足 minCards
  // 时(1 手牌 + 1 装备)整类漏枚举;浏览器 transformComboOk 却支持装备区原料,两侧漂移。
  // 修复:transformMaterialPool 在手牌匹配数 < minCards 时并入装备区匹配牌。
  it('界父魂:手牌不足时装备区原料参与枚举且被引擎接受', async () => {
    const handCard = mkCard('h1', '闪', '♥', '5');
    const equipCard: Card = { ...mkCard('e1', '八卦阵', '♠', '2'), type: '装备牌' };
    const p0 = mkPlayer(0, 'P0', ['h1'], ['界父魂', '杀', '回合管理']);
    p0.equipment = { 武器: undefined, 防具: 'e1', 防御马: undefined, 进攻马: undefined };
    const { state, actions } = await enumerateTransforms({
      players: [p0, mkPlayer(1, 'P1', [], [])],
      cardMap: { h1: handCard, e1: equipCard },
      seat: 0,
    });

    const transform = actions.find((a) => a.message.preceding?.[0]?.skillId === '界父魂');
    expect(transform, '手牌1张+装备1张时应枚举出手牌+装备区原料的界父魂转化').toBeDefined();
    expect(transform!.message.params.cardId).toBe('h1#e1#界父魂');
    expect(transform!.message.preceding?.[0]?.params.cardIds).toEqual(['h1', 'e1']);

    const result = await dispatch(state, {
      ...transform!.message,
      params: { ...transform!.message.params, targets: [1] },
      ownerId: 0,
      baseSeq: state.seq,
    });
    expect(result.accepted, '手牌+装备区原料的界父魂转化必须被引擎接受').toBe(true);
  });

  // 回归:多卡转化的产出牌由 transform 回调决定(乱击/界乱击 = 万箭齐发,非杀)。
  // 客户端枚举若硬编码主 action 为 杀.use,引擎 validate 读影子卡名(万箭齐发)恒拒
  // 「不是杀」→ 乱击/界乱击在无头/AI 客户端整类不可用。
  it('乱击:枚举出的两张同花色牌转化万箭齐发 action 被接受', async () => {
    const s1 = mkCard('s1', '杀', '♠', '5');
    const s2 = mkCard('s2', '闪', '♠', '7');
    const { state, actions } = await enumerateTransforms({
      players: [
        mkPlayer(0, 'P0', ['s1', 's2'], ['乱击', '杀', '回合管理']),
        mkPlayer(1, 'P1', [], []),
      ],
      cardMap: { s1, s2 },
      seat: 0,
    });

    const transform = actions.find((a) => a.message.preceding?.[0]?.skillId === '乱击');
    expect(transform, '客户端应枚举出乱击转化').toBeDefined();
    expect(transform!.message.skillId).toBe('万箭齐发');
    expect(transform!.message.params.cardId).toBe('s1#s2#乱击');

    const result = await dispatch(state, {
      ...transform!.message,
      params: { ...transform!.message.params },
      ownerId: 0,
      baseSeq: state.seq,
    });
    expect(result.accepted, '客户端枚举的乱击转化必须被引擎接受').toBe(true);
  });

  it('界乱击:枚举出的两张同花色牌转化万箭齐发 action 被接受', async () => {
    const s1 = mkCard('s1', '杀', '♠', '5');
    const s2 = mkCard('s2', '闪', '♠', '7');
    const { state, actions } = await enumerateTransforms({
      players: [
        mkPlayer(0, 'P0', ['s1', 's2'], ['界乱击', '杀', '回合管理']),
        mkPlayer(1, 'P1', [], []),
      ],
      cardMap: { s1, s2 },
      seat: 0,
    });

    const transform = actions.find((a) => a.message.preceding?.[0]?.skillId === '界乱击');
    expect(transform, '客户端应枚举出界乱击转化').toBeDefined();
    expect(transform!.message.skillId).toBe('万箭齐发');
    expect(transform!.message.params.cardId).toBe('s1#s2#界乱击');

    const result = await dispatch(state, {
      ...transform!.message,
      params: { ...transform!.message.params },
      ownerId: 0,
      baseSeq: state.seq,
    });
    expect(result.accepted, '客户端枚举的界乱击转化必须被引擎接受').toBe(true);
  });
});

// ─── 多卡转化技的回应路径(决斗/南蛮入侵 的 询问杀 窗口) ───
// 契约:无头客户端在回应窗口里枚举出的多卡转化动作,主 action 必须是 <请求牌名>.respond,
// 且引擎 dispatch 必须接受。旧实现多卡分支整段缺少回应路径 → 枚举出 杀.use,
// 引擎 validate 恒拒「不是你的回合」,丈八蛇矛/界父魂 无法用两张牌代杀回应。
describe('多卡转化技回应路径:客户端枚举 → 引擎 dispatch', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('丈八蛇矛:询问杀窗口中枚举出的 杀.respond 被引擎接受', async () => {
    const a = mkCard('a1', '闪', '♥', '3');
    const b = mkCard('b1', '桃', '♦', '4');
    const duel = mkCard('du1', '决斗', '♣', '10');
    const zhangba: Card = {
      id: 'zb1',
      name: '丈八蛇矛',
      suit: '♠',
      color: '黑',
      rank: '12',
      type: '装备牌',
    };
    const p0 = mkPlayer(0, 'P0', ['a1', 'b1'], ['丈八蛇矛', '杀', '回合管理']);
    p0.equipment = { 武器: 'zb1' };
    const state = createGameState({
      players: [p0, mkPlayer(1, 'P1', ['du1'], ['决斗', '杀', '回合管理'])],
      cardMap: { a1: a, b1: b, du1: duel, zb1: zhangba },
      currentPlayerIndex: 1,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await registerSkillsFromState(state);
    clearRegistry();
    for (const p of state.players) await registerSkillActions(p.index, p.skills);

    // P1 对 P0 使用决斗 → P0 被询问杀
    const duelUse = await dispatch(state, {
      skillId: '决斗',
      actionType: 'use',
      ownerId: 1,
      params: { cardId: 'du1', targets: [0] },
      baseSeq: state.seq,
    });
    expect(duelUse.accepted, 'P1 的决斗应被接受').toBe(true);
    await duelUse.settle;

    const view = buildView(state, 0);
    expect((view.pending?.atom as { type?: string }).type).toBe('询问杀');
    const actions = enumerateAvailableActions(view, 0, getActionsForPlayer(0));
    const transform = actions.find((x) => x.category === 'transform');
    expect(transform, '客户端应枚举出丈八蛇矛的代杀回应').toBeDefined();
    expect(transform!.message.skillId).toBe('杀');
    expect(transform!.message.actionType).toBe('respond');
    expect(transform!.message.params.cardId).toBe('a1#b1#丈八蛇矛');

    const res = await dispatch(state, {
      ...transform!.message,
      ownerId: 0,
      baseSeq: state.seq,
    });
    expect(res.accepted, '客户端枚举的丈八蛇矛代杀回应必须被引擎接受').toBe(true);
  });
});

// ─── 多卡转化的组合约束:客户端枚举出的每个组合都必须被引擎接受 ───
// 乱击/界乱击 要求两张同花色;comboFilter 缺位时客户端按 C(n,2) 枚举全部组合,
// 非同行色的组合提交即被拒(AI 的 pickBestAction 确定性 → 反复挑中同一非法组合空转)。
describe('多卡转化组合约束:枚举出的每个组合都可被引擎接受', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it.each(['乱击', '界乱击'])('%s:混花色手牌 → 枚举出的组合全部同花色且被接受', async (skillId) => {
    const spade = mkCard('s1', '杀', '♠', '5');
    const heart = mkCard('h1', '闪', '♥', '7');
    const spade2 = mkCard('s2', '桃', '♠', '9');
    const { state, actions } = await enumerateTransforms({
      players: [
        mkPlayer(0, 'P0', ['s1', 'h1', 's2'], [skillId, '杀', '回合管理']),
        mkPlayer(1, 'P1', [], []),
      ],
      cardMap: { s1: spade, h1: heart, s2: spade2 },
      seat: 0,
    });

    const transforms = actions.filter((a) => a.category === 'transform');
    expect(transforms, '客户端应枚举出同花色组合').toHaveLength(1);
    const cardIds = (transforms[0].message.preceding![0].params as { cardIds: string[] }).cardIds;
    expect(new Set(cardIds)).toEqual(new Set(['s1', 's2']));

    const res = await dispatch(state, {
      ...transforms[0].message,
      params: { ...transforms[0].message.params },
      ownerId: 0,
      baseSeq: state.seq,
    });
    expect(res.accepted, `${skillId} 枚举出的同花色组合必须被引擎接受`).toBe(true);
  });
});

// ─── 转化技的产出牌决定目标语义(界龙胆 四向:杀/闪/酒/桃) ───
// 界龙胆 酒→桃 产出【桃】(selfTarget:自动以自己为目标)、桃→酒 产出【酒】(无目标牌)。
// 枚举沿用 transform action 自己的 targetFilter(为出杀方向设计的「其他角色」)会枚举出
// 引擎必拒的动作(「只能对自己使用酒」/「桃只能对受伤角色使用」),该方向整类不可用。
describe('转化技产出牌的目标语义(界龙胆)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('酒当桃:产出【桃】按 selfTarget 预填自己,dispatch 被接受', async () => {
    const jiu = mkCard('j1', '酒', '♠', '9');
    const p0 = mkPlayer(0, 'P0', ['j1'], ['界龙胆', '酒', '桃', '回合管理']);
    p0.health = 3; // 桃只能对受伤角色使用
    const { state, actions } = await enumerateTransforms({
      players: [p0, mkPlayer(1, 'P1', [], [])],
      cardMap: { j1: jiu },
      seat: 0,
    });
    const tf = actions.find((a) => a.message.skillId === '桃');
    expect(tf, '客户端应枚举出酒当桃').toBeDefined();
    expect(tf!.message.params.cardId).toBe('j1#界龙胆');
    expect(tf!.message.params.targets).toEqual([0]); // 自己(桃 selfTarget)

    const res = await dispatch(state, { ...tf!.message, ownerId: 0, baseSeq: state.seq });
    expect(res.accepted, '客户端枚举的酒当桃必须被引擎接受').toBe(true);
  });

  it('桃当酒:产出【酒】无目标(酒.use 是 useCard prompt)', async () => {
    const peach = mkCard('t1', '桃', '♥', '3');
    const { state, actions } = await enumerateTransforms({
      players: [
        mkPlayer(0, 'P0', ['t1'], ['界龙胆', '酒', '桃', '回合管理']),
        mkPlayer(1, 'P1', [], []),
      ],
      cardMap: { t1: peach },
      seat: 0,
    });
    const tf = actions.find((a) => a.message.skillId === '酒');
    expect(tf, '客户端应枚举出桃当酒').toBeDefined();
    expect(tf!.message.params.cardId).toBe('t1#界龙胆');
    expect(tf!.message.params.targets).toBeUndefined(); // 无目标牌
    expect(tf!.validTargets).toEqual([]);

    const res = await dispatch(state, { ...tf!.message, ownerId: 0, baseSeq: state.seq });
    expect(res.accepted, '客户端枚举的桃当酒必须被引擎接受').toBe(true);
  });
});

// ─── 多声明型转化技(界渐营/界矫诏):一个声明牌名一个 action ───
// 契约:客户端枚举出的动作必须携带与引擎注册一致的 actionType(`transform:<牌名>`)与
// 产出牌名。旧实现只有一个无 transform 回调的 'transform' action,且 outputName 无人提供:
// 浏览器提交 {cardId} 缺声明牌名被拒,无头枚举直接跳过 → 两技能在任何真实客户端不可发动。
describe('多声明型转化技(界渐营/界矫诏)', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('界渐营:枚举出的「当杀」动作 actionType=transform:杀 且被引擎接受', async () => {
    const { state, actions } = await enumerateTransforms({
      players: [mkPlayer(0, 'P0', ['c1'], ['界渐营', '杀', '回合管理']), mkPlayer(1, 'P1', [], [])],
      cardMap: { c1: mkCard('c1', '闪', '♣', '7') },
      seat: 0,
    });
    const tf = actions.find((a) => a.message.skillId === '杀' && a.category === 'transform');
    expect(tf, '客户端应枚举出界渐营「当杀」转化').toBeDefined();
    expect(tf!.message.preceding![0].actionType).toBe('transform:杀');
    expect(tf!.message.params.cardId).toBe('c1#界渐营');

    const res = await dispatch(state, {
      ...tf!.message,
      params: { ...tf!.message.params, targets: tf!.validTargets.slice(0, 1) },
      ownerId: 0,
      baseSeq: state.seq,
    });
    expect(res.accepted, '客户端枚举的界渐营转化必须被引擎接受').toBe(true);
  });

  it('界矫诏:枚举出的「当无中生有」动作 actionType=transform:无中生有 且被引擎接受', async () => {
    const { state, actions } = await enumerateTransforms({
      players: [
        mkPlayer(0, 'P0', ['c1'], ['界矫诏', '无中生有', '回合管理']),
        mkPlayer(1, 'P1', [], []),
      ],
      cardMap: { c1: mkCard('c1', '闪', '♣', '7') },
      seat: 0,
    });
    const tf = actions.find((a) => a.category === 'transform' && a.message.skillId === '无中生有');
    expect(tf, '客户端应枚举出界矫诏「当无中生有」转化').toBeDefined();
    expect(tf!.message.preceding![0].actionType).toBe('transform:无中生有');
    expect(tf!.message.params.cardId).toBe('c1#界矫诏');

    const res = await dispatch(state, { ...tf!.message, ownerId: 0, baseSeq: state.seq });
    expect(res.accepted, '客户端枚举的界矫诏转化必须被引擎接受').toBe(true);
  });
});

// ─── 龙胆双向转化(杀↔闪)与 界武圣 的回应窗口 ───
// 契约:龙胆/界武圣 的每个方向都必须在对应窗口里枚举出动作且 dispatch 被接受:
//   (a) 出牌方向 闪→杀:主 action = 杀.use;杀→闪 不枚举(闪无主动 use 入口)。
//   (b) 询问闪窗口 杀→闪:主 action = 闪.respond,伤害被抵消。
//   (c) 询问杀窗口(决斗) 闪→杀:主 action = 杀.respond。
//   (d) 询问杀窗口(决斗) 界武圣红牌→杀:主 action = 杀.respond。
// 缺任一方向 = 该方向在无头/AI 客户端整类不可用(按钮消失 / 窗口里只能 skip)。
describe('龙胆双向与界武圣回应:客户端枚举 → 引擎 dispatch', () => {
  beforeEach(() => {
    clearRegistry();
  });

  /** 组装双人局(指定当前回合方)并完成引擎/前端注册,返回 state。 */
  async function setupState(
    players: PlayerState[],
    cardMap: Record<string, Card>,
    currentPlayerIndex: number,
  ): Promise<GameState> {
    const state = createGameState({
      players,
      cardMap,
      currentPlayerIndex,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    state.zones = { deck: [], discardPile: [], processing: [] };
    await registerSkillsFromState(state);
    clearRegistry();
    for (const p of state.players) await registerSkillActions(p.index, p.skills);
    return state;
  }

  it('龙胆(出牌方向):闪当杀枚举为 杀.use 被接受;杀当闪不枚举(闪无主动 use 入口)', async () => {
    const kill = mkCard('k1', '杀', '♠', '7');
    const dodge = mkCard('d1', '闪', '♥', '6');
    const { state, actions } = await enumerateTransforms({
      players: [mkPlayer(0, 'P0', ['k1', 'd1'], ['龙胆', '杀', '回合管理']), mkPlayer(1, 'P1', [], [])],
      cardMap: { k1: kill, d1: dodge },
      seat: 0,
    });

    const longdan = actions.filter((a) => a.message.preceding?.[0]?.skillId === '龙胆');
    // 手牌同时有 杀+闪:只有 闪→杀 方向被枚举;杀→闪 产出【闪】无主动 use 入口 → 跳过
    expect(longdan, '客户端应枚举出龙胆转化(且仅闪当杀方向)').toHaveLength(1);
    expect(longdan[0].message.skillId).toBe('杀');
    expect(longdan[0].message.actionType).toBe('use');
    expect(longdan[0].message.params.cardId).toBe('d1#龙胆');
    expect(
      actions.some((a) => a.message.skillId === '闪'),
      '杀当闪在出牌阶段不应枚举(引擎无对应 use action)',
    ).toBe(false);

    const res = await dispatch(state, {
      ...longdan[0].message,
      params: { ...longdan[0].message.params, targets: [1] },
      ownerId: 0,
      baseSeq: state.seq,
    });
    expect(res.accepted, '客户端枚举的龙胆闪当杀必须被引擎接受').toBe(true);
  });

  it('龙胆(回应方向):询问闪窗口中 杀当闪 respond 被接受,伤害被抵消', async () => {
    const kill = mkCard('k1', '杀', '♠', '7'); // P0 拿它当闪
    const slash = mkCard('s1', '杀', '♣', '5'); // P1 的实体杀
    const state = await setupState(
      [
        mkPlayer(0, 'P0', ['k1'], ['龙胆', '杀', '闪', '回合管理']),
        mkPlayer(1, 'P1', ['s1'], ['杀', '回合管理']),
      ],
      { k1: kill, s1: slash },
      1,
    );

    // P1 对 P0 使用杀 → P0 被询问闪
    const killUse = await dispatch(state, {
      skillId: '杀',
      actionType: 'use',
      ownerId: 1,
      params: { cardId: 's1', targets: [0] },
      baseSeq: state.seq,
    });
    expect(killUse.accepted, 'P1 的杀应被接受').toBe(true);
    await killUse.settle;

    const view = buildView(state, 0);
    expect((view.pending?.atom as { type?: string }).type).toBe('询问闪');
    const actions = enumerateAvailableActions(view, 0, getActionsForPlayer(0));
    const tf = actions.find((a) => a.category === 'transform' && a.message.skillId === '闪');
    expect(tf, '客户端应枚举出龙胆杀当闪回应').toBeDefined();
    expect(tf!.message.actionType).toBe('respond');
    expect(tf!.message.params.cardId).toBe('k1#龙胆');
    expect(tf!.message.preceding![0].skillId).toBe('龙胆');

    const res = await dispatch(state, { ...tf!.message, ownerId: 0, baseSeq: state.seq });
    expect(res.accepted, '客户端枚举的龙胆杀当闪必须被引擎接受').toBe(true);
    await res.settle;
    // 排空杀结算续跑的微任务后再断言体力
    await new Promise((r) => setTimeout(r, 0));
    expect(state.players[0].health, '杀被闪抵消,P0 不得掉血').toBe(4);
  });

  it('龙胆(被询问杀):决斗窗口中 闪当杀 respond 被接受', async () => {
    const dodge = mkCard('d1', '闪', '♥', '6');
    const duel = mkCard('du1', '决斗', '♣', '10');
    const state = await setupState(
      [
        mkPlayer(0, 'P0', ['d1'], ['龙胆', '杀', '闪', '回合管理']),
        mkPlayer(1, 'P1', ['du1'], ['决斗', '杀', '回合管理']),
      ],
      { d1: dodge, du1: duel },
      1,
    );

    // P1 对 P0 使用决斗 → P0 被询问杀
    const duelUse = await dispatch(state, {
      skillId: '决斗',
      actionType: 'use',
      ownerId: 1,
      params: { cardId: 'du1', targets: [0] },
      baseSeq: state.seq,
    });
    expect(duelUse.accepted, 'P1 的决斗应被接受').toBe(true);
    await duelUse.settle;

    const view = buildView(state, 0);
    expect((view.pending?.atom as { type?: string }).type).toBe('询问杀');
    const actions = enumerateAvailableActions(view, 0, getActionsForPlayer(0));
    const tf = actions.find((a) => a.category === 'transform' && a.message.skillId === '杀');
    expect(tf, '客户端应枚举出龙胆闪当杀回应').toBeDefined();
    expect(tf!.message.actionType).toBe('respond');
    expect(tf!.message.params.cardId).toBe('d1#龙胆');
    expect(tf!.message.preceding![0].skillId).toBe('龙胆');

    const res = await dispatch(state, { ...tf!.message, ownerId: 0, baseSeq: state.seq });
    expect(res.accepted, '客户端枚举的龙胆闪当杀必须被引擎接受').toBe(true);
  });

  it('界武圣(被询问杀):决斗窗口中 红牌当杀 respond 被接受', async () => {
    const red = mkCard('r1', '闪', '♥', '5');
    const duel = mkCard('du1', '决斗', '♣', '10');
    const state = await setupState(
      [
        mkPlayer(0, 'P0', ['r1'], ['界武圣', '杀', '回合管理']),
        mkPlayer(1, 'P1', ['du1'], ['决斗', '杀', '回合管理']),
      ],
      { r1: red, du1: duel },
      1,
    );

    const duelUse = await dispatch(state, {
      skillId: '决斗',
      actionType: 'use',
      ownerId: 1,
      params: { cardId: 'du1', targets: [0] },
      baseSeq: state.seq,
    });
    expect(duelUse.accepted, 'P1 的决斗应被接受').toBe(true);
    await duelUse.settle;

    const view = buildView(state, 0);
    expect((view.pending?.atom as { type?: string }).type).toBe('询问杀');
    const actions = enumerateAvailableActions(view, 0, getActionsForPlayer(0));
    const tf = actions.find(
      (a) => a.category === 'transform' && a.message.preceding?.[0]?.skillId === '界武圣',
    );
    expect(tf, '客户端应枚举出界武圣红牌当杀回应').toBeDefined();
    expect(tf!.message.skillId).toBe('杀');
    expect(tf!.message.actionType).toBe('respond');
    expect(tf!.message.params.cardId).toBe('r1#界武圣');

    const res = await dispatch(state, { ...tf!.message, ownerId: 0, baseSeq: state.seq });
    expect(res.accepted, '客户端枚举的界武圣红牌当杀必须被引擎接受').toBe(true);
  });
});
