// tests/skill-tests/乐不思蜀.test.ts
// 验证乐不思蜀延时锦囊:对目标判定区放入 + 判定阶段判定 + 跳过出牌阶段
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillTestHarness, fireTimeoutAndWait, waitForStable } from '../engine-harness';
import { applyAtom } from '../../src/engine/core/apply';
import { 判定 as 判定Atom } from '../../src/engine/atoms/判定';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import { suitColor } from '../../src/engine/types';
import type { Card, GameState } from '../../src/engine/types';

function makeCard(
  id: string,
  name: string,
  suit: '♠' | '♥' | '♣' | '♦',
  rank = 'A',
  type: '基本牌' | '锦囊牌' | '装备牌' = '锦囊牌',
): Card {
  return { id, name, suit, color: suitColor(suit), rank, type };
}

function makePlayer(opts: {
  index: number;
  name: string;
  hand?: string[];
  skills?: string[];
  pendingTricks?: Array<{ name: string; source: number; card: Card }>;
}) {
  return {
    index: opts.index,
    name: opts.name,
    character: '主公',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: opts.hand ?? [],
    equipment: {},
    skills: opts.skills ?? [],
    vars: {},
    marks: [],
    pendingTricks: opts.pendingTricks ?? [],
    judgeZone: [],
    tags: [],
  };
}

