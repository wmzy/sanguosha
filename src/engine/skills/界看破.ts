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
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, findPendingSlot } from '../core/skill';
import { runUseFlow } from './cards/use-card';
import {
  hasNullifyWindow,
  mountTransformAction,
  registerTransformAction,
  type TransformActionOptions,
} from '../util/skillRuntime';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界看破',
    description: '你可以将一张黑色牌当【无懈可击】使用;你的【无懈可击】不能被响应',
  };
}

const OPTIONS: TransformActionOptions = {
  outputName: '无懈可击',
  // 界版"黑色牌"包括装备区:转化时先卸下到手牌再「当作」(工厂 includeEquipment 维度;
  // rollback 还原槽位与武器距离 vars)
  includeEquipment: true,
  // 界看破不受自己回合限制(无懈可击任意时机可打),但需有无懈窗口且无其他阻塞
  validate: (state: GameState, ownerId: number, params: Record<string, Json>) => {
    const self = state.players[ownerId];
    if (!self?.alive) return '玩家不存在或已死亡';
    const cardId = params.cardId as string;
    const cardIdOk = typeof cardId === 'string';
    const card = cardIdOk ? state.cardMap[cardId] : undefined;
    const cardInHand = cardIdOk && self.hand.includes(cardId);
    const cardInEquip =
      cardIdOk && Object.values(self.equipment).some((id) => id === cardId);
    const isBlack = !!card && card.color === '黑';
    // 必须存在无懈可击窗口(否则转化出的无懈无处使用)
    const hasWindow = hasNullifyWindow(state, ownerId);
    // 无其他阻塞型 pending(转化不应打断正在进行的结算);无懈窗口本身是当前响应目标,允许
    const blockedByOther = (() => {
      for (const slot of state.pendingSlots.values()) {
        const atom = slot.atom as { type?: string; requestType?: string };
        if (!slot.isBlocking) continue;
        if (atom.type === '请求回应' && atom.requestType === '无懈可击') continue;
        return true;
      }
      return false;
    })();
    const ok = (cardInHand || cardInEquip) && isBlack && hasWindow && !blockedByOther;
    return ok ? null : '现在不能使用界看破';
  },
  mount: {
    label: '界看破',
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择一张黑色牌(手牌或装备)当无懈可击使用',
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
      // 界版:黑色牌包括手牌和装备区
      const hasBlackInHand = p.hand?.some((c) => c.color === '黑') ?? false;
      const hasBlackEquip = Object.values(p.equipment ?? {}).some((id) => {
        const card = id ? ctx.view.cardMap[id] : undefined;
        return card?.color === '黑';
      });
      return hasBlackInHand || hasBlackEquip;
    },
  },
};

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
    (state: GameState, params: Record<string, Json>) => {
      // 校验同标版:无懈窗口 + 无懈牌
      const slot = findPendingSlot(state, ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是无懈可击窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '无懈可击') return '当前不是无懈可击窗口';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      const self = state.players[ownerId];
      if (!self.alive) return '你已死亡';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      const card = state.cardMap[cardId];
      if (card.name !== '无懈可击') return '只能打出无懈可击';
      return null;
    },
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

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
