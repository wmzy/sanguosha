// 界据守(界曹仁·主动技):结束阶段,你可以翻面并摸四张牌,然后弃置一张手牌
//   (若弃置的是装备牌则改为使用之)。
//
// 与标版据守的区别:
//   - 标版:翻面摸 3,跳过下一回合。
//   - 界版:翻面摸 4,然后弃置一张手牌(若为装备牌则装备之)。仍跳过下一回合。
//
// 实现(基于标版据守):
//   - use action:结束阶段发动 → 加翻面标签 + 摸 4 张 → 选一张手牌弃置/装备 → 标记已用。
//     前置校验/弃置装备步骤/respond 注册复用标版据守导出的共享核心
//     (validateJushouUse/jushouDiscardOrEquip/registerJushouDiscardRespond),
//     仅询问 requestType('界据守/弃牌')与弹窗标题前缀不同。
//   - 翻面标签触发下一回合跳过(机制与悲歌/放逐一致,before-hook 消费标签 + cancel 阶段)。
//   - 内部标签/localVars/requestType 键名保持原前缀 '据守/xxx'(不改为 '界据守/xxx')。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply'
import { popFrame, pushFrame } from '../core/frame';
import { flipFaceDown, flipFaceUp, performSkipTurn } from '../flows/face-down';
import { markOncePerTurn } from '../rules/once-per-turn';
import { registerAction, registerBeforeHook } from '../core/skill';
import {
  validateJushouUse,
  jushouDiscardOrEquip,
  registerJushouDiscardRespond,
} from './据守';

const SKIP_TAG = '据守/翻面';
const SKIP_FLAG = '据守/skipAll';
const USED_KEY = '据守/usedThisTurn';
const DISCARD_RT = '界据守/弃牌';
const DISCARD_PROMPT_TITLE = '界据守:选择一张手牌弃置(装备牌将改为使用)';

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
    (state: GameState, _params: Record<string, Json>) =>
      validateJushouUse(state, ownerId, { skipTag: SKIP_TAG }),
    async (state: GameState, _params: Record<string, Json>) => {
      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(state, ownerId, '据守');
      await pushFrame(state, '界据守', ownerId, {});
      try {
        // 翻面:加标签(下一回合开始时被消费)
        await flipFaceDown(state, ownerId, '据守');
        // 摸四张牌,然后弃置一张手牌(若为装备牌则改为使用之)(标/界共享)
        await applyAtom(state, { type: '摸牌', player: ownerId, count: 4 });
        await jushouDiscardOrEquip(state, ownerId, DISCARD_RT, DISCARD_PROMPT_TITLE);
      } finally {
        await popFrame(state);
      }
    },
  );

  // ── respond:玩家选择弃置/使用的手牌(标/界共享注册)──
  registerJushouDiscardRespond(state, skill.id, ownerId, DISCARD_RT);

  // ── 下一回合跳过:阶段开始(准备) before-hook ────────────
  // 检测翻面标签 → 移除标签 + 设 skipAll 标志 + cancel(不进入准备阶段)
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    const self = ctx.state.players[ownerId];

    // 入口:准备阶段开始 + 翻面标签 → 启动跳过
    if (atom.phase === '准备' && self?.tags.includes(SKIP_TAG)) {
      await flipFaceUp(ctx.state, ownerId, '据守');
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
    await performSkipTurn(ctx.state, ownerId);

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
