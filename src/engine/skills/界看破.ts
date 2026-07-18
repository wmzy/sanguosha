// 界看破(界卧龙诸葛·转化技):
//   ① 你可以将一张黑色牌(手牌或装备区)当【无懈可击】使用。
//   ② 你的【无懈可击】不能被响应。
//
// OL 官方(hero)逐字:
//   "你可以将一张黑色牌当【无懈可击】使用。你的【无懈可击】不能被响应。"
//
// 与标版看破区别:
//   - 牌范围:界版"黑色牌"(含装备区),标版限定"黑色手牌"。
//   - 转化出的无懈"不能被响应":他人不可对此无懈再打出反无懈。
//     标版转化出的无懈仍可被反无懈(标准 close-reopen 流程)。
//
// 模型:
//   ① transform action(preceding,界看破.transform):黑色牌(手牌或装备)→
//        卸下(若装备)→ 当作 → 影子无懈。同标版看破 transform,但允许装备区。
//        转化执行后,在 localVars 打标记 `界看破/${shadowId}`=true,供 respond override 识别。
//   ② respond action(覆盖无懈可击.respond,仅本座次):区分界看破转化无懈 vs 实际无懈:
//        - 界看破转化的无懈:不设 已回应 标志 → 询问无懈可击 循环不再开新窗口(不可被响应)。
//        - 普通(实际)无懈:走标版行为(设 已回应=true → 循环开新窗口允许反无懈)。
//
// 覆盖机制:无懈可击在 DEFAULT_SKILLS 中,先实例化标版无懈.respond;界看破.onInit 后实例化,
//   registerAction('无懈可击', ownerId, 'respond', ...) 覆盖标版注册(同 key 覆盖)。
//   仅影响本座次(界卧龙诸葛)发出的无懈,其他座次仍走标版。
//
// 不可被响应机制(基于 close-reopen 的 询问无懈可击 循环):
//   询问无懈可击 while-loop 每轮:respondedKey=false → 请求回应 → 检查 respondedKey。
//   标版无懈 respond execute 设 respondedKey=true → 循环开新窗口(允许反无懈)。
//   界看破 respond execute 不设 respondedKey(保持 false)→ 循环 break(无新窗口)。
//   翻转 cancelKey(抵消状态)的逻辑两者一致;差异仅在是否触发 close-reopen。
import type { Card, EquipSlot, FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, findPendingSlot } from '../skill';
import { applyAtom } from '../create-engine';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界看破',
    description: '你可以将一张黑色牌当【无懈可击】使用;转化出的无懈不能被响应',
  };
}

/** 影子卡 id:${原id}#界看破 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#界看破`;
}

/** localVars 标记键:标明某 shadowId 是界看破转化的无懈(供 respond override 识别) */
function shadowMarkKey(shadowId: string): string {
  return `界看破/${shadowId}`;
}

/** 当前是否存在无懈可击广播窗口(玩家可回应) */
function hasNullifyWindow(state: GameState, playerId: number): boolean {
  for (const slot of state.pendingSlots.values()) {
    const atom = slot.atom as { type?: string; requestType?: string; target?: number };
    if (atom.type !== '请求回应') continue;
    if (atom.requestType !== '无懈可击') continue;
    // 广播型(target<0)或精确指向本玩家
    if (typeof atom.target === 'number' && (atom.target < 0 || atom.target === playerId))
      return true;
  }
  return false;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── transform action:黑色牌(手牌或装备)→ 影子无懈 ─────────────
  // 作为 preceding 在 无懈可击.respond(本座次被覆盖)之前执行。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 界看破不受自己回合限制(无懈可击任意时机可打),但需有无懈窗口且无其他阻塞
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
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      const self = state.players[ownerId];
      // 装备区黑色牌:先卸下到手牌(产生 ViewEvent,清除装备 vars),再走当作。
      const equipSlotEntry = Object.entries(self.equipment).find(([, id]) => id === cardId);
      if (equipSlotEntry) {
        const slot = equipSlotEntry[0] as EquipSlot;
        params['_origSlot'] = slot;
        await applyAtom(state, { type: '卸下', player: ownerId, slot });
      }
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '无懈可击',
      });
      // 标记此影子为界看破转化(供 respond override 识别 → 不可被响应)
      state.localVars[shadowMarkKey(shadowId)] = true;
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,牌还原,清标记)
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      const self = state.players[ownerId];
      const origSlot = params['_origSlot'] as EquipSlot | undefined;
      delete state.cardMap[sId];
      delete state.localVars[shadowMarkKey(sId)];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) {
        if (origSlot) {
          // 原是装备牌:从手牌移除影子,还原装备槽位
          self.hand.splice(idx, 1);
          self.equipment[origSlot] = cardId;
        } else {
          // 原是手牌:影子替换回原卡
          self.hand[idx] = cardId;
        }
      }
    },
  );

  // ─── respond override:覆盖标版无懈可击.respond,本座次走界版规则 ──
  // 界看破转化的无懈:不可被响应(不设 已回应=true → 询问无懈可击 循环不再开新窗口)。
  // 普通(实际)无懈:走标版行为(设 已回应=true → 循环开新窗口允许反无懈)。
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
      // 移无懈牌到弃牌堆(与标版一致)
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '弃牌堆' },
      });

      // 确定本次抵消的目标:从当前 broadcast slot 的 atom.cancelTarget 读取。
      const slot = findPendingSlot(state, ownerId);
      const cancelAtom = slot?.atom as { cancelTarget?: number } | undefined;
      const cancelTarget =
        typeof cancelAtom?.cancelTarget === 'number' ? cancelAtom.cancelTarget : -1;
      const cancelKey = `无懈/被抵消/${cancelTarget}`;

      // 翻转抵消状态(与标版一致):打出一张无懈 = 翻转当前锦囊对 cancelTarget 是否被抵消
      const cancelled = state.localVars[cancelKey] as boolean | undefined;
      state.localVars[cancelKey] = !cancelled;

      // 区分:界看破转化的无懈 vs 普通(实际)无懈。
      // 界看破转化:不设 已回应 → 询问无懈可击 循环 break(无新窗口 = 不可被响应)。
      // 普通无懈:设 已回应=true → 循环开新窗口允许反无懈(标版行为)。
      const isJieKanPo = state.localVars[shadowMarkKey(cardId)] === true;
      if (!isJieKanPo) {
        state.localVars[`无懈/已回应/${cancelTarget}`] = true;
      }
      // 清理标记(影子牌已入弃牌堆,标记无用)
      delete state.localVars[shadowMarkKey(cardId)];
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:界看破是转化技,defineAction 声明黑牌(手牌+装备)。
  // 前端 UI 流程:无懈可击窗口期间 → 选黑牌 → 点界看破按钮 →
  // 提交 preceding=[界看破.transform] + 主 action=无懈可击.respond(影子cardId)。
  // (主 action skillId 由 transform.name='无懈可击' 决定,后端无懈.respond 已被本座次界版覆盖。)
  api.defineAction('transform', {
    label: '界看破',
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择一张黑色牌(手牌或装备)当无懈可击使用',
      cardFilter: { filter: (c: Card) => c.color === '黑', min: 1, max: 1 },
    },
    transform: (card: Card) => ({
      name: '无懈可击',
      sourceCardId: card.id,
      fromSkill: skill.id,
    }),
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
  });

  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
