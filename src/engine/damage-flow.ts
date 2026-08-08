// src/engine/damage-flow.ts
// 伤害结算编排函数(对齐 出牌流程重设计.md 模块 A / damage.md 8 时机)。
//
// 将单 atom 模式升级为「编排函数 + 时机标记 atom」模式(与 runUseFlow / life-flow 一致):
//   applyAtom(时机标记A) → applyAtom(时机标记B) → … → runDecreaseLifeFlow(实质扣减) → …
//
// 关键约束(模块 A1 范围·仅建基础设施):
//   - 只新增编排函数 + 时机 atom 定义,不迁移调用方(A2 步骤负责)。
//   - runDamageFlow 用 7 个时机 atom + 模块 M 的 runDecreaseLifeFlow 完成伤害结算。
//
// before-hook modify amount 的传递:
//   伤害结算开始时/造成伤害时/受到伤害时 三者 afterApply 把折叠后的最终 amount 回写
//   state.localVars[DAMAGE_AMOUNT_KEY],编排函数在 applyAtom 返回后读取该值作为后续伤害值。
//   cancel 语义:伤害结算开始时 cancel → 跳过整个伤害流程;受到伤害时 cancel → 防止伤害,
//   跳到伤害结算结束时(仍发 结束时/结束后 时机,amount=0)。
import type { GameState } from './types';
import type { DamageType } from '../engine/types';
import { applyAtom } from './index';
import { runDecreaseLifeFlow } from './life-flow';
import { DAMAGE_AMOUNT_KEY, DAMAGE_SOURCE_KEY } from './atoms/damage-timing';

/** 伤害结算编排函数——对齐 damage.md 8 时机。
 *
 *  时机1 伤害结算开始时:绝情(cancel 整个结算)/ 狂风大雾(修正伤害值或类型)
 *  时机2 造成伤害时:来源方加伤(裸衣/古锭刀/暗箭/酒)——modify amount
 *  时机3 受到伤害时:目标方减伤/防止(藤甲/白银狮子/天香/名士)——modify amount 或 cancel
 *  时机4 扣减体力:模块 M 的 runDecreaseLifeFlow(含扣减前/时/扣减/后四子时机)
 *  时机5 造成伤害后:来源方(狂骨/破军)
 *  时机6 受到伤害后:目标方(奸雄/反馈/遗计/刚烈)
 *  时机7 伤害结算结束时:天香摸牌/连环重置
 *  时机8 伤害结算结束后:酒诗②/连环传导——可能触发新伤害(嵌套 runDamageFlow)
 *
 *  cardId 为伤害来源牌(杀/决斗等),透传到各时机 atom(供 奸雄等 hook 读取伤害牌)。 */
export async function runDamageFlow(
  state: GameState,
  source: number,
  target: number,
  baseAmount: number,
  cardId?: string,
  damageType?: DamageType,
): Promise<void> {
  let amount = baseAmount;

  // 时机1:伤害结算开始时(绝情 cancel / 狂风大雾修正)
  state.localVars[DAMAGE_AMOUNT_KEY] = amount;
  const startResult = await applyAtom(state, {
    type: '伤害结算开始时', source, target, amount, cardId, damageType,
  });
  if (!startResult) return; // 被 cancel(绝情)→ 跳过整个伤害流程
  amount = state.localVars[DAMAGE_AMOUNT_KEY];
  source = state.localVars[DAMAGE_SOURCE_KEY] as number;

  // 时机2:造成伤害时(来源方加伤:裸衣/古锭刀/暗箭/酒)
  state.localVars[DAMAGE_AMOUNT_KEY] = amount;
  await applyAtom(state, {
    type: '造成伤害时', source, target, amount, cardId, damageType,
  });
  amount = state.localVars[DAMAGE_AMOUNT_KEY];

  // 时机3:受到伤害时(目标方减伤/防止:藤甲/白银狮子/天香/名士)
  state.localVars[DAMAGE_AMOUNT_KEY] = amount;
  const sufferResult = await applyAtom(state, {
    type: '受到伤害时', source, target, amount, cardId, damageType,
  });
  amount = state.localVars[DAMAGE_AMOUNT_KEY];
  if (!sufferResult || amount <= 0) {
    // cancel(完全防止)或 amount 经 modify 折叠为 0(伤害减为0即防止全部伤害):
    // 视为来源未造成过伤害、目标角色也未受到过伤害,
    // 跳过 造成/受到伤害后 与扣减,直接进入 伤害结算结束时/后(amount=0)。
    await applyAtom(state, {
      type: '伤害结算结束时', source, target, amount: 0, cardId, damageType,
    });
    await applyAtom(state, {
      type: '伤害结算结束后', source, target, amount: 0, cardId, damageType,
    });
    return;
  }

  // 时机4:扣减体力(模块 M 的子流程,含扣减前/时/扣减/后四时机)
  // 扣减体力的 after-hook 中,系统规则会检查濒死(若体力≤0 → runDyingFlow)。
  // 对齐 decreaselife.md:扣减 → 若0则濒死结算,濒死在 造成伤害后/受到伤害后 之前触发。
  if (amount > 0) {
    await runDecreaseLifeFlow(state, target, amount, source);
  }

  // 时机5:造成伤害后(来源方:狂骨/破军)
  await applyAtom(state, {
    type: '造成伤害后', source, target, amount, cardId, damageType,
  });

  // 时机6:受到伤害后(目标方:奸雄/反馈/遗计/刚烈)
  await applyAtom(state, {
    type: '受到伤害后', source, target, amount, cardId, damageType,
  });

  // 时机7:伤害结算结束时(天香摸牌/连环重置)
  await applyAtom(state, {
    type: '伤害结算结束时', source, target, amount, cardId, damageType,
  });

  // 时机8:伤害结算结束后(酒诗②/连环传导——可能触发新伤害)
  await applyAtom(state, {
    type: '伤害结算结束后', source, target, amount, cardId, damageType,
  });
}
