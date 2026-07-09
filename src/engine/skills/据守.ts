// src/engine/skills/据守.ts
// 据守(曹仁·主动技):结束阶段,你可以翻面并摸三张牌,然后跳过你的下一回合。
//
// 实现:
//   - use action:在 弃牌/回合结束 阶段发动 → 加 翻面 标签 + 摸 3 张 + 标记本回合已用。
//   - 翻面标签触发下一回合跳过:
//     阶段开始(准备) before-hook 检测标签 → 移除标签 + 设 skipAll 标志 + cancel;
//     阶段开始(*):skipAll 标志存在时 cancel 所有阶段;
//     阶段结束(准备):skipAll 标志存在时,清除标志 + 主动推进回合(清过期标记 + 下一玩家 + 回合结束),
//       避免 回合管理 的 phase-end after-hook 在 cancel 后继续推进产生"幻影阶段链"。
//
// 跳过整回合的手法说明:据守 cancel 自己回合的所有 阶段开始/阶段结束(准备),
// 并在 阶段结束(准备) before-hook 中亲自执行 end-turn 序列(清过期标记 + 下一玩家 + 回合结束),
// 把回合交给下家。回合管理的 回合结束 after-hook 据此启动下家回合。
// 这样做的副作用:本座次在据守触发回合的 phase-end 链不会消费任何摸牌/出牌/弃牌副作用。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn } from '../once-per-turn';
import { registerAction, registerBeforeHook, hasBlockingPending } from '../skill';

const SKIP_TAG = '据守/翻面';
const SKIP_FLAG = '据守/skipAll';
const USED_KEY = '据守/usedThisTurn';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '据守',
    description: '结束阶段:翻面并摸三张牌,然后跳过你的下一回合',
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
      // 已经翻面/已用过 → 不能再次发动
      const notSkipped = !self.tags.includes(SKIP_TAG);
      const notUsed = !usedThisTurn(state, ownerId, '据守');
      const ok = myTurn && inEndPhase && free && selfAlive && notSkipped && notUsed;
      return ok ? null : '现在不能发动据守';
    },
    async (state: GameState, _params: Record<string, Json>) => {
      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(state, ownerId, '据守');
      await pushFrame(state, '据守', ownerId, {});
      try {
        // 翻面:加标签(下一回合开始时被消费)
        await applyAtom(state, { type: '加标签', player: ownerId, tag: SKIP_TAG });
        // 摸三张牌
        await applyAtom(state, { type: '摸牌', player: ownerId, count: 3 });
      } finally {
        await popFrame(state);
      }
    },
  );

  // ── 下一回合跳过:阶段开始(准备) before-hook ────────────
  // 检测翻面标签 → 移除标签 + 设 skipAll 标志 + cancel(不进入准备阶段)
  registerBeforeHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom as { type: string; player: number; phase: string };
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
  // 这是据守触发回合中,外层 回合结束(prev) 的 回合管理 hook 主动调用的
  //   applyAtom(阶段结束, me, 准备)。
  // 我们 cancel 它(防止 phase-end after-hook 推进阶段链),
  // 并亲自执行 end-turn 序列把回合交给下家。
  registerBeforeHook(state, skill.id, ownerId, '阶段结束', async (ctx) => {
    const atom = ctx.atom as { type: string; player: number; phase: string };
    if (atom.type !== '阶段结束') return;
    if (atom.player !== ownerId) return;
    if (ctx.state.localVars[SKIP_FLAG] !== ownerId) return;

    // 清除 skipAll 标志(后续不再 skip)
    delete ctx.state.localVars[SKIP_FLAG];

    // 亲自执行 end-turn 序列:清过期标记 → 下一玩家 → 回合结束
    // (与 回合管理.end action 一致,但跳过了 阶段结束(出牌/弃牌)——据守在此前已 cancel)
    await applyAtom(ctx.state, { type: '清过期标记', player: ownerId });
    await applyAtom(ctx.state, { type: '下一玩家' });
    await applyAtom(ctx.state, { type: '回合结束', player: ownerId });

    return { kind: 'cancel' };
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '据守',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动据守?(翻面摸三张,跳过下一回合)',
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
