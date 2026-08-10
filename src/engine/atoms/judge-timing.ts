// src/engine/atoms/judge-timing.ts
// 判定编排时机 atom 定义(对齐 出牌流程重设计.md 模块 H / judge.md):
//   - 判定时 / 判定牌生效前 / 判定牌生效后
//   全部为事件标记型:validate 恒通过、apply 无副作用,只提供 before/after hook 注册点。
//   由 src/engine/judge-flow.ts 的编排函数 runJudgeFlow 在判定流程中依次发出。
//
// 接入状态(模块 H 已完成):
//   判定时 —— 由 runJudgeFlow 在 判定 atom 翻牌之前发出(咒缚 before-hook)。
//   判定牌生效前 —— 由 runJudgeFlow 在 判定(翻牌)之后发出;afterApply 调 runJudgeModifiers
//     (鬼才/鬼道 改判,逆时针从判定目标起)。
//   判定牌生效后 —— 由 runJudgeFlow 在 生效前 之后发出;消费方(天妒/洛神/屯田/闪电/乐不思蜀 等)
//     挂 after-hook 读结算帧顶的判定牌。判定牌入弃牌堆由 runJudgeFlow 末尾清理完成。
//
// 噪声抑制:无 before hook 时标记型 atom 的 toViewEvents 返回 null(整个 atom 视图上 no-op),
// 与 damage-timing / life-timing / statechange-timing 一致。atom 本身仍走完整 pipeline(apply + after hooks),
// 编排函数/测试可从 state.atomHistory 观察时序。
import type { AtomDefinition, GameState, ViewEventSplit, ViewEvent } from '../types';
import { runJudgeModifiers } from '../core/apply';
import { getBeforeHooks } from '../core/skill';

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


// ── 判定牌生效前(鬼才/鬼道 改判) ──────────────────────────
// 已接入 runJudgeFlow(在 判定 atom 翻牌之后发出)。改判仍走 runJudgeModifiers
// (逆时针从判定目标起逐个询问鬼才/鬼道),触发点从 判定.afterApply 迁移至此 afterApply。
// 改判直接 mutate 结算帧顶牌(代替/换走),改判完成后消费方(判定牌生效后)读到的是最终牌。
export const 判定牌生效前: AtomDefinition<JudgeTimingAtom> = {
  type: '判定牌生效前',
  validate: validateJudgeTimingWithCard,
  apply() {},
  async afterApply(state) {
    await runJudgeModifiers(state);
  },
  toViewEvents(state, atom) {
    return judgeTimingView(state, '判定牌生效前', atom);
  },
  applyView() {},
};


// ── 判定牌生效后(天妒/洛神 获得判定牌 / 屯田 置武将牌上 / 闪电·乐不思蜀 读牌执行) ─
// 已接入 runJudgeFlow(在 判定牌生效前 改判之后发出)。判定牌此刻仍在结算帧牌区顶
// (尚未入弃牌堆),消费方 after-hook 据此读牌。判定牌入弃牌堆由 runJudgeFlow 末尾清理完成。
export const 判定牌生效后: AtomDefinition<JudgeTimingAtom> = {
  type: '判定牌生效后',
  validate: validateJudgeTimingWithCard,
  apply() {},
  toViewEvents(state, atom) {
    return judgeTimingView(state, '判定牌生效后', atom);
  },
  applyView() {},
};

