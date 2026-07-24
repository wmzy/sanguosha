// src/engine/atoms/judge-timing.ts
// 判定编排时机 atom 定义(对齐 flow-redesign.md 模块 H / judge.md):
//   - 判定时 / 判定牌生效前 / 判定牌生效后
//   全部为事件标记型:validate 恒通过、apply 无副作用,只提供 before/after hook 注册点。
//   由 src/engine/judge-flow.ts 的编排函数 runJudgeFlow 在判定流程中依次发出。
//
// 当前接入状态(模块 H 最小改动):
//   判定时 —— 已接入 runJudgeFlow(在 判定 atom 翻牌之前发出)。
//   判定牌生效前 / 判定牌生效后 —— 仅定义,暂不接入编排。
//     现有 判定 atom 的 afterApply(runJudgeModifiers 改判)+ afterHooks(消费+移弃牌堆)保持不变;
//     鬼才/鬼道仍走 runJudgeModifiers,天妒/洛神/屯田仍走 判定 after-hook。
//     待 hook 迁移到 判定牌生效前/后 时再由 runJudgeFlow 接入(届时 判定 atom 的改判/消费逻辑一并迁出)。
//
// 噪声抑制:无 before hook 时标记型 atom 的 toViewEvents 返回 null(整个 atom 视图上 no-op),
// 与 damage-timing / life-timing / statechange-timing 一致。atom 本身仍走完整 pipeline(apply + after hooks),
// 编排函数/测试可从 state.atomHistory 观察时序。
import type { AtomDefinition, GameState, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { getBeforeHooks } from '../skill';

/** 判定时机 atom 的公共形状。cardId 仅 生效前/生效后 携带(翻出的判定牌)。 */
type JudgeTimingAtom = {
  player: number;
  judgeType: string;
  cardId?: string;
};

/** 校验 player 存在(纯标记,不校验存活——编排函数前置保证)。 */
function validateJudgeTiming(state: GameState, atom: JudgeTimingAtom): string | null {
  if (!state.players[atom.player]) return `player ${atom.player} not found`;
  return null;
}

/** 校验 player 与判定牌存在(生效前/后 携带 cardId)。 */
function validateJudgeTimingWithCard(state: GameState, atom: JudgeTimingAtom): string | null {
  if (!state.players[atom.player]) return `player ${atom.player} not found`;
  if (atom.cardId !== undefined && !state.cardMap[atom.cardId]) return `card ${atom.cardId} not found`;
  return null;
}

/** 无 before hook 时静默(no-op 视图),有 before-hook 时发通知事件。 */
function judgeTimingView(state: GameState, type: string, atom: JudgeTimingAtom): ViewEventSplit {
  if (getBeforeHooks(state, type).length === 0) {
    return { ownerViews: new Map(), othersView: null };
  }
  const view: ViewEvent = {
    type,
    player: atom.player,
    judgeType: atom.judgeType,
  };
  if (atom.cardId !== undefined) view.cardId = atom.cardId;
  return { ownerViews: new Map(), othersView: view };
}

// ── 判定时(咒缚 before-hook modify:替换判定牌来源) ─────────
// 纯标记,在 判定 atom 翻牌之前由 runJudgeFlow 发出。判定流程的最先时机。
export const 判定时: AtomDefinition<JudgeTimingAtom> = {
  type: '判定时',
  validate: validateJudgeTiming,
  apply() {},
  toViewEvents(state, atom) {
    return judgeTimingView(state, '判定时', atom);
  },
  applyView() {},
};

registerAtom(判定时);

// ── 判定牌生效前(鬼才/鬼道 改判) ──────────────────────────
// 仅定义,暂不接入编排(现有改判在 判定 atom.afterApply 的 runJudgeModifiers)。
export const 判定牌生效前: AtomDefinition<JudgeTimingAtom> = {
  type: '判定牌生效前',
  validate: validateJudgeTimingWithCard,
  apply() {},
  toViewEvents(state, atom) {
    return judgeTimingView(state, '判定牌生效前', atom);
  },
  applyView() {},
};

registerAtom(判定牌生效前);

// ── 判定牌生效后(天妒/洛神 获得判定牌 / 屯田 置武将牌上) ────
// 仅定义,暂不接入编排(现有消费在 判定 atom.afterHooks)。
export const 判定牌生效后: AtomDefinition<JudgeTimingAtom> = {
  type: '判定牌生效后',
  validate: validateJudgeTimingWithCard,
  apply() {},
  toViewEvents(state, atom) {
    return judgeTimingView(state, '判定牌生效后', atom);
  },
  applyView() {},
};

registerAtom(判定牌生效后);
