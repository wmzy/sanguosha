// 选择目标时:使用结算前的第一个时机(use.md 时机1)。
// before hook 可被转化技替换:将声明的目标集合替换为另一组合法目标。
// 与 指定目标(声明阶段) 区别:指定目标 逐个声明,本时机是使用者确定全部目标后、
// 进入结算前的统一时机,供转化/替换类技能一次性介入。
// 事件标记型——apply 无副作用,只提供 hook 注册点。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';

export const 选择目标时: AtomDefinition<{ source: number; cardId: string; targets: number[] }> = {
  type: '选择目标时',
  validate(state, atom) {
    if (!state.players[atom.source]) return `source ${atom.source} not found`;
    for (const t of atom.targets) {
      if (!state.players[t]) return `target ${t} not found`;
    }
    return null;
  },
  apply() {
    // 事件标记——转化技可经 before hook modify 替换目标集合
  },
  effect: { sound: 'target', animation: 'highlight', duration: 400 },
  toViewEvents(state, atom): ViewEventSplit {
    const cardName = state.cardMap[atom.cardId]?.name ?? atom.cardId;
    const view: ViewEvent = {
      type: '选择目标时',
      source: atom.source,
      cardId: atom.cardId,
      cardName,
      targets: atom.targets,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // 事件标记——无 GameView 字段需要直接更新(高亮态由前端处理 effect 期间临时绘制)。
  },
};

registerAtom(选择目标时);
