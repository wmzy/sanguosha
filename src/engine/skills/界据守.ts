// 界据守(界曹仁·主动技):结束阶段,你可以翻面并摸四张牌,然后弃置一张手牌
//   (若弃置的是装备牌则改为使用之)。
//
// 与标版据守的区别:
//   - 标版:翻面摸 3,跳过下一回合。
//   - 界版:翻面摸 4,然后弃置一张手牌(若为装备牌则装备之)。仍跳过下一回合。
//
// 实现(基于标版据守):
//   - use action:结束阶段发动 → 加翻面标签 + 摸 4 张 → 选一张手牌弃置/装备 → 标记已用。
//   - 翻面标签触发下一回合跳过(机制与标版据守完全一致,before-hook 消费标签 + cancel 阶段)。
//   - 弃置/装备交互:use execute 内嵌 请求回应(requestType='据守/弃牌'),
//     玩家选一张手牌 → 若为装备牌则装备(含旧装备替换),否则弃置。
//   - 内部标签/localVars/requestType 键名保持原前缀 '据守/xxx'(不改为 '界据守/xxx')。
import type { EquipSlot, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn } from '../once-per-turn';
import { registerAction, registerBeforeHook, hasBlockingPending } from '../skill';
import { skillLoaders } from './index';

const SKIP_TAG = '据守/翻面';
const SKIP_FLAG = '据守/skipAll';
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
    name: '界据守',
    description: '结束阶段:翻面并摸四张牌,然后弃置一张手牌(装备牌改为使用之)',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── use:主动发动界据守 ────────────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, _params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inEndPhase = state.phase === '弃牌' || state.phase === '回合结束';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      // 已经翻面/已用过 → 不能再次发动
      const notSkipped = !self.tags.includes(SKIP_TAG);
      const notUsed = !usedThisTurn(state, ownerId, '据守');
      const ok = myTurn && inEndPhase && free && selfAlive && notSkipped && notUsed;
      return ok ? null : '现在不能发动据守';
    },
    async (state: GameState, _params: Record<string, Json>) => {
      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(state, ownerId, '据守');
      await pushFrame(state, '界据守', ownerId, {});
      try {
        // 翻面:加标签(下一回合开始时被消费)
        await applyAtom(state, { type: '加标签', player: ownerId, tag: SKIP_TAG });
        // 摸四张牌(界版变化:标版 3 → 界版 4)
        await applyAtom(state, { type: '摸牌', player: ownerId, count: 4 });

        // 界版新增:弃置一张手牌(若为装备牌则改为使用之)
        const self = state.players[ownerId];
        if (self.hand.length > 0) {
          delete state.localVars[DISCARD_CHOICE_KEY];
          await applyAtom(state, {
            type: '请求回应',
            requestType: DISCARD_RT,
            target: ownerId,
            prompt: {
              type: 'useCard',
              title: '界据守:选择一张手牌弃置(装备牌将改为使用)',
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

  // ── 下一回合跳过:阶段开始(准备) before-hook ────────────
  // 检测翻面标签 → 移除标签 + 设 skipAll 标志 + cancel(不进入准备阶段)
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    const self = ctx.state.players[ownerId];

    // 入口:准备阶段开始 + 翻面标签 → 启动跳过
    if (atom.phase === '准备' && self?.tags.includes(SKIP_TAG)) {
      await applyAtom(ctx.state, { type: '去标签', player: ownerId, tag: SKIP_TAG });
      ctx.state.localVars[SKIP_FLAG] = ownerId;
      return { kind: 'cancel' };
    }

    // skipAll 标志存在时,取消所有其他阶段(防止 phase-end after-hook 推进产生副作用)
    if (ctx.state.localVars[SKIP_FLAG] === ownerId) {
      return { kind: 'cancel' };
    }
  });

  // ── 阶段结束(准备) before-hook:skipAll 标志 → 主动推进回合 ──
  registerBeforeHook(state, skill.id, ownerId, '阶段结束', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段结束') return;
    if (atom.player !== ownerId) return;
    if (ctx.state.localVars[SKIP_FLAG] !== ownerId) return;

    // 清除 skipAll 标志(后续不再 skip)
    delete ctx.state.localVars[SKIP_FLAG];

    // 亲自执行 end-turn 序列:清过期标记 → 下一玩家 → 回合结束
    await applyAtom(ctx.state, { type: '清过期标记', player: ownerId });
    await applyAtom(ctx.state, { type: '下一玩家' });
    await applyAtom(ctx.state, { type: '回合结束', player: ownerId });

    return { kind: 'cancel' };
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '界据守',
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
