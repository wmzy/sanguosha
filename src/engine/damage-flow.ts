// src/engine/damage-flow.ts
// 伤害结算编排函数(对齐 flow-redesign.md 模块 A / damage.md 8 时机)。
//
// 将单 atom 模式升级为「编排函数 + 时机标记 atom」模式(与 runUseFlow / life-flow 一致):
//   applyAtom(时机标记A) → applyAtom(时机标记B) → … → runDecreaseLifeFlow(实质扣减) → …
//
// 关键约束(模块 A1 范围·仅建基础设施):
//   - 只新增编排函数 + 时机 atom 定义,不迁移调用方(A2 步骤负责)。
//   - 不修改 造成伤害.ts 的现有 apply 逻辑、不改任何 applyAtom({ type: '造成伤害', ... }) 调用点。
//   - 不迁移技能 hook——现有 造成伤害 的 before/after hook 保持不动(A3 步骤负责迁移)。
//   - runDamageFlow 用新的 7 个时机 atom + 模块 M 的 runDecreaseLifeFlow,与旧 造成伤害 并存。
//
// before-hook modify amount 的传递:
//   伤害结算开始时/造成伤害时/受到伤害时 三者 afterApply 把折叠后的最终 amount 回写
//   state.localVars[DAMAGE_AMOUNT_KEY],编排函数在 applyAtom 返回后读取该值作为后续伤害值。
//   cancel 语义:伤害结算开始时 cancel → 跳过整个伤害流程;受到伤害时 cancel → 防止伤害,
//   跳到伤害结算结束时(仍发 结束时/结束后 时机,amount=0)。
import type { GameState } from './types';
import type { DamageType } from '../shared/types';
import { applyAtom } from './create-engine';
import { runDecreaseLifeFlow } from './life-flow';
import { DAMAGE_AMOUNT_KEY, DAMAGE_SOURCE_KEY } from './atoms/damage-timing';

/** localVars flag:runDamageFlow 执行扣减体力期间为 true,系统规则据此跳过扣减体力的濒死检查(改由伤害结算结束时处理)。 */
const DAMAGE_FLOW_FLAG = '__inDamageFlow';

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
  amount = state.localVars[DAMAGE_AMOUNT_KEY] as number;
  source = state.localVars[DAMAGE_SOURCE_KEY] as number;

  // 时机2:造成伤害时(来源方加伤:裸衣/古锭刀/暗箭/酒)
  state.localVars[DAMAGE_AMOUNT_KEY] = amount;
  await applyAtom(state, {
    type: '造成伤害时', source, target, amount, cardId, damageType,
  });
  amount = state.localVars[DAMAGE_AMOUNT_KEY] as number;

  // 时机3:受到伤害时(目标方减伤/防止:藤甲/白银狮子/天香/名士)
  state.localVars[DAMAGE_AMOUNT_KEY] = amount;
  const sufferResult = await applyAtom(state, {
    type: '受到伤害时', source, target, amount, cardId, damageType,
  });
  if (!sufferResult) {
    // 被 cancel(完全防止)→ 跳到伤害结算结束时,不执行 造成/受到伤害后、不扣血
    await applyAtom(state, {
      type: '伤害结算结束时', source, target, amount: 0, cardId, damageType,
    });
    await applyAtom(state, {
      type: '伤害结算结束后', source, target, amount: 0, cardId, damageType,
    });
    return;
  }
  amount = state.localVars[DAMAGE_AMOUNT_KEY] as number;

  // 时机4:扣减体力(模块 M 的子流程,含扣减前/时/扣减/后四时机)
  // 必须在 造成伤害后/受到伤害后 之前:旧 造成伤害 atom 先扣血再触发 after-hook,
  // 新流程同样保证 after-hook 看到扣血后的体力值。
  // 濒死检查延迟到 时机7(伤害结算结束时):避免濒死 pending 在 受到伤害后 的技能之前阻塞。
  if (amount > 0) {
    state.localVars[DAMAGE_FLOW_FLAG] = true;
    try {
      await runDecreaseLifeFlow(state, target, amount, source);
    } finally {
      delete state.localVars[DAMAGE_FLOW_FLAG];
    }
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