describe('乐不思蜀', () => {
  let harness: SkillTestHarness;

  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  it('use action:对目标放置 乐不思蜀 延时锦囊', async () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['l1'], skills: ['乐不思蜀', '回合管理'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: { l1: card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    await P1.triggerAction('乐不思蜀', 'use', { cardId: 'l1', target: 1 });

    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[1].pendingTricks[0].name).toBe('乐不思蜀');
    expect(harness.state.players[1].pendingTricks[0].source).toBe(0);
    expect(harness.state.zones.discardPile).toContain('l1');
  });

  // 目标合法性(canUseIndulgence 负面路径):不能对自己使用、判定区已有同名延时锦囊时拒绝。
  it('canUse:对自己使用被拒绝(延时锦囊不置入判定区,手牌不消耗)', async () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['l1'], skills: ['回合管理'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: { l1: card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '乐不思蜀',
      actionType: 'use',
      params: { cardId: 'l1', target: 0 },
    });
    // 被拒绝:延时锦囊未置入、手牌仍在
    expect(harness.state.players[0].pendingTricks.length).toBe(0);
    expect(harness.state.players[0].hand).toContain('l1');
  });

  it('canUse:目标判定区已有乐不思蜀 → 拒绝(不可叠加)', async () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['l1'], skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card }],
        }),
      ],
      cardMap: { l1: card },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
    });
    await harness.setup(state);

    const P1 = harness.player('P1');
    await P1.expectRejected({
      skillId: '乐不思蜀',
      actionType: 'use',
      params: { cardId: 'l1', target: 1 },
    });
    // 被拒绝:判定区仍只有 1 张,使用者手牌未消耗
    expect(harness.state.players[1].pendingTricks.length).toBe(1);
    expect(harness.state.players[0].hand).toContain('l1');
  });

  it('判定为红桃:移除延时锦囊,不加跳过标签', async () => {
    // 牌堆顶设为红桃 → 判定牌为 ♥ → 乐不思蜀无效
    const card = makeCard('l1', '乐不思蜀', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['乐不思蜀', '回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card }],
        }),
      ],
      cardMap: { l1: card, j1: judgeCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    // 把判定牌放到牌堆顶(牌堆数组头部 = 顶)
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    // 触发 阶段开始 判定 之前先注册 P2 的技能实例(loadFrontend 已做)
    // 模拟 P2 的回合进入判定阶段:发 阶段开始 判定 atom
    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口

    // 红桃 → 仅移除延时锦囊,不加跳过出牌标签
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    const hasSkipTag = harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌');
    expect(hasSkipTag).toBe(false);
  });

  it('判定为黑桃:加跳过出牌标签,移除延时锦囊', async () => {
    // 牌堆顶设为黑桃 → 判定牌为 ♠ → 乐不思蜀生效
    const card = makeCard('l1', '乐不思蜀', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['乐不思蜀', '回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card }],
        }),
      ],
      cardMap: { l1: card, j1: judgeCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口

    // 黑桃 → 移除延时锦囊 + 加跳过出牌标签
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    const hasSkipTag = harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌');
    expect(hasSkipTag).toBe(true);
  });

  it('判定后 + 出牌阶段开始 → cancel 出牌阶段,标签清除', async () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5');
    // P2 手牌 5 张 > 体力 4:出牌被跳过后弃牌阶段产生 discard pending(阻塞级联),
    // 便于在弃牌阶段断言中间状态(弃牌完成后才自动推进到回合结束)
    const d1 = makeCard('d1', '杀', '♠', '8', '基本牌');
    const d2 = makeCard('d2', '杀', '♠', '9', '基本牌');
    const d3 = makeCard('d3', '杀', '♠', '2', '基本牌');
    const d4 = makeCard('d4', '杀', '♣', '3', '基本牌');
    const d5 = makeCard('d5', '杀', '♣', '4', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          hand: [d1.id, d2.id, d3.id, d4.id, d5.id],
          skills: ['乐不思蜀', '回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card }],
        }),
      ],
      cardMap: { l1: card, j1: judgeCard, d1, d2, d3, d4, d5 },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    // 阶段开始 判定 → 触发 判定 → 加跳过标签
    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await fireTimeoutAndWait(harness.state); // 消耗无懈窗口
    const hasSkipTagBefore = harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌');
    expect(hasSkipTagBefore).toBe(true);

    // 进入出牌阶段 → SKIP_TAG 命中 → 出牌被 cancel → 弃牌阶段(discard pending 阻塞)
    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '出牌' });
    await waitForStable(harness.state);

    // 出牌阶段被 cancel:state.phase 应已推进到 弃牌(因内部触发了 阶段结束 出牌)
    expect(harness.state.phase).toBe('弃牌');
    // 标签应已清除
    const hasSkipTagAfter = harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌');
    expect(hasSkipTagAfter).toBe(false);
  });

  it('判定事件携带待判定牌牌面(延时锦囊判定)', () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card }],
        }),
      ],
      cardMap: { l1: card, j1: judgeCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };

    // toViewEvents 在 apply 之前调用:牌堆顶为判定结果,判定区延时锦囊为待判定牌
    const split = 判定Atom.toViewEvents!(state, { player: 1, judgeType: '乐不思蜀' })!;
    const view = split.othersView!;
    expect(view.card).toMatchObject({ name: '判定牌', suit: '♥', rank: '5' });
    expect(view.pendingCard).toMatchObject({ name: '乐不思蜀', suit: '♠', rank: 'A' });
  });

  it('技能判定(判定区无同名牌)不携带待判定牌', () => {
    const judgeCard = makeCard('j1', '判定牌', '♥', '5');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', skills: ['回合管理'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: { j1: judgeCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };

    const split = 判定Atom.toViewEvents!(state, { player: 1, judgeType: '八卦阵' })!;
    const view = split.othersView!;
    expect(view.card).toMatchObject({ name: '判定牌', suit: '♥', rank: '5' });
    expect(view.pendingCard).toBeUndefined();
  });

  // 与闪电对照：乐不思蜀被无懈可击抵消 → 弃置（移除），不传递给下家、不判定、不加跳过标签。
  // 延时锦囊默认无 onCancelled，钩子走「移除延时锦囊」分支；仅闪电声明 onCancelled 以传递。
  it('判定前打出无懈可击 → 乐不思蜀被抵消,移除不传递不判定', async () => {
    const card = makeCard('l1', '乐不思蜀', '♠');
    const judgeCard = makeCard('j1', '判定牌', '♠', '5'); // 若判定将生效（跳过出牌）
    const nullifCard = makeCard('wx1', '无懈可击', '♠', 'J');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          hand: ['wx1'],
          skills: ['无懈可击', '回合管理'],
        }),
        makePlayer({
          index: 1,
          name: 'P2',
          skills: ['乐不思蜀', '回合管理'],
          pendingTricks: [{ name: '乐不思蜀', source: 0, card }],
        }),
      ],
      cardMap: { l1: card, j1: judgeCard, wx1: nullifCard },
      currentPlayerIndex: 1,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
    });
    state.zones = { deck: ['j1'], discardPile: [], processing: [] };
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 1, phase: '判定' });
    await waitForStable(harness.state); // 等到无懈 pending
    await harness.player('P1').respond('无懈可击', { cardId: 'wx1' });
    await waitForStable(harness.state); // 反无懈窗口
    if (harness.state.pendingSlots.size > 0) {
      await fireTimeoutAndWait(harness.state); // 消耗反无懈窗口
    }

    // 乐不思蜀被抵消：从判定区移除（弃置），未判定、未加跳过标签
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
    expect(harness.state.players[1].tags?.includes('乐不思蜀/跳过出牌')).toBe(false);
    // 判定牌未被翻动（仍在牌堆）
    expect(harness.state.zones.deck).toContain('j1');
    // 无传递给 P1（默认行为是弃置，非闪电式传递）
    expect(harness.state.players[0].pendingTricks.length).toBe(0);
    // 无懈牌进弃牌堆
    expect(harness.state.zones.discardPile).toContain('wx1');
  });

  // 判定区手动堆叠两个同名乐不思蜀(正常对局 canUse 拒绝叠加)→ 一次判定按 name 全部移除
  // (移除延时锦囊以 name 过滤),SKIP_TAG 只生效一次
  it('判定区两个乐不思蜀(手动堆叠)→ 一次判定同名延时锦囊全部移除,SKIP_TAG 只生效一次', async () => {
    const lb1 = makeCard('lb1', '乐不思蜀', '♠', '3');
    const lb2 = makeCard('lb2', '乐不思蜀', '♠', '4');
    const judgeCard = makeCard('jd1', '杀', '♠', '7', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          skills: ['乐不思蜀'],
          pendingTricks: [
            { name: '乐不思蜀', source: 1, card: lb1 },
            { name: '乐不思蜀', source: 1, card: lb2 },
          ],
        }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: { lb1, lb2, jd1: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await harness.setup(state);
    expect(harness.state.players[0].pendingTricks.length).toBe(2);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    await waitForStable(harness.state);
    await fireTimeoutAndWait(harness.state);

    // 移除延时锦囊按 name 过滤 → 两个同名延时锦囊一次性全部移除
    expect(harness.state.players[0].pendingTricks.length).toBe(0);
    expect(harness.state.players[0].tags?.includes('乐不思蜀/跳过出牌')).toBe(true);

    // 出牌阶段被 cancel 后 SKIP_TAG 清除,不残留到下一回合
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await waitForStable(harness.state);
    expect(harness.state.players[0].tags?.includes('乐不思蜀/跳过出牌')).toBe(false);
  });

  // 判定区同时有 乐不思蜀 + 闪电 → 判定阶段逐个结算,最后置入的(闪电)先结算
  // 回归:旧实现只 find 第一个 + 单次结算,闪电不会被结算
  it('判定区有乐不思蜀+闪电 → 两者都被结算,最后置入的闪电先结算', async () => {
    const lb = makeCard('lb1', '乐不思蜀', '♠', '3');
    const sd = makeCard('sd1', '闪电', '♠', 'A');
    // 牌堆顶 jd1 → 闪电(最后置入先结算)→ ♠K 非命中 → 传给 P2
    const judgeForLightning = makeCard('jd1', '杀', '♠', 'K', '基本牌');
    // jd2 → 乐不思蜀 → ♠5 非♥ → 加 SKIP_TAG
    const judgeForIndulgence = makeCard('jd2', '杀', '♠', '5', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({
          index: 0,
          name: 'P1',
          skills: ['乐不思蜀'],
          // pendingTricks 按置入顺序:乐不思蜀先,闪电最后置入
          pendingTricks: [
            { name: '乐不思蜀', source: 1, card: lb },
            { name: '闪电', source: 1, card: sd },
          ],
        }),
        makePlayer({ index: 1, name: 'P2', skills: [] }),
      ],
      cardMap: {
        lb1: lb,
        sd1: sd,
        jd1: judgeForLightning,
        jd2: judgeForIndulgence,
      },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeForLightning.id, judgeForIndulgence.id], discardPile: [], processing: [] },
    });
    await harness.setup(state);

    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });
    // 两个延时锦囊各开一个无懈窗口 → 逐个消耗
    await waitForStable(harness.state);
    await fireTimeoutAndWait(harness.state); // 闪电的无懈窗口
    await waitForStable(harness.state);
    await fireTimeoutAndWait(harness.state); // 乐不思蜀的无懈窗口

    // 两者都被结算:P1 判定区清空
    expect(harness.state.players[0].pendingTricks.find((t) => t.name === '乐不思蜀')).toBeUndefined();
    expect(harness.state.players[0].pendingTricks.find((t) => t.name === '闪电')).toBeUndefined();
    // 闪电(最后置入)先结算 → ♠K 非命中 → 传给 P2
    expect(harness.state.players[1].pendingTricks.find((t) => t.name === '闪电')).toBeDefined();
    // 乐不思蜀后结算 → ♠5 非♥ → 加 SKIP_TAG
    expect(harness.state.players[0].tags?.includes('乐不思蜀/跳过出牌')).toBe(true);
    // 两张判定牌均进弃牌堆
    expect(harness.state.zones.discardPile).toContain(judgeForLightning.id);
    expect(harness.state.zones.discardPile).toContain(judgeForIndulgence.id);
  });

  // use validate:乐不思蜀 只能在出牌阶段使用,摸牌阶段使用被拒绝
  it('use validate:非出牌阶段(摸牌)使用乐不思蜀 → 被拒绝', async () => {
    const lb = makeCard('lb1', '乐不思蜀', '♠', '3');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['lb1'], skills: ['乐不思蜀'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['杀'] }),
      ],
      cardMap: { lb1: lb },
      currentPlayerIndex: 0,
      phase: '摸牌',
      turn: { round: 1, phase: '摸牌', vars: {} },
    });
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 摸牌阶段用 乐不思蜀 → 应被拒绝
    await P1.expectRejected({
      skillId: '乐不思蜀',
      actionType: 'use',
      params: { cardId: 'lb1', target: 1 },
    });
    // P2 判定区应为空(没真出)
    expect(harness.state.players[1].pendingTricks.length).toBe(0);
  });

  // 判定区无乐不思蜀 → 判定阶段钩子不触发:牌堆不动、不加 SKIP_TAG
  it('判定区无乐不思蜀 → 判定阶段钩子不触发,牌堆不动', async () => {
    const judgeCard = makeCard('jd1', '杀', '♠', '7', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: [], skills: ['乐不思蜀'] }),
        makePlayer({ index: 1, name: 'P2', hand: [], skills: [] }),
      ],
      cardMap: { jd1: judgeCard },
      currentPlayerIndex: 0,
      phase: '判定',
      turn: { round: 1, phase: '判定', vars: {} },
      zones: { deck: [judgeCard.id], discardPile: [], processing: [] },
    });
    await harness.setup(state);

    // 触发 阶段开始 判定 → 钩子看到判定区无 乐不思蜀 → 跳过
    await applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '判定' });

    // 牌堆未动(钩子没 apply 判定 atom)
    expect(harness.state.zones.deck).toContain(judgeCard.id);
    expect(harness.state.zones.discardPile).not.toContain(judgeCard.id);
    expect(harness.state.players[0].tags?.includes('乐不思蜀/跳过出牌')).toBe(false);
  });

  // 回归:出牌被乐不思蜀跳过(无出牌窗口、无人点 end)→ 弃牌阶段完成后应推进到下家回合,
  // 不死锁在弃牌阶段。旧 bug:弃牌阶段不自动推进,完全依赖 end action / 出牌窗口超时
  it('出牌被乐不思蜀跳过 → 弃牌完成后推进到下家回合(不死锁)', async () => {
    const c1 = makeCard('c1', '杀', '♠', '5', '基本牌');
    const c2 = makeCard('c2', '闪', '♥', '6', '基本牌');
    const c3 = makeCard('c3', '桃', '♥', '7', '基本牌');
    // 牌堆补充:下家摸牌阶段需抽 2 张
    const d1 = makeCard('d1', '杀', '♠', '8', '基本牌');
    const d2 = makeCard('d2', '闪', '♥', '9', '基本牌');
    const state: GameState = createGameState({
      players: [
        makePlayer({ index: 0, name: 'P1', hand: ['c1', 'c2', 'c3'], skills: ['回合管理'] }),
        makePlayer({ index: 1, name: 'P2', skills: ['回合管理'] }),
      ],
      cardMap: { c1, c2, c3, d1, d2 },
      currentPlayerIndex: 0,
      phase: '出牌',
      turn: { round: 1, phase: '出牌', vars: {} },
      zones: { deck: ['d1', 'd2'], discardPile: [], processing: [] },
    });
    // P1 已被乐不思蜀判定(非♥),带跳过出牌标签;体力 2 但手牌 3 → 弃牌阶段需弃 1 张
    state.players[0].health = 2;
    state.players[0].maxHealth = 2;
    state.players[0].tags = ['乐不思蜀/跳过出牌'];
    await harness.setup(state);
    const P1 = harness.player('P1');

    // 触发出牌阶段开始 → 标签命中 → 跳过出牌 → 进入弃牌阶段
    void applyAtom(harness.state, { type: '阶段开始', player: 0, phase: '出牌' });
    await waitForStable(harness.state);

    // 弃牌 pending 应已产生:手牌 3 > 体力 2,需弃 1 张
    const discardSlot = [...harness.state.pendingSlots.values()].find(
      (s) => (s.atom as { requestType?: string }).requestType === '__弃牌',
    );
    expect(discardSlot, '出牌被跳过后应进入弃牌阶段产生 __弃牌 pending').toBeDefined();

    // P1 弃 1 张
    await P1.respond('系统规则', { cardIds: ['c1'] });
    await waitForStable(harness.state);

    // 回归断言:弃牌完成后回合推进到下家(P2),不死锁在弃牌阶段
    expect(harness.state.currentPlayerIndex, '弃牌后应推进到下家回合').toBe(1);
  });
});
