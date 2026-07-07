// src/engine/skills/奇袭.ts
// 奇袭(甘宁·转化技):你可以将一张黑色牌当【过河拆桥】使用。
//
// 模型(组合 action,镜像火计/武圣):前端两步 UI(点奇袭给黑牌加"过河拆桥"显示 →
// 点过河拆桥选目标),提交时一个 ClientMessage:
//   preceding=[奇袭.transform] + 主 action=过河拆桥.use。
// 后端 dispatch 先执行 奇袭.transform(创建影子过河拆桥),再 过河拆桥.use validate
// 看到"过河拆桥"通过。过河拆桥技能零感知奇袭——它看到的永远是 cardMap 里的"过河拆桥"。
//
// 与火计/武圣的差异:黑色牌可以是手牌或装备区的牌(描述明确允许装备区黑色牌)。
//   - 手牌:直接用「当作」atom 转化。
//   - 装备牌:先「卸下」(装备区→手牌,产生 ViewEvent + 清除武器距离 vars),再用「当作」。
//     卸下保证 processedView 与 buildView 一致(直接 mutate equipment 会丢事件导致视图漂移)。
//
// 原牌归宿:影子过河拆桥入弃牌堆时,引擎按 shadowOf 还原为原卡(见 移动牌.apply),
// 因此无论原牌来自手牌还是装备区,最终都进入弃牌堆(满足"使用后原牌进入弃牌堆")。
// 奇袭出过河拆桥可被无懈可击抵消——由 过河拆桥.use 自身的 询问无懈可击 流程保证,
// 与转化来源无关。
import type { Card, EquipSlot, FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, hasBlockingPending } from '../skill';
import { applyAtom } from '../create-engine';
import { defaultPlayActive } from '../action-active';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '奇袭',
    description: '你可以将一张黑色牌当【过河拆桥】使用',
  };
}

/** 影子卡 id:${原id}#奇袭 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#奇袭`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把黑色牌(手牌/装备)转化为影子"过河拆桥"。
  // 作为 preceding 在 过河拆桥.use 之前执行。过河拆桥.validate 读 cardMap[影子id] 看到"过河拆桥"。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活 + 持有黑色牌
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const isBlack = !!card && card.color === '黑';
      // 黑色牌可以在手牌或装备区(描述:有黑色牌——手牌或装备区的牌)
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const cardInEquip = cardIdOk && Object.values(self.equipment).some((id) => id === cardId);
      const ok = myTurn && inActPhase && free && selfAlive && isBlack && (cardInHand || cardInEquip);
      return ok ? null : '现在不能使用奇袭';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      const self = state.players[ownerId];

      // 装备区的黑色牌:先卸下到手牌(产生 ViewEvent,清除武器距离 vars),
      // 再走「当作」(当作要求牌在手牌)。
      const equipSlotEntry = Object.entries(self.equipment).find(([, id]) => id === cardId);
      if (equipSlotEntry) {
        const slot = equipSlotEntry[0] as EquipSlot;
        params['_origSlot'] = slot;
        await applyAtom(state, { type: '卸下', player: ownerId, slot });
      }

      // 通过「当作」atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '过河拆桥',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,牌还原)
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      const self = state.players[ownerId];
      const origSlot = params['_origSlot'] as EquipSlot | undefined;

      // 删除影子卡
      delete state.cardMap[sId];
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
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:奇袭是转化技,defineAction 声明黑牌 + 目标。
  // 前端 UI 流程:选黑牌 → 选目标 → 点奇袭按钮 →
  // 提交 preceding=[奇袭.transform] + 主 action=过河拆桥.use。
  api.defineAction('transform', {
    label: '奇袭',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张黑色牌当过河拆桥使用',
      cardFilter: { filter: (c: Card) => c.color === '黑', min: 1, max: 1 },
      // 目标过滤与过河拆桥一致:其他角色即可(后端 validate 独立校验非自身/存活/有牌)
      targetFilter: { min: 1, max: 1 },
    },
    transform: (card: Card) => ({
      name: '过河拆桥',
      sourceCardId: card.id,
      fromSkill: skill.id,
    }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 手牌或装备区有黑色牌即可发动
      const hasBlackInHand = p.hand?.some((c) => c.color === '黑') ?? false;
      if (hasBlackInHand) return true;
      const equipIds = Object.values(p.equipment ?? {});
      const hasBlackEquip = equipIds.some((id) => {
        const card = id ? ctx.view.cardMap[id] : undefined;
        return card?.color === '黑';
      });
      return hasBlackEquip;
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../skill').SkillModule;
