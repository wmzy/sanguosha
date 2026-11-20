// 看破(卧龙诸葛·转化技):你可以将一张黑色手牌当【无懈可击】使用。
//
// 模型(组合 action,镜像武圣但主 action 是 respond):
//   前端:无懈可击窗口期间,选黑牌 → 提交
//   preceding=[看破.transform] + 主 action=无懈可击.respond(影子cardId)。
//   后端 dispatch 先执行 看破.transform(创建影子无懈可击),再 无懈可击.respond
//   validate 检查 requestType='无懈可击' 且 card.name==='无懈可击' → 通过。
//   无懈可击技能零感知看破——它看到的永远是 cardMap 里的"无懈可击"。
//
// 五件套(影子 id 后缀=技能 id '看破'、当作、rollback、defineAction)由
// skillRuntime 工厂统一实现。看破不受自己回合限制(无懈可击任意时机可打),
// 故不走工厂默认时机维度——自定义 validate 逐字保留无懈窗口(共享
// hasNullifyWindow/blockedByOtherPending)与阻塞检查;activeWhen 检测无懈可击广播窗口且有黑牌。
//
// 本文件同时导出 createKanpoOptions 工厂(看破族共享 OPTIONS),界看破 复用之:
// 无懈窗口守卫/黑牌 cardFilter/广播窗口 activeWhen 前导逐字共享;持牌范围差异
// (标:仅手牌;界:含装备区)由 includeEquipment 参数表达(ownsCard 持有判定 +
// includeEquipment 卸下维度 + activeWhen 装备黑牌检测三处联动)。
import type { Card, FrontendAPI, GameState, Json, Skill, SkillModule } from '../types';
import { ownsCard } from '../util/player-query';
import {
  blockedByOtherPending,
  hasNullifyWindow,
  mountTransformAction,
  registerTransformAction,
  type TransformActionOptions,
} from '../util/skillRuntime';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '看破',
    description: '你可以将一张黑色手牌当【无懈可击】使用',
  };
}

/** 看破族(无懈转化技)差异参数 */
export interface KanpoOptions {
  /** 技能名(标 '看破' / 界 '界看破')——按钮 label 与拒绝文案前缀 */
  name: string;
  /** 选牌标题(界版注明含装备) */
  selectTitle: string;
  /** 界版:黑色牌包括装备区——持有判定用 ownsCard(手牌+装备)、转化走 includeEquipment
   *  卸下维度、activeWhen 检查装备黑牌;标版仅手牌(hand.includes / 手牌黑牌)。 */
  includeEquipment: boolean;
}

/** 看破族共享 OPTIONS:黑色牌→无懈可击转化。无懈窗口守卫(hasNullifyWindow +
 *  blockedByOtherPending)与黑牌 cardFilter 逐字共享;持牌范围差异由 opts 表达。 */
export function createKanpoOptions(opts: KanpoOptions): TransformActionOptions {
  return {
    outputName: '无懈可击',
    includeEquipment: opts.includeEquipment,
    // 看破族不受自己回合限制(无懈可击任意时机可打),但需有无懈窗口且无其他阻塞
    validate: (state: GameState, ownerId: number, params: Record<string, Json>) => {
      const self = state.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const owned = cardIdOk && (opts.includeEquipment ? ownsCard(self, cardId) : self.hand.includes(cardId));
      const isBlack = !!card && card.color === '黑';
      // 必须存在无懈可击窗口(否则转化出的无懈无处使用)
      const hasWindow = hasNullifyWindow(state, ownerId);
      // 无其他阻塞型 pending(转化不应打断正在进行的结算);无懈窗口本身是当前响应目标,允许
      const blockedByOther = blockedByOtherPending(state);
      const ok = owned && isBlack && hasWindow && !blockedByOther;
      return ok ? null : `现在不能使用${opts.name}`;
    },
    mount: {
      label: opts.name,
      style: 'passive',
      prompt: {
        type: 'useCard',
        title: opts.selectTitle,
        cardFilter: { filter: (c: Card) => c.color === '黑', min: 1, max: 1 },
      },
      activeWhen: (ctx) => {
        const view = ctx.view;
        const pending = view.pending;
        if (!pending) return false;
        // 无懈可击广播窗口:requestType='无懈可击'
        const atom = pending.atom as { type?: string; requestType?: string };
        if (atom.type !== '请求回应' || atom.requestType !== '无懈可击') return false;
        const p = view.players[ctx.perspectiveIdx];
        if (!p) return false;
        const hasBlackInHand = p.hand?.some((c) => c.color === '黑') ?? false;
        if (!opts.includeEquipment) return hasBlackInHand;
        // 界版:黑色牌包括手牌和装备区
        const hasBlackEquip = Object.values(p.equipment ?? {}).some((id) => {
          const card = id ? ctx.view.cardMap[id] : undefined;
          return card?.color === '黑';
        });
        return hasBlackInHand || hasBlackEquip;
      },
    },
  };
}

const OPTIONS: TransformActionOptions = createKanpoOptions({
  name: '看破',
  selectTitle: '选择一张黑色牌当无懈可击使用',
  includeEquipment: false,
});

export function onInit(skill: Skill, state: GameState): () => void {
  // transform action:把黑色手牌转化为影子"无懈可击"。
  // 作为 preceding 在 无懈可击.respond 之前执行。
  registerTransformAction(state, skill.id, skill.ownerId, OPTIONS);
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  mountTransformAction(api, skill.id, OPTIONS);
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
