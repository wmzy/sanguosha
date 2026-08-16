// 朱雀羽扇(武器,范围 4)技能测试:
//   你可以将一张普通杀当火杀使用或打出。
//
// 模型(组合 action):preceding=[朱雀羽扇.transform] + 主 action=杀.use
//   transform:普通杀 → 影子卡(name='杀', damageType='火焰'),手牌中原卡 id 替换为影子 id
//
// 验证:
//   1. transformThenUse:普通杀 → 火杀影子 → 杀成功,P2 扣血,伤害为火焰属性
//   2. transform 后 cardMap 有火杀影子(damageType='火焰')
//   3. 负面:火杀 transform 被拒(已是火杀)
//   4. 负面:雷杀 transform 被拒(非普通杀)
//   5. 负面:非自己回合 transform 被拒
//   6. rollback:transform 后 杀.use 失败(无目标)→ 原卡还原
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness } from '../engine-harness';
import '../../src/engine/atoms';
import { createGameState, suitColor } from '../../src/engine/types';
import type { Card, GameState, DamageType, Json, PlayerState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '基本牌',
  damageType?: DamageType,
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type, ...(damageType ? { damageType } : {}) };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  equipment?: Record<string, string>;
  skills?: string[];
  health?: number;
  vars?: Record<string, unknown>;
}): PlayerState {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: opts.health ?? 4,
    maxHealth: opts.health ?? 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: opts.equipment ?? {},
    skills: opts.skills ?? [],
    vars: (opts.vars ?? {}) as Record<string, Json>,
    marks: [],
    pendingTricks: [],
    tags: [],
    judgeZone: [],
  };
}

/** 造一把朱雀羽扇武器卡 */
function makeFan(): Card {
  return {
    id: 'wp-fan',
    name: '朱雀羽扇',
    suit: '♦',
    color: '红',
    rank: 'A',
    type: '装备牌',
    subtype: '武器',
    range: 4,
  };
}

