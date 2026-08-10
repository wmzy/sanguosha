// src/engine/atoms/回合结束后.ts
// 回合结束后(game.md「回合结束后」,已离开该角色回合内):事件标记型 atom。
//
// 对应规则:"该角色的回合已经结束。从此时机开始就不是在'该角色的回合内'了。
//   能发动的武将技能:博图、化身②、戚乱、连破。"
//
// 与 回合结束 的区别:
//   回合结束 = 仍在该角色回合内(横江②/放权/谦逊/窃听/咒缚 等技能时机),apply 负责
//     清空 turn.vars / duration='turn' 标记 / /usedThisTurn vars。
//   回合结束后 = 已离开该角色回合内(博图/化身②/戚乱/连破 等技能时机),apply 无副作用
//     ——per-turn 清理已由 回合结束 完成,本 atom 只提供 before/after hook 注册点。
//
// 发出时机:由 回合管理(正常回合收尾) / performSkipTurn(翻面跳过收尾) 等路径在 回合结束
// atom 之后发出,且仅当 回合结束 未被 before-hook cancel。下一家 beginTurn 挂在本 atom 的
// after-hook,故额外回合型技能(博图)在其 before-hook cancel 本 atom 即可阻止正常推进、
// 亲自启动额外回合(放权则在更早的 回合结束 before-hook cancel)。
import type { AtomDefinition, ViewEventSplit } from '../types';

export const 回合结束后: AtomDefinition<{ player: number }> = {
  type: '回合结束后',
  validate(state, atom) {
    if (!state.players[atom.player]) return `player ${atom.player} not found`;
    return null;
  },
  apply() {},
  toViewEvents(): ViewEventSplit {
    // 纯后端时机标记,不下发视图事件:回合结束已下发回合结束信号,本时机的技能效果
    // (化身询问/博图额外回合)各自通过 请求回应/回合开始 等原子对前端表现。
    return { ownerViews: new Map(), othersView: null };
  },
  applyView() {},
};

