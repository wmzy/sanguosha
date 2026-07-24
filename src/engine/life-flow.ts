// src/engine/life-flow.ts
// 体力编排函数(对齐 flow-redesign.md 模块 M + decreaselife.md/recoverlife.md/loselife.md)。
//
// 将单 atom 模式升级为「编排函数 + 时机标记 atom」模式(与 runUseFlow 一致):
//   applyAtom(时机标记A) → applyAtom(时机标记B) → applyAtom(实质atom) → applyAtom(时机标记C)
//
// 关键约束(模块 M 范围):
//   - 只新增编排函数 + atom 定义,不迁移调用方(A/B/C 模块负责)。
//   - 不修改 造成伤害.ts 的现有 apply 逻辑、不修改 系统规则.ts 的 runDyingFlow、不迁移技能 hook。
//   - 回复体力/失去体力 的现有 atom 保留不动,编排函数在调用它们前后补发时机 atom。
//   - 编排函数不直接触发濒死/死亡——保持 系统规则.ts 的 after-hook 触发逻辑
//     (失去体力 after-hook 检查 health<=0 → runDyingFlow)。
import type { GameState } from './types';
import { applyAtom } from './create-engine';
import { MODIFY_AMOUNT_KEY } from './atoms/life-timing';

/** 读取 before-hook modify 后的 amount(从 确定回复数值时 的 apply 回写值)。
 *  未设置时回退到传入的 fallback(无 modify 发生的正常路径)。 */
function readModifiedAmount(state: GameState, fallback: number): number {
  const v = state.localVars[MODIFY_AMOUNT_KEY];
  return typeof v === 'number' ? v : fallback;
}

/** 扣减体力子流程(decreaselife.md 三时机,被 runDamageFlow 和 runLoseLifeFlow 共用)。
 *
 *  时机1 扣减体力前:酒诗②/连环条件检测/重置
 *  时机2 扣减体力时:不屈
 *  实质扣减:底层 扣减体力 atom(只扣 health,无伤害 hook)
 *  时机3 扣减体力后:伤逝
 *
 *  濒死检查不在此处直接调 runDyingFlow——保持现有 系统规则 after-hook 触发逻辑。
 *  (runLoseLifeFlow 末尾的 失去体力 after-hook 会检查 health<=0。)
 *
 *  source 供模块 A 的 runDamageFlow 透传(记录伤害来源),当前扣减 atom 不消费它。 */
export async function runDecreaseLifeFlow(
  state: GameState,
  target: number,
  amount: number,
  source?: number,
): Promise<void> {
  // 记录致死来源供死亡奖惩:伤害有来源(runDamageFlow 透传),失去体力/减上限无来源。
  // 扣减体力 after-hook(系统规则)据此触发濒死——与 造成伤害/失去体力 after-hook 语义一致。
  if (source === undefined) {
    delete state.localVars['死亡/killer'];
  } else {
    state.localVars['死亡/killer'] = source;
  }
  // 时机1:扣减体力前(酒诗②/连环条件检测/重置)
  await applyAtom(state, { type: '扣减体力前', target, amount });
  // 时机2:扣减体力时(不屈)
  await applyAtom(state, { type: '扣减体力时', target, amount });
  // 实质扣减:底层 atom,不触发伤害 hook
  await applyAtom(state, { type: '扣减体力', target, amount });
  // 时机3:扣减体力后(伤逝)
  await applyAtom(state, { type: '扣减体力后', target, amount });
}

/** 回复体力编排函数(recoverlife.md)。
 *
 *  时机1 确定回复数值时:救援可修正 amount(before-hook modify → localVars 回写)
 *  实质回复:现有 回复体力 atom(保留不动)
 *  时机2 回复体力后:伤逝/淑慎/恩怨① */
export async function runRecoverLifeFlow(
  state: GameState,
  target: number,
  amount: number,
  source?: number,
): Promise<void> {
  // 时机1:确定回复数值(救援可修正)
  await applyAtom(state, { type: '确定回复数值时', target, amount, source });
  amount = readModifiedAmount(state, amount);
  // 实质回复(现有 atom 保留不动)
  await applyAtom(state, { type: '回复体力', target, amount, source });
  // 时机2:回复体力后(伤逝/淑慎/恩怨①)
  await applyAtom(state, { type: '回复体力后', target, amount, source });
}

/** 失去体力编排函数(loselife.md)。
 *
 *  时机1 失去体力时:黄巾天兵符②
 *  扣减体力子流程(decreaselife.md 三时机)
 *  时机2 失去体力后:诈降
 *
 *  濒死检查由现有 失去体力 after-hook(系统规则)处理,此处不直接触发。 */
export async function runLoseLifeFlow(
  state: GameState,
  target: number,
  amount: number,
): Promise<void> {
  // 时机1:失去体力时(黄巾天兵符②)
  await applyAtom(state, { type: '失去体力时', target, amount });
  // 扣减体力子流程(decreaselife.md 三时机)
  await runDecreaseLifeFlow(state, target, amount);
  // 时机2:失去体力后(诈降)
  await applyAtom(state, { type: '失去体力后', target, amount });
}

/** 体力上限编排函数。
 *
 *  实质 设上限(现有 atom,apply 会 clamp health 到新上限——该 clamp 被 崩坏/志继/若愚等
 *  8+ 现有调用方依赖,本模块不重构它)。
 *  减上限:若旧体力超出新上限,先走扣减子流程(触发扣减时机:伤逝等),再 设上限。
 *    —— 顺序关键:先扣减使 health 降至 newMax,随后 设上限 的 clamp 即为 no-op,避免重复扣减
 *    (若先 设上限,其 clamp 已静默降过一次,再走子流程会重复扣减)。
 *  加上限:加上限后 时机(设上限 的 clamp 对加上限是 no-op,不自动回血)。
 *
 *  上限为 0 则死亡——此处不调 runDeathFlow(B 模块负责),保留现有逻辑。 */
export async function runSetMaxHealthFlow(
  state: GameState,
  target: number,
  newMax: number,
): Promise<void> {
  const oldMax = state.players[target].maxHealth;
  const oldHealth = state.players[target].health;

  // 减上限导致体力超出新上限:先走扣减子流程(触发扣减时机),再 设上限。
  // 顺序:先扣减 → health 降到 newMax → 设上限 的 clamp 成为 no-op(净效果 = newMax,无重复扣减)。
  if (newMax < oldMax && oldHealth > newMax) {
    await runDecreaseLifeFlow(state, target, oldHealth - newMax);
  }

  await applyAtom(state, { type: '设上限', player: target, amount: newMax });

  if (newMax < oldMax) {
    await applyAtom(state, { type: '减上限后', player: target });
  } else if (newMax > oldMax) {
    await applyAtom(state, { type: '加上限后', player: target });
  }
  // 上限为 0 则死亡——保留现有逻辑(B 模块负责 runDeathFlow)
}
