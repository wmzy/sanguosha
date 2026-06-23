// 成为目标:结算阶段第一个 atom,标记目标正式进入结算流程。
// 与 指定目标(声明阶段) 不同:指定目标 是使用者声明所有合法目标,
// 成为目标 是结算循环中目标进入"被杀结算"状态。
// before hook 可被"不能成为目标"类技能拦截(空城/帷幕等 cancel)。
// after hook 触发"成为目标后"时机技能(流离转移等)。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 成为目标: AtomDefinition<{ source: number; cardId?: string; target: number }> = {
  type: '成为目标',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    if (!state.players[atom.target]) return `target ${atom.target} not found`;
    return null;
  },
  apply(_state) {
    // 事件标记——before hook cancel = 此目标无效,跳过结算
  },
  effect: { sound: 'target', animation: 'highlight', duration: 400 },
  toViewEvents(_state, atom): ViewEventSplit {
    const view: ViewEvent = {
      type: '成为目标',
      source: atom.source,
      target: atom.target,
      ...(atom.cardId !== undefined ? { cardId: atom.cardId } : {}),
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView(_view, _event) {
    // 事件标记——无 GameView 字段需要直接更新(高亮态由前端处理 effect 期间临时绘制)。
  },
};

registerAtom(成为目标);
