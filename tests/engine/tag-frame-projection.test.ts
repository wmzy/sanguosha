import { describe, expect, it } from 'vitest';
import { viewReducer } from '../../src/client/view/reducer';
import { applyAtom } from '../../src/engine/core/apply';
import { popFrame, pushFrame, setFrameCancelled } from '../../src/engine/core/frame';
import { registerAfterHook, registerBeforeHook } from '../../src/engine/core/skill';
import { buildView } from '../../src/engine/view/buildView';
import { createGameState, type Card, type GameState, type Json } from '../../src/engine/types';
import { runUseFlow, registerDelayedTrickHooks } from '../../src/engine/skills/cards/use-card';
import { createSkill as createLijun, onInit as initLijun } from '../../src/engine/skills/立军';
import { createSkill as createShicai, onInit as initShicai } from '../../src/engine/skills/恃才';
import { createSkill as createWansha, onInit as initWansha } from '../../src/engine/skills/界完杀';
import { assertViewConsistency, SkillTestHarness } from '../engine-harness';

function makeState(): GameState {
  const cards: Card[] = [
    { id: 'slash', name: '杀', type: '基本牌', suit: '♠', color: '黑', rank: '7' },
    { id: 'dodge', name: '闪', type: '基本牌', suit: '♥', color: '红', rank: '2' },
    { id: 'nullify', name: '无懈可击', type: '锦囊牌', suit: '♠', color: '黑', rank: 'J' },
  ];
  return createGameState({
    players: [0, 1, 2].map((index) => ({
      index, name: `P${index}`, character: '', faction: '吴' as const,
      health: 4, maxHealth: 4, alive: true, hand: [], equipment: {},
      pendingTricks: [], skills: [], vars: {}, marks: [], tags: [],
    })),
    cardMap: Object.fromEntries(cards.map((card) => [card.id, card])),
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

/** 重放实际缓存事件;经 wire 序列化隔离事件与增量视图的嵌套引用。 */
function trackProjection(state: GameState) {
  const views = state.players.map((player) => buildView(state, player.index));
  let cursor = state.atomHistory.length;
  return {
    views,
    flush() {
      for (const entry of state.atomHistory.slice(cursor)) {
        if (entry.kind !== 'atom') continue;
        for (const view of views) {
          const split = entry.viewEvents;
          const event = split.ownerViews.has(view.viewer)
            ? split.ownerViews.get(view.viewer)
            : split.othersView;
          if (event) viewReducer(view, JSON.parse(JSON.stringify(event)), entry.timestamp);
        }
      }
      cursor = state.atomHistory.length;
      for (const view of views) assertViewConsistency(view, state, view.viewer);
    },
  };
}

describe('标签与结算帧真实 atom 增量投影', () => {
  it('加标签幂等、去标签保持其它标签和顺序,所有视角一致', async () => {
    const state = makeState();
    const projection = trackProjection(state);
    for (const tag of ['义绝/禁出牌', '义绝/非锁定技失效', '义绝/禁出牌']) {
      await applyAtom(state, { type: '加标签', player: 1, tag });
      projection.flush();
    }
    expect(state.players[1].tags).toEqual(['义绝/禁出牌', '义绝/非锁定技失效']);
    await applyAtom(state, { type: '去标签', player: 1, tag: '义绝/禁出牌' });
    projection.flush();
    expect(projection.views[2].players[1].tags).toEqual(['义绝/非锁定技失效']);
    await applyAtom(state, { type: '去标签', player: 1, tag: '不存在' });
    projection.flush();
  });

  it('界完杀的濒死期动态标签经加/去标签同步并在救活后清理', async () => {
    const state = makeState();
    state.players[1].health = 0;
    initWansha(createWansha('界完杀', 0), state);
    const projection = trackProjection(state);
    await applyAtom(state, { type: '陷入濒死', target: 1 });
    projection.flush();
    expect(projection.views[1].players[2].tags).toEqual(['完杀/非锁定技失效']);
    await applyAtom(state, { type: '回复体力', target: 1, amount: 1 });
    projection.flush();
    expect(state.players[2].tags).toEqual([]);
  });

  it.each([
    ['乐不思蜀/跳过出牌', '出牌'],
    ['兵粮寸断/跳过摸牌', '摸牌'],
  ])('%s 在跳过阶段时通过真实去标签事件清理', async (tag, phase) => {
    const state = makeState();
    // 阶段在初始化时即为目标阶段:取消的「阶段开始」不会产生 view 事件,
    // 若在 trackProjection 之后再手改 state.phase,增量视图必然落后于 buildView。
    state.phase = phase as GameState['phase'];
    state.turn.phase = phase as GameState['phase'];
    registerDelayedTrickHooks(state);
    const projection = trackProjection(state);
    await applyAtom(state, { type: '加标签', player: 1, tag });
    projection.flush();
    expect(await applyAtom(state, { type: '阶段开始', player: 1, phase })).toBe(false);
    projection.flush();
    expect(state.players[1].tags).toEqual([]);
    expect(state.atomHistory.some((entry) => entry.kind === 'atom' && entry.atom.type === '去标签')).toBe(true);
  });

  it('入栈和参数赋值按值投影,旧事件不会随嵌套数组的后续修改变形', async () => {
    const state = makeState();
    const projection = trackProjection(state);
    const targets: Json[] = [1, { candidates: [2] }];
    const frame = await pushFrame(state, '杀', 0, { targets });
    const pushed = state.atomHistory.find((entry) => entry.kind === 'atom' && entry.atom.type === '结算帧入栈')!;
    targets.push(2);
    expect(frame.params.targets).toEqual([1, { candidates: [2] }]);
    projection.flush();
    const value: Json = { cards: ['slash'], nested: { targets: [1] } };
    await applyAtom(state, { type: '帧参数赋值', key: 'selection', value });
    projection.flush();
    (value as { cards: string[] }).cards.push('dodge');
    expect(frame.params.selection).toEqual({ cards: ['slash'], nested: { targets: [1] } });
    expect(pushed.kind === 'atom' && pushed.viewEvents.othersView?.params).toEqual({ targets: [1, { candidates: [2] }] });
    projection.flush();
  });

  it('父帧参数更新定位实际帧,子帧保持独立', async () => {
    const state = makeState();
    const projection = trackProjection(state);
    const parent = await pushFrame(state, '杀', 0, { resolvedTargets: [1] });
    await pushFrame(state, '流离', 1, { resolvedTargets: [0] });
    await applyAtom(state, {
      type: '帧参数赋值', frameIndex: state.settlementStack.indexOf(parent),
      key: 'resolvedTargets', value: [2],
    });
    projection.flush();
    expect(projection.views[1].settlementStack.map((frame) => frame.params.resolvedTargets)).toEqual([[2], [0]]);
  });

  it.each(['闪', '无懈可击'])('%s 嵌套结算只抵消父帧,清除/重复抵消也同步', async (name) => {
    const state = makeState();
    const projection = trackProjection(state);
    const parent = await pushFrame(state, '杀', 0, { cardId: 'slash', resolvedTargets: [1] });
    const childId = name === '闪' ? 'dodge' : 'nullify';
    const snapshots: boolean[][] = [];
    registerAfterHook(state, '测试观察', -1, '设置帧抵消', async () => {
      projection.flush();
      snapshots.push(state.settlementStack.map((frame) => frame.cancelled));
    });
    await runUseFlow(state, 1, childId, [], name, { virtual: true });
    projection.flush();
    expect(snapshots).toContainEqual([true, false]);
    expect(parent.cancelled).toBe(true);
    await setFrameCancelled(state, parent, false);
    projection.flush();
    expect(projection.views[2].settlementStack[0].cancelled).toBe(false);
    await setFrameCancelled(state, parent, true);
    projection.flush();
    await popFrame(state);
    projection.flush();
  });

  it('反无懈的三层结算不污染最外层帧', async () => {
    const state = makeState();
    const projection = trackProjection(state);
    const trick = await pushFrame(state, '过河拆桥', 0, { cardId: 'slash' });
    const nullification = await pushFrame(state, '无懈可击', 1, { cardId: 'nullify' });
    await runUseFlow(state, 2, 'nullify', [], '无懈可击', { virtual: true });
    projection.flush();
    expect(trick.cancelled).toBe(false);
    expect(nullification.cancelled).toBe(true);
    await popFrame(state);
    projection.flush();
    expect(projection.views[0].settlementStack[0].cancelled).toBe(false);
  });

  it('目标声明被取消时 skippedTargets 通过帧参数事件同步', async () => {
    const state = makeState();
    const projection = trackProjection(state);
    registerBeforeHook(state, '测试空城', 1, '成为目标', async () => ({ kind: 'cancel' }));
    registerAfterHook(state, '测试观察', -1, '帧参数赋值', async () => projection.flush());
    await runUseFlow(state, 0, 'slash', [1], '杀', { virtual: true });
    projection.flush();
    const updates = state.atomHistory.filter((entry) => entry.kind === 'atom' && entry.atom.type === '帧参数赋值');
    expect(updates.some((entry) => entry.kind === 'atom' && entry.atom.type === '帧参数赋值' && entry.atom.key === 'skippedTargets' && JSON.stringify(entry.atom.value) === '[1]')).toBe(true);
    expect(state.players[1].health).toBe(4);
  });

  it('流离真实回应后结算帧与增量视图保留新目标', async () => {
    const state = makeState();
    state.players[0].hand = ['slash'];
    state.players[1].hand = ['dodge'];
    state.players[1].skills = ['流离'];
    state.players[2].hand = ['nullify'];
    const harness = new SkillTestHarness();
    await harness.setup(state);
    const source = harness.player('P0');
    const redirector = harness.player('P1');
    const target = harness.player('P2');
    await source.useCardAndTarget('杀', 'slash', [1]);
    await redirector.respond('流离', { choice: true });
    await redirector.respond('流离', { target: 2 });
    await redirector.respond('流离', { cardId: 'dodge' });
    expect(state.settlementStack[0].params.resolvedTargets).toEqual([2]);
    expect(target.processedView.settlementStack[0].params.resolvedTargets).toEqual([2]);
    expect(target.processedView.settlementStack).toEqual(buildView(state, 2).settlementStack);
    await target.pass();
    expect(state.players[1].health).toBe(4);
    expect(state.players[2].health).toBe(3);
  });

  it('立军与恃才的使用时实体牌参数经过真实帧参数 atom', async () => {
    const state = makeState();
    const shadowId = 'slash#武圣';
    state.cardMap[shadowId] = { ...state.cardMap.slash, id: shadowId, shadowOf: 'slash' };
    initLijun(createLijun('立军', 0), state);
    initShicai(createShicai('恃才', 1), state);
    const projection = trackProjection(state);
    const frame = await pushFrame(state, '杀', 1, { cardId: shadowId });
    await applyAtom(state, { type: '使用时', source: 1, cardId: shadowId });
    projection.flush();
    expect(frame.params['立军/effectiveCardId']).toBe('slash');
    expect(frame.params['恃才/effectiveCardId']).toBe('slash');
    expect(projection.views[0].settlementStack[0].params).toEqual(frame.params);
  });
});