describe('朱雀羽扇:普通杀可当火杀使用', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // ─── 1. 正面:普通杀 transformThenUse 火杀 ──────────────────
  it('transformThenUse:普通杀当火杀 → 创建火杀影子 + 杀成功 + 火焰伤害', async () => {
    const fan = makeFan();
    const slash = makeCard('k1', '杀', '♠', '7'); // 普通杀(无 damageType)
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          equipment: { 武器: fan.id },
          skills: ['杀', '装备通用', '朱雀羽扇'],
          vars: { '距离/出杀范围': 4 },
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [fan.id]: fan, [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p1HealthBefore = harness.state.players[1].health;

    // 转化:普通杀当火杀(影子 id='k1#朱雀羽扇')
    await P0.transformThenUse('朱雀羽扇', { cardId: 'k1' }, '杀', {
      cardId: 'k1#朱雀羽扇',
      targets: [1],
    });
    await P1.pass(); // 不出闪

    // P1 扣1血(火杀基础伤害1)
    expect(harness.state.players[1].health).toBe(p1HealthBefore - 1);
    // 杀进入弃牌堆(影子最终还原为原卡 k1)
    expect(harness.state.zones.discardPile).toContain('k1');
  });

  // ─── 2. 验证影子卡是火杀(damageType='火焰') ─────────────────
  it('transform 后 cardMap 有火杀影子(name=杀, damageType=火焰)', async () => {
    const fan = makeFan();
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          equipment: { 武器: fan.id },
          skills: ['杀', '装备通用', '朱雀羽扇'],
          vars: { '距离/出杀范围': 4 },
        }),
        makePlayer({ index: 1, name: 'P1', hand: [], skills: ['闪'] }),
      ],
      cardMap: { [fan.id]: fan, [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // 仅执行 transform(不执行主 use),验证影子卡已创建
    await P0.triggerAction('朱雀羽扇', 'transform', { cardId: 'k1' });

    const shadow = harness.state.cardMap['k1#朱雀羽扇'];
    expect(shadow).toBeDefined();
    expect(shadow.name).toBe('杀');
    expect(shadow.damageType).toBe('火焰');
    expect(shadow.shadowOf).toBe('k1');
    // 手牌中原卡已替换为影子
    expect(harness.state.players[0].hand).toContain('k1#朱雀羽扇');
    expect(harness.state.players[0].hand).not.toContain('k1');
  });

  // ─── 3. 负面:火杀不能转化(已是火杀) ───────────────────────
  it('transform:火杀 → 拒绝(已是火杀)', async () => {
    const fan = makeFan();
    const fireSlash = makeCard('k1', '杀', '♥', '4', '基本牌', '火焰'); // 火杀
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [fireSlash.id],
          equipment: { 武器: fan.id },
          skills: ['杀', '装备通用', '朱雀羽扇'],
          vars: { '距离/出杀范围': 4 },
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'] }),
      ],
      cardMap: { [fan.id]: fan, [fireSlash.id]: fireSlash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '朱雀羽扇',
      actionType: 'transform',
      params: { cardId: 'k1' },
    });
  });

  // ─── 4. 负面:雷杀不能转化(非普通杀) ───────────────────────
  it('transform:雷杀 → 拒绝(非普通杀)', async () => {
    const fan = makeFan();
    const thunderSlash = makeCard('k1', '杀', '♣', '5', '基本牌', '雷电'); // 雷杀
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [thunderSlash.id],
          equipment: { 武器: fan.id },
          skills: ['杀', '装备通用', '朱雀羽扇'],
          vars: { '距离/出杀范围': 4 },
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'] }),
      ],
      cardMap: { [fan.id]: fan, [thunderSlash.id]: thunderSlash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '朱雀羽扇',
      actionType: 'transform',
      params: { cardId: 'k1' },
    });
  });

  // ─── 5. 负面:非自己回合 transform 被拒 ──────────────────────
  it('transform:非自己回合 → 拒绝', async () => {
    const fan = makeFan();
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          equipment: { 武器: fan.id },
          skills: ['杀', '装备通用', '朱雀羽扇'],
          vars: { '距离/出杀范围': 4 },
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'] }),
      ],
      cardMap: { [fan.id]: fan, [slash.id]: slash },
      currentPlayerIndex: 1, // P1 回合,不是 P0
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    await P0.expectRejected({
      skillId: '朱雀羽扇',
      actionType: 'transform',
      params: { cardId: 'k1' },
    });
  });

  // ─── 6. rollback:transform 后 杀.use 失败 → 原卡还原 ──────
  it('rollback:转化后杀.use 失败(无目标)→ 原卡还原,影子删除', async () => {
    const fan = makeFan();
    const slash = makeCard('k1', '杀', '♠', '7');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          equipment: { 武器: fan.id },
          skills: ['杀', '装备通用', '朱雀羽扇'],
          vars: { '距离/出杀范围': 4 },
        }),
        makePlayer({ index: 1, name: 'P1', skills: ['闪'] }),
      ],
      cardMap: { [fan.id]: fan, [slash.id]: slash },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    // preceding transform 成功(创建影子),主 action 杀.use 用非法 cardId →
    // validate 拒绝 → rollback 朱雀羽扇 transform
    await P0.expectRejected({
      skillId: '杀',
      actionType: 'use',
      params: { cardId: 'wrong-id', targets: [1] },
      preceding: [{ skillId: '朱雀羽扇', actionType: 'transform', params: { cardId: 'k1' } }],
    });

    // 状态完全还原:k1 仍是普通杀,影子不存在,手牌仍是 k1
    expect(harness.state.cardMap['k1#朱雀羽扇']).toBeUndefined();
    expect(harness.state.players[0].hand).toContain('k1');
  });

  // ─── 7. 使用时询问(主路径):直接用普通杀 → confirm → 发动 → 火杀 ───
  // 藤甲为判别器:普通杀对藤甲无效(0 伤害);火杀穿透且火焰伤害+1(共 2 点)。
  // 同时验证:牌入弃牌堆后原属性还原(牌堆真源不被污染)。
  it('使用时询问:直接用普通杀 → 弹confirm → 发动 → 火焰伤害穿透藤甲+1,结算后属性还原', async () => {
    const fan = makeFan();
    const slash = makeCard('k1', '杀', '♠', '7'); // 普通杀
    const tengjia: Card = {
      id: 'tj',
      name: '藤甲',
      suit: '♠',
      color: '黑',
      rank: '2',
      type: '装备牌',
      subtype: '防具',
    };
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          equipment: { 武器: fan.id },
          skills: ['杀', '装备通用', '朱雀羽扇'],
          vars: { '距离/出杀范围': 4 },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          equipment: { 防具: tengjia.id },
          skills: ['闪', '藤甲'],
        }),
      ],
      cardMap: { [fan.id]: fan, [slash.id]: slash, [tengjia.id]: tengjia },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');
    const P1 = harness.player('P1');

    const p1HealthBefore = harness.state.players[1].health;

    await P0.useCardAndTarget('杀', 'k1', [1]);

    // 使用时询问已弹出(P0 自己的 confirm 槽)
    const slot = harness.state.pendingSlots.get(0);
    expect(slot?.atom.type).toBe('请求回应');
    expect((slot?.atom as { requestType?: string }).requestType).toBe('朱雀羽扇/confirm');
    // 视图层:该询问对 P0 可见(confirm 弹窗,前端 AwaitingPrompt 据此渲染"发动/不发动")
    P0.processEvents();
    P0.expectView((v) => {
      expect(v.pending).not.toBeNull();
      expect(v.pending?.prompt.type).toBe('confirm');
      expect(String(v.pending?.prompt.title)).toContain('朱雀羽扇');
    });

    await P0.respond('朱雀羽扇', { choice: true }); // 发动 → 火杀

    // 火杀穿透藤甲(检测有效性不再 cancel)+ 火焰伤害+1 → 共 2 点
    expect(harness.state.players[1].health).toBe(p1HealthBefore - 2);
    // 杀进入弃牌堆,且原属性已还原(不再是火焰)
    expect(harness.state.zones.discardPile).toContain('k1');
    expect(harness.state.cardMap['k1'].damageType).toBeUndefined();
    expect(harness.state.pendingSlots.size).toBe(0);
    // view 级断言
    P1.processEvents();
    P1.expectView((v) => {
      expect(v.players[1].health).toBe(p1HealthBefore - 2);
      expect(v.pending).toBeNull();
    });
  });

  // ─── 8. 使用时询问:不发动 → 保持普通杀(藤甲无效化,0 伤害)───
  it('使用时询问:confirm 不发动 → 普通杀被藤甲无效,0 伤害,属性不变', async () => {
    const fan = makeFan();
    const slash = makeCard('k1', '杀', '♠', '7');
    const tengjia: Card = {
      id: 'tj',
      name: '藤甲',
      suit: '♠',
      color: '黑',
      rank: '2',
      type: '装备牌',
      subtype: '防具',
    };
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [slash.id],
          equipment: { 武器: fan.id },
          skills: ['杀', '装备通用', '朱雀羽扇'],
          vars: { '距离/出杀范围': 4 },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          equipment: { 防具: tengjia.id },
          skills: ['闪', '藤甲'],
        }),
      ],
      cardMap: { [fan.id]: fan, [slash.id]: slash, [tengjia.id]: tengjia },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    const p1HealthBefore = harness.state.players[1].health;

    await P0.useCardAndTarget('杀', 'k1', [1]);
    await P0.respond('朱雀羽扇', { choice: false }); // 不发动

    // 普通杀对藤甲无效:0 伤害
    expect(harness.state.players[1].health).toBe(p1HealthBefore);
    expect(harness.state.cardMap['k1'].damageType).toBeUndefined();
    expect(harness.state.zones.discardPile).toContain('k1');
    expect(harness.state.pendingSlots.size).toBe(0);
  });

  // ─── 9. 使用时询问:真实火杀(非普通杀)不弹询问 ───────────────
  it('使用时询问:直接用火杀 → 不弹朱雀羽扇confirm(仅藤甲+1 结算)', async () => {
    const fan = makeFan();
    const fireSlash = makeCard('k1', '杀', '♠', '7', '基本牌', '火焰');
    const tengjia: Card = {
      id: 'tj',
      name: '藤甲',
      suit: '♠',
      color: '黑',
      rank: '2',
      type: '装备牌',
      subtype: '防具',
    };
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P0',
          hand: [fireSlash.id],
          equipment: { 武器: fan.id },
          skills: ['杀', '装备通用', '朱雀羽扇'],
          vars: { '距离/出杀范围': 4 },
        }),
        makePlayer({
          index: 1,
          name: 'P1',
          hand: [],
          equipment: { 防具: tengjia.id },
          skills: ['闪', '藤甲'],
        }),
      ],
      cardMap: { [fan.id]: fan, [fireSlash.id]: fireSlash, [tengjia.id]: tengjia },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);
    const P0 = harness.player('P0');

    const p1HealthBefore = harness.state.players[1].health;

    // 无 confirm 询问 → 流程不阻塞,直接结算完成(P1 空手,询问闪自动跳过)
    await P0.useCardAndTarget('杀', 'k1', [1]);

    expect(harness.state.pendingSlots.size).toBe(0); // 未弹朱雀羽扇询问
    expect(harness.state.players[1].health).toBe(p1HealthBefore - 2); // 火杀 vs 藤甲 = 2
  });
});
