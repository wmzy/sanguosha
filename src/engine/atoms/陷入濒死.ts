// src/engine/atoms/陷入濒死.ts
// 陷入濒死:标记目标进入濒死状态(体力 ≤ 0,等待求桃)。纯事件标记——不修改 state。
import type { AtomDefinition, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../core/atom';

/** 女性武将名集合——用于濒死求救音效选择(sos_female vs sos_male)。
 *  含标准包+军争篇+界武将中的女性武将。 */
const FEMALE_CHARACTERS = new Set([
  '甄姬', '貂蝉', '黄月英', '大乔', '小乔', '孙尚香', '蔡文姬', '祝融',
  '界甄姬', '界貂蝉', '界黄月英', '界大乔', '界小乔', '界孙尚香', '界蔡文姬', '界祝融',
  '界张春华', '界王异', '界夏侯氏', '界郭皇后', '界吴国太', '界蔡夫人', '界伏皇后',
]);

export const 陷入濒死: AtomDefinition<{ target: number }> = {
  type: '陷入濒死',
  validate(state, atom) {
    if (!state.players[atom.target]) return `target not found`;
    return null;
  },
  apply() {
    // 纯事件标记——体力扣减由 扣减体力/失去体力 负责,alive 由 death-flow 的 系统处理牌 负责
  },
  effect: { animation: 'flash_red', duration: 600 },
  toViewEvents(state, atom): ViewEventSplit {
    // 濒死求救(SOS):按武将性别选音效(对齐 QSanguosha roomscene.cpp:410)。
    const target = state.players[atom.target];
    const sound = FEMALE_CHARACTERS.has(target?.character ?? '') ? 'sos_female' : 'sos_male';
    const view: ViewEvent = {
      type: '陷入濒死',
      target: atom.target,
      effect: { sound } as const,
    };
    return { ownerViews: new Map(), othersView: view };
  },
  applyView() {
    // 体力（可负）由 扣减体力/失去体力 的 applyView 已正确同步（濒死时 health ≤ 0）。
    // 不再强制归零——view.health 镜像 state.health（体力），前端按体力值(Math.max(0,…))展示。
    // alive 由 death-flow 的 系统处理牌 applyView 更新。
  },
};

registerAtom(陷入濒死);
