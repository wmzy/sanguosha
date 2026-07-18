// src/engine/skills/据守.ts
// 据守(曹仁·主动技):结束阶段,你可以翻面并摸四张牌,
//   然后弃置一张手牌(若为装备牌则改为使用之)。
//
// 对齐官方 hero/29 现行描述(OL 加强版)。
//
// 实现差异说明:
//   - 旧版(本文件历史实现):翻面摸 3 + 跳过整回合。
//   - 新版(本实现,对齐 OL 加强版):摸 4 + 弃 1 手牌(装备牌则使用之)。
//     "翻面"在 OL 加强版中不实际产生跳过整回合的效果——为保持与本引擎
//     "翻面=跳过下一回合"语义解耦,本实现不添加 '据守/翻面' 标签,
//     故不会触发 skipAll/skipTurn 行为(对齐 OL 加强版"不跳过整回合"规则)。
//
// 实现:
//   - use action:结束阶段(弃牌 / 回合结束)发动 → 摸 4 张 →
//     选一张手牌弃置/装备 → 标记已用。
//   - 弃置/装备交互:use execute 内嵌 请求回应(requestType='据守/弃牌'),
//     玩家选一张手牌 → 若为装备牌则装备(含旧装备替换),否则弃置。
//   - 无手牌时跳过弃置/装备步骤(规则要求弃一张手牌,无手牌则免)。
//
// 注:界曹仁的界据守(独立文件)仍保留"翻面+跳过下一回合"机制,与本标版规则不同。
import type { EquipSlot, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending } from '../skill';
import { skillLoaders } from './index';

const USED_KEY = '据守/usedThisTurn';
const DISCARD_RT = '据守/弃牌';
const DISCARD_CHOICE_KEY = '据守/discardChoice';

/** 装备牌 subtype → 装备栏位(与 装备 atom 的 inferSlot 一致) */
function slotOf(card: { subtype?: string } | undefined): EquipSlot | null {
  switch (card?.subtype) {
    case '武器':
      return '武器';
    case '防具':
      return '防具';
    case '进攻马':
      return '进攻马';
    case '防御马':
      return '防御马';
    case '宝物':
      return '宝物';
    default:
      return null;
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '据守',
    description: '结束阶段:翻面并摸四张牌,然后弃置一张手牌(装备牌改为使用之)',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── use:主动发动据守 ────────────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, _params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      // 发动时机:结束阶段(弃牌 或 回合结束 阶段)
      const inEndPhase = state.phase === '弃牌' || state.phase === '回合结束';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const notUsed = !usedThisTurn(state, ownerId, '据守');
      const ok = myTurn && inEndPhase && free && selfAlive && notUsed;
      return ok ? null : '现在不能发动据守';
    },
    async (state: GameState, _params: Record<string, Json>) => {
      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(state, ownerId, '据守');
      await pushFrame(state, '据守', ownerId, {});
      try {
        // 摸四张牌(OL 加强版)
        await applyAtom(state, { type: '摸牌', player: ownerId, count: 4 });

        // 然后弃置一张手牌(若为装备牌则改为使用之)
        const self = state.players[ownerId];
        if (self.hand.length > 0) {
          delete state.localVars[DISCARD_CHOICE_KEY];
          await applyAtom(state, {
            type: '请求回应',
            requestType: DISCARD_RT,
            target: ownerId,
            prompt: {
              type: 'useCard',
              title: '据守:选择一张手牌弃置(装备牌将改为使用)',
              cardFilter: { filter: () => true, min: 1, max: 1 },
            },
            defaultChoice: self.hand[0],
            timeout: 20,
          });
          const chosenId = state.localVars[DISCARD_CHOICE_KEY] as string | undefined;
          delete state.localVars[DISCARD_CHOICE_KEY];
          if (chosenId && self.hand.includes(chosenId)) {
            const card = state.cardMap[chosenId];
            const slot = slotOf(card);
            if (card?.type === '装备牌' && slot) {
              // 装备牌:使用之(替换旧装备,逻辑同 装备通用)
              const currentEquip = state.players[ownerId].equipment[slot];
              if (currentEquip) {
                const oldCard = state.cardMap[currentEquip];
                if (oldCard?.name && skillLoaders[oldCard.name]) {
                  await applyAtom(state, {
                    type: '移除技能',
                    player: ownerId,
                    skillId: oldCard.name,
                  });
                }
                await applyAtom(state, { type: '卸下', player: ownerId, slot });
                await applyAtom(state, {
                  type: '移动牌',
                  cardId: currentEquip,
                  from: { zone: '手牌', player: ownerId },
                  to: { zone: '弃牌堆' },
                });
              }
              await applyAtom(state, { type: '装备', player: ownerId, cardId: chosenId });
              if (card?.name && skillLoaders[card.name]) {
                await applyAtom(state, {
                  type: '添加技能',
                  player: ownerId,
                  skillId: card.name,
                });
              }
            } else {
              // 非装备牌:弃置
              await applyAtom(state, { type: '弃置', player: ownerId, cardIds: [chosenId] });
            }
          }
        }
      } finally {
        await popFrame(state);
      }
    },
  );

  // ── respond:玩家选择弃置/使用的手牌 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s: GameState, _params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是选牌窗口';
      const rt = (slot.atom as { requestType?: string }).requestType;
      if (rt !== DISCARD_RT) return '当前不是据守弃牌窗口';
      return null;
    },
    async (s: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      if (typeof cardId === 'string') {
        s.localVars[DISCARD_CHOICE_KEY] = cardId;
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '据守',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动据守?(翻面摸四张,然后弃置一张手牌)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
    activeWhen: (ctx) => {
      if (ctx.view.currentPlayerIndex !== ctx.perspectiveIdx) return false;
      const phase = ctx.view.phase;
      if (phase !== '弃牌' && phase !== '回合结束') return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      if (p.turnUsage?.[USED_KEY]) return false;
      return true;
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
