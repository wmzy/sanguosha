// 牌无效化原语(card invalidation)。
//
// 三国杀中「令某张牌对某角色无效」是一类横切关注点(界贞烈/界智迟/帷幕/巨象/藤甲
// 等),原本各技能各自手写 5-7 个 before-hook 拦截同一组 atom(成为目标/检测有效性/
// 询问杀/受到伤害时/获得/弃置/设横置)。本模块把这套拦截点抽成一个公共原语:调用方
// 只需提供一个谓词 CardInvalidationPredicate,谓词返回 true 时原语在所有拦截点 cancel。
//
// 卡 id 来源(逐 atom):
//   - 直接:atom.cardId(成为目标/检测有效性/受到伤害时 的 atom 直接携带触发牌 id)
//   - 间接:topFrame(state).params.cardId(询问杀/获得/弃置/设横置 的触发牌由结算帧携带;
//     atom 自身字段含义不同,如「获得」的 cardId 是被获得的牌而非触发锦囊)
// cardId 无效(undefined 或不在 cardMap)时 card=undefined 传给谓词,由谓词决定是否拦截。
//
// 目标匹配规则(逐 atom):
//   - 成为目标/检测有效性/询问杀/受到伤害时:atom.target === ownerId(owner 是受影响方)
//   - 获得:atom.from === ownerId 且 atom.player !== ownerId(别人从 owner 处获得)
//   - 弃置/设横置:atom.player === ownerId
//
// 引擎语义:before-hook 返回 { kind: 'cancel' } 会使该 atom 短路(后续同 atom 的 hook 跳过,
// atom 不生效)。本原语注册的 hook 目标不匹配时直接 return(void=pass),只有谓词为真才 cancel。
import type { Card, GameState, HookResult } from '../types';
import { topFrame } from './frame';
import { registerBeforeHook } from './skill';

/** 牌无效化谓词:返回 true 时在所有拦截点 cancel 该牌对 target 的效果。
 *  card 为与当前 atom 关联的牌(undefined 表示无有效 cardId 或卡不在 cardMap)。 */
export type CardInvalidationPredicate = (
  state: GameState,
  card: Card | undefined,
  target: number,
) => boolean;

/** 从 cardId 解析 Card(cardId 无效或不在 cardMap 时返回 undefined)。 */
function cardOf(state: GameState, cardId: string | undefined): Card | undefined {
  if (!cardId) return undefined;
  return state.cardMap[cardId];
}

/** 从顶帧 params.cardId 解析 Card(询问杀/获得/弃置/设横置 的触发牌由结算帧携带)。 */
function frameCardOf(state: GameState): Card | undefined {
  const cardId = topFrame(state)?.params?.cardId;
  return cardOf(state, typeof cardId === 'string' ? cardId : undefined);
}

/**
 * 注册牌无效化:谓词返回 true 时在所有 7 个拦截点 cancel。返回 unloader。
 *
 * @param state     GameState
 * @param skillId   技能实例 id(hook 归属)
 * @param ownerId   受保护角色座次
 * @param predicate 无效化谓词
 */
export function registerCardInvalidation(
  state: GameState,
  skillId: string,
  ownerId: number,
  predicate: CardInvalidationPredicate,
): () => void {
  const unloaders: Array<() => void> = [];

  // 1. 成为目标:atom.target === ownerId;cardId = atom.cardId
  unloaders.push(
    registerBeforeHook(state, skillId, ownerId, '成为目标', async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      if (predicate(ctx.state, cardOf(ctx.state, atom.cardId), ownerId)) return { kind: 'cancel' };
    }),
  );

  // 2. 检测有效性:atom.target === ownerId;cardId = atom.cardId
  unloaders.push(
    registerBeforeHook(state, skillId, ownerId, '检测有效性', async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      if (predicate(ctx.state, cardOf(ctx.state, atom.cardId), ownerId)) return { kind: 'cancel' };
    }),
  );

  // 3. 询问杀:atom.target === ownerId;cardId = topFrame(state).params.cardId
  unloaders.push(
    registerBeforeHook(state, skillId, ownerId, '询问杀', async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      if (predicate(ctx.state, frameCardOf(ctx.state), ownerId)) return { kind: 'cancel' };
    }),
  );

  // 4. 受到伤害时:atom.target === ownerId;cardId = atom.cardId
  unloaders.push(
    registerBeforeHook(state, skillId, ownerId, '受到伤害时', async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      if (predicate(ctx.state, cardOf(ctx.state, atom.cardId), ownerId)) return { kind: 'cancel' };
    }),
  );

  // 5. 获得:atom.from === ownerId 且 atom.player !== ownerId;cardId = topFrame(state).params.cardId
  unloaders.push(
    registerBeforeHook(state, skillId, ownerId, '获得', async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.from !== ownerId) return;
      if (atom.player === ownerId) return;
      if (predicate(ctx.state, frameCardOf(ctx.state), ownerId)) return { kind: 'cancel' };
    }),
  );

  // 6. 弃置:atom.player === ownerId;cardId = topFrame(state).params.cardId
  unloaders.push(
    registerBeforeHook(state, skillId, ownerId, '弃置', async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.player !== ownerId) return;
      if (predicate(ctx.state, frameCardOf(ctx.state), ownerId)) return { kind: 'cancel' };
    }),
  );

  // 7. 设横置:atom.player === ownerId;cardId = topFrame(state).params.cardId
  unloaders.push(
    registerBeforeHook(state, skillId, ownerId, '设横置', async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.player !== ownerId) return;
      if (predicate(ctx.state, frameCardOf(ctx.state), ownerId)) return { kind: 'cancel' };
    }),
  );

  return () => {
    for (const u of unloaders) u();
  };
}
