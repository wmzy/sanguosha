// 被抵消:生效前阶段,此牌被响应抵消时触发。
// 对应规则"生效前:可以对此牌进行响应;响应结果可能令此牌被抵消",
// 以及"【杀】被抵消时能发动的装备技能:贯石斧、青龙偃月刀"。
//
// 武器技(贯石斧/青龙偃月刀)挂 after hook:在牌被抵消后介入。
// 武器技自行判断 ctx.frame.skillId === '杀'——只对杀生效(万箭齐发等锦囊被闪抵消不触发武器技)。
//
// 通用时机:杀被闪抵消、万箭齐发被闪抵消等均可 apply 此 atom。
// 调用方约定:applyAtom(被抵消) 后重新检查处理区,武器技可能已移走闪(贯石斧强命)
// 或追杀改变状态(青龙),据此决定 drain 闪 / 造成伤害。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 被抵消: AtomDefinition<{ source: number; target: number; cardId: string }> = {
  type: '被抵消',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply() {
    // 纯时机型 atom:抵消后的武器技介入由 after hook 处理,apply 无副作用。
  },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '被抵消',
      source: atom.source,
      target: atom.target,
      cardId: atom.cardId,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // 无视图状态变更:处理区变化由移动牌 atom 的 applyView 驱动。
  },
  toViewLog(event) {
    return { player: event.target as number, text: `抵消` };
  },
};

registerAtom(被抵消);
