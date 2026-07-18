// 过河拆桥(普通锦囊):
//   出牌阶段,对 1 名其他角色使用(无距离限制)。
//   弃置该角色区域内(手牌、装备区、判定区)的 1 张牌。
//
// 选牌交互(贴近面杀):
//   use 时不指定具体卡 → 移锦囊 → 询问无懈 → 弹选牌面板(pickTargetCard pending) →
//   使用者按区域选:装备/判定(明牌可见,直接选 cardId)或手牌(盲选第 K 张)。
//   手牌盲选是博弈核心:目标可偷偷调整顺序,使用者凭牌背位置推测。
//   重放确定性:盲选时在 actionLog 的当前条目前 splice "设置手牌顺序" 条目。
//   选牌面板逻辑见 ./选牌面板.ts(与顺手牵羊/反馈共用)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, validateUseCard } from '../skill';
import { 询问无懈可击 } from '../无懈可击';
import { runPickTargetCardPanel } from './选牌面板';
import { QICAI_PROTECTED_SLOTS } from './界奇才';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '过河拆桥', description: '锦囊:弃置目标一张牌' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      return (
        validateUseCard(state, ownerId, params, { cardName: '过河拆桥', requireTarget: true }) ??
        (() => {
          const targets = params.targets as number[] | undefined;
          if (!Array.isArray(targets) || targets.length === 0) return '目标不合法';
          for (const t of targets) {
            if (t === ownerId) return '不能对自己使用';
            if (!state.players[t]?.alive) return '目标已死亡';
            const p = state.players[t];
            if (!p) return '目标不合法';
            // 奇才(界黄月英):防具/宝物均不可被弃置,按槽位过滤后判断是否有可弃置的牌
            const discardableEquip = Object.keys(p.equipment).filter((slot) => {
              const protectTag = QICAI_PROTECTED_SLOTS[slot];
              return !protectTag || !p.tags.includes(protectTag);
            });
            const hasCards =
              p.hand.length > 0 ||
              discardableEquip.length > 0 ||
              p.pendingTricks.length > 0;
            if (!hasCards) return '目标无可弃置的牌';
          }
          return null;
        })()
      );
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      await pushFrame(state, '过河拆桥', from, { ...params });
      const cardId = params.cardId as string;
      const target = (params.targets as number[])?.[0] ?? (params.target as number);
      // 移锦囊到处理区
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '处理区' },
      });
      // 询问无懈可击(单目标锦囊:抵消整个锦囊)
      try {
        const cancelled = await 询问无懈可击(state, target);
        if (!cancelled) {
          const targetPlayer = state.players[target];
          if (targetPlayer) {
            // 弹选牌面板:使用者从目标区域选一张牌弃置
            await runPickTargetCardPanel(state, from, target, targetPlayer, {
              mode: 'discard',
              requestType: '过河拆桥_选牌',
              title: '选择弃置的目标牌',
            });
          }
        }
        // 移锦囊到弃牌堆
        await applyAtom(state, {
          type: '移动牌',
          cardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      } finally {
        if (frameCards(state).includes(cardId)) {
          await applyAtom(state, {
            type: '移动牌',
            cardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
        }
        await popFrame(state);
      }
    },
  );

  // ── 选牌 respond:使用者从目标区域选一张牌 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是选牌窗口';
      const atom = slot.atom as { requestType?: string; prompt?: { target?: number } };
      if (atom.requestType !== '过河拆桥_选牌') return '当前不是选牌窗口';
      const zone = params.zone;
      if (zone === 'equipment' || zone === 'judge') {
        if (typeof params.cardId !== 'string') return 'cardId required';
      } else if (zone === 'hand') {
        if (typeof params.handIndex !== 'number') return 'handIndex required';
      } else {
        return 'zone required (equipment|judge|hand)';
      }
      // 防御性检查:装备区选牌时,拒绝要选受奇才保护的防具/宝物
      // (前端选牌面板已过滤,此为 server-side trust boundary 校验)
      if (zone === 'equipment' && typeof params.cardId === 'string') {
        const targetIdx = atom.prompt?.target;
        if (typeof targetIdx === 'number') {
          const targetPlayer = state.players[targetIdx];
          if (targetPlayer) {
            const slotEntry = Object.entries(targetPlayer.equipment).find(
              ([, id]) => id === params.cardId,
            );
            if (slotEntry) {
              const protectTag = QICAI_PROTECTED_SLOTS[slotEntry[0]];
              if (protectTag && targetPlayer.tags.includes(protectTag))
                return '该装备受奇才保护,不可弃置';
            }
          }
        }
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      state.localVars['选牌/结果'] = {
        zone: params.zone,
        cardId: params.cardId ?? null,
        handIndex: params.handIndex ?? null,
      };
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '过河拆桥',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '过河拆桥',
      cardFilter: { filter: (c) => c.name === '过河拆桥', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
  });
}
