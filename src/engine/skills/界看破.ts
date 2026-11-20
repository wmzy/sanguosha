// 界看破(界卧龙诸葛·转化技):
//   ① 你可以将一张黑色牌(手牌或装备区)当【无懈可击】使用。
//   ② 你的【无懈可击】不能被响应。
//
// OL 官方(hero)逐字:
//   "你可以将一张黑色牌当【无懈可击】使用。你的【无懈可击】不能被响应。"
//
// 与标版看破区别:
//   - 牌范围:界版"黑色牌"(含装备区),标版限定"黑色手牌"。
//   - 你的无懈"不能被响应":他人不可对你(界卧龙诸葛)使用的无懈再打出反无懈,
//     涵盖实际无懈牌与界看破转化的无懈。标版的无懈仍可被反无懈(标准 close-reopen)。
//
// 模型:
//   ① transform action(preceding,界看破.transform):黑色牌(手牌或装备)→
//        卸下(若装备,工厂 includeEquipment 维度)→ 当作 → 影子无懈。
//        五件套由 skillRuntime 工厂统一实现(影子 id 后缀=技能 id '界看破')。
//   ② respond action(覆盖标版无懈可击.respond,仅本座次):本座次发出的无懈
//        (界看破转化或实际无懈牌)一律传 skipCancelQuery=true → 不开反无懈窗口。
//        官方:"你的【无懈可击】不能被响应"——涵盖所有来源的无懈,不限转化。
//
// 覆盖机制:无懈可击在 DEFAULT_SKILLS 中,先实例化标版无懈.respond;界看破.onInit 后实例化,
//   registerAction('无懈可击', ownerId, 'respond', ...) 覆盖标版注册(同 key 覆盖)。
//   仅影响本座次(界卧龙诸葛)发出的无懈,其他座次仍走标版。
//
// 不可被响应机制:respond override 调 runUseFlow({skipCancelQuery:true}),runSettlementPhase
//   对无懈自身跳过 cancel(反无懈)询问 → 无懈必然生效(不被反无懈)。
//   询问抵消 close-reopen 循环:respond 设 已回应=true,无懈 resolve 设下层帧 cancelled=true →
//   循环检测到已抵消即退出(无新窗口)。
import type { FrontendAPI, GameState, Json, Skill, SkillModule } from '../types';
import { registerAction } from '../core/skill';
import { runUseFlow } from './cards/use-card';
import {
  mountTransformAction,
  registerTransformAction,
} from '../util/skillRuntime';
import { nullifyRespondValidate } from './cards/无懈可击';
import { createKanpoOptions } from './看破';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界看破',
    description: '你可以将一张黑色牌当【无懈可击】使用;你的【无懈可击】不能被响应',
  };
}

// OPTIONS 由 看破.ts 的 createKanpoOptions 共享工厂生成(无懈窗口守卫/黑牌
// cardFilter/activeWhen 前导与标版逐字共享);界版差异:黑色牌含装备区
// (includeEquipment=true:ownsCard 持有判定 + 卸下维度 + activeWhen 装备黑牌检测)。
const OPTIONS = createKanpoOptions({
  name: '界看破',
  selectTitle: '选择一张黑色牌(手牌或装备)当无懈可击使用',
  includeEquipment: true,
});

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── transform action:黑色牌(手牌或装备)→ 影子无懈 ─────────────
  // 作为 preceding 在 无懈可击.respond(本座次被覆盖)之前执行。
  registerTransformAction(state, skill.id, ownerId, OPTIONS);

  // ─── respond override:覆盖标版无懈可击.respond,本座次走界版规则 ──
  // 界看破转化的无懈:不可被响应（runUseFlow + skipCancelQuery=true）。
  // 普通(实际)无懈:走标版行为（runUseFlow 正常询问反无懈）。
  registerAction(
    state,
    '无懈可击',
    ownerId,
    'respond',
    // 校验同标版(单源:cards/无懈可击.ts 的 nullifyRespondValidate)
    (state: GameState, params: Record<string, Json>) =>
      nullifyRespondValidate(state, ownerId, params),
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      // 标记本次询问已 respond（询问抵消 循环据此决定是否退出）
      state.localVars['抵消/已回应'] = true;
      // 官方:"你的【无懈可击】不能被响应"——涵盖本座次所有来源的无懈
      // (界看破转化或实际无懈牌),故一律 skipCancelQuery=true,不开反无懈窗口。
      await runUseFlow(state, ownerId, cardId, [ownerId], '无懈可击', { skipCancelQuery: true });
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:界看破是转化技,defineAction 声明黑牌(手牌+装备)。
  // 前端 UI 流程:无懈可击窗口期间 → 选黑牌 → 点界看破按钮 →
  // 提交 preceding=[界看破.transform] + 主 action=无懈可击.respond(影子cardId)。
  // (主 action skillId 由 transform.name='无懈可击' 决定,后端无懈.respond 已被本座次界版覆盖。)
  mountTransformAction(api, skill.id, OPTIONS);
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
