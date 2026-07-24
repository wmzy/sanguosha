// src/engine/atoms/damage-timing.ts
// 伤害编排时机 atom 定义(对齐 flow-redesign.md 模块 A / damage.md 8 时机):
//   - 伤害结算开始时 / 造成伤害时 / 受到伤害时 / 造成伤害后 / 受到伤害后 /
//     伤害结算结束时 / 伤害结算结束后
//   全部为事件标记型:validate 恒通过、apply 无副作用,只提供 before/after hook 注册点。
//   由 src/engine/damage-flow.ts 的编排函数 runDamageFlow 在扣减体力前后依次发出。
//
// before-hook modify amount 的回传通道:
//   伤害结算开始时 / 造成伤害时 / 受到伤害时 三者的 before-hook 可 modify amount
//   (狂风大雾修正 / 裸衣古锭刀暗箭酒加伤 / 藤甲白银狮子减伤)。其 afterApply 把
//   折叠后的最终 atom.amount 写入 state.localVars[DAMAGE_AMOUNT_KEY],
//   runDamageFlow 据此读取修正后的伤害值。其余 4 个纯标记时机无 afterApply。
//
// 噪声抑制:无 before hook 时标记型 atom 的 toViewEvents 返回 null(整个 atom 视图上 no-op),
// 与 life-timing / 生效前 / 使用结算结束时 一致。atom 本身仍走完整 pipeline(apply + after hooks),
// 编排函数/测试可从 state.atomHistory 观察时序。
import type { DamageType } from '../../shared/types';
import type { AtomDefinition, GameState, GameView, ViewEventSplit, ViewEvent } from '../types';
import { registerAtom } from '../atom';
import { getBeforeHooks } from '../skill';

// ── before-hook modify amount 的回传通道 ────────────────────
// 伤害结算开始时/造成伤害时/受到伤害时 的 before-hook 可 modify amount;afterApply 把最终
// (被折叠后的) amount 写入 state.localVars[DAMAGE_AMOUNT_KEY],runDamageFlow 据此读取修正后的伤害值。
// 与 life-timing 的 MODIFY_AMOUNT_KEY 同构——独立键以避免与回复量通道串扰。
export const DAMAGE_AMOUNT_KEY = '__damageAmount';
export const DAMAGE_SOURCE_KEY = '__damageSource';

/** 伤害时机 atom 的公共形状。 */
type DamageTimingAtom = {
  source: number;
  target: number;
  amount: number;
  cardId?: string;
  damageType?: DamageType;
};

/** 校验 source/target 玩家存在(纯标记,不校验存活/amount——编排函数前置保证)。 */
function validateDamageTiming(state: GameState, atom: DamageTimingAtom): string | null {
  // source 可为系统来源(TARGET_SYSTEM,如闪电/连环传导),不校验其存在;只校验目标玩家存在。
  if (!state.players[atom.target]) return `target ${atom.target} not found`;
  return null;
}

/** 无 before-hook 时静默(no-op 视图),有 before-hook 时发通知事件。 */
function damageTimingView(state: GameState, type: string, atom: DamageTimingAtom): ViewEventSplit {
  if (getBeforeHooks(state, type).length === 0) {
    return { ownerViews: new Map(), othersView: null };
  }
  const view: ViewEvent = {
    type,
    source: atom.source,
    target: atom.target,
    amount: atom.amount,
    damageType: atom.damageType,
  };
  return { ownerViews: new Map(), othersView: view };
}

// ── 时机1:伤害结算开始时(绝情 cancel / 狂风大雾修正) ─────────
// before-hook 可 cancel(绝情→跳过整个结算)或 modify amount/source(狂风大雾修正/祸首改来源)。
export const 伤害结算开始时: AtomDefinition<DamageTimingAtom> = {
  type: '伤害结算开始时',
  validate: validateDamageTiming,
  apply() {},
  async afterApply(state, atom) {
    state.localVars[DAMAGE_AMOUNT_KEY] = atom.amount;
    state.localVars[DAMAGE_SOURCE_KEY] = atom.source;
  },
  toViewEvents(state, atom) {
    return damageTimingView(state, '伤害结算开始时', atom);
  },
  applyView() {},
};

registerAtom(伤害结算开始时);

// ── 时机2:造成伤害时(来源方加伤:裸衣/古锭刀/暗箭/酒) ────────
// before-hook modify amount 链式叠加(裸衣+1 后续减伤看到加过的值)。
export const 造成伤害时: AtomDefinition<DamageTimingAtom> = {
  type: '造成伤害时',
  validate: validateDamageTiming,
  apply() {},
  async afterApply(state, atom) {
    state.localVars[DAMAGE_AMOUNT_KEY] = atom.amount;
  },
  toViewEvents(state, atom) {
    return damageTimingView(state, '造成伤害时', atom);
  },
  applyView() {},
};

registerAtom(造成伤害时);

// ── 时机3:受到伤害时(目标方减伤/防止:藤甲/白银狮子/天香/名士) ─
// before-hook 可 modify amount(减伤)或 cancel(完全防止→编排函数跳到伤害结算结束时)。
export const 受到伤害时: AtomDefinition<DamageTimingAtom> = {
  type: '受到伤害时',
  validate: validateDamageTiming,
  apply() {},
  async afterApply(state, atom) {
    state.localVars[DAMAGE_AMOUNT_KEY] = atom.amount;
  },
  toViewEvents(state, atom) {
    return damageTimingView(state, '受到伤害时', atom);
  },
  applyView() {},
};

registerAtom(受到伤害时);

// ── 时机4:造成伤害后(来源方:狂骨/破军) ─────────────────────
// 纯标记,after-hook 触发来源方结算。无 afterApply(不修正 amount)。
export const 造成伤害后: AtomDefinition<DamageTimingAtom> = {
  type: '造成伤害后',
  validate: validateDamageTiming,
  apply() {},
  toViewEvents(state, atom) {
    return damageTimingView(state, '造成伤害后', atom);
  },
  applyView() {},
};

registerAtom(造成伤害后);

// ── 时机5:受到伤害后(目标方:奸雄/反馈/遗计/刚烈) ────────────
// 纯标记,after-hook 触发目标方结算(扣血前)。
export const 受到伤害后: AtomDefinition<DamageTimingAtom> = {
  type: '受到伤害后',
  validate: validateDamageTiming,
  apply() {},
  toViewEvents(state, atom) {
    return damageTimingView(state, '受到伤害后', atom);
  },
  applyView() {},
};

registerAtom(受到伤害后);

// ── 时机7:伤害结算结束时(天香摸牌/连环重置) ─────────────────
// 纯标记,扣减体力之后发出。
export const 伤害结算结束时: AtomDefinition<DamageTimingAtom> = {
  type: '伤害结算结束时',
  validate: validateDamageTiming,
  apply() {},
  toViewEvents(state, atom) {
    return damageTimingView(state, '伤害结算结束时', atom);
  },
  applyView() {},
};

registerAtom(伤害结算结束时);

// ── 时机8:伤害结算结束后(酒诗②/连环传导——可能触发新伤害) ────
// 纯标记,整个结算的最末时机。连环传导在此 after-hook 内发起一次新的 runDamageFlow。
export const 伤害结算结束后: AtomDefinition<DamageTimingAtom> = {
  type: '伤害结算结束后',
  validate: validateDamageTiming,
  apply() {},
  toViewEvents(state, atom) {
    return damageTimingView(state, '伤害结算结束后', atom);
  },
  applyView() {},
};

registerAtom(伤害结算结束后);
