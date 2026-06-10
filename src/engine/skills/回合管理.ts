// src/engine/skills/回合管理.ts
// 回合阶段自动推进:准备→判定→摸牌(摸2张)→出牌
// 玩家在出牌阶段可主动"结束回合",推进到弃牌→回合结束→下一玩家
import type { BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

const PHASE_ORDER = ['准备', '判定', '摸牌', '出牌', '弃牌', '回合结束'] as const;

function nextPhase(current: string): string | null {
  const idx = PHASE_ORDER.indexOf(current as typeof PHASE_ORDER[number]);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1];
}

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '回合管理', description: '自动推进回合阶段' };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  void skill; // 回合管理是全局技能,不依赖 ownerId

  // ─── 阶段结束 → 自动推进到下一阶段 ───
  api.onAtomAfter('阶段结束', async (ctx) => {
    if (ctx.atom.type !== '阶段结束') return;
    const { player, phase } = ctx.atom;
    // 只让阶段所属玩家的实例处理(避免重复调用)
    if (ctx.self !== player) return;

    const next = nextPhase(phase);
    if (!next) return;

    // 推进到下一阶段
    await ctx.apply({ type: '阶段开始', player, phase: next });

    // 摸牌阶段自动摸 2 张
    if (next === '摸牌') {
      await ctx.apply({ type: '摸牌', player, count: 2 });
    }

    // 自动阶段(准备/判定/摸牌)立即触发阶段结束,推进到下一阶段
    // 出牌/弃牌需要玩家操作,不自动结束
    if (next === '准备' || next === '判定' || next === '摸牌') {
      await ctx.apply({ type: '阶段结束', player, phase: next });
    }
  });

  // ─── 游戏开始 → 触发第一次回合 ───
  api.registerAction(
    'start',
    () => null,
    async (frame: SettlementFrame) => {
      const player = frame.from;
      await frame.apply({ type: '回合开始', player });
      await frame.apply({ type: '阶段开始', player, phase: '准备' });
      // 触发阶段结束,让 afterHook 自动推进到下一阶段
      await frame.apply({ type: '阶段结束', player, phase: '准备' });
    },
  );

  // ─── 玩家主动结束回合 ───
  api.registerAction(
    'end',
    (_view: GameView, _params: Record<string, Json>) => {
      return null; // 始终允许
    },
    async (frame: SettlementFrame) => {
      const player = frame.from;

      // 出牌阶段结束 → 弃牌
      await frame.apply({ type: '阶段结束', player, phase: '出牌' });
      // 弃牌阶段(暂跳过弃牌逻辑)
      await frame.apply({ type: '阶段结束', player, phase: '弃牌' });
      // 回合结束
      await frame.apply({ type: '回合结束', player });
      // 下一玩家
      await frame.apply({ type: '下一玩家' });
      // 回合结束 hook 会自动处理回合开始 + 准备阶段
    },
  );

  // ─── 回合结束 → 自动开始下一玩家的回合 ───
  api.onAtomAfter('回合结束', async (ctx) => {
    // 回合结束后,下一玩家 atom 已经在 action 里 apply 了
    // 这里处理回合开始 + 准备阶段
    const state = ctx.state;
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (currentPlayer) {
      await ctx.apply({ type: '回合开始', player: currentPlayer.name });
      await ctx.apply({ type: '阶段开始', player: currentPlayer.name, phase: '准备' });
    }
  });

  return () => {};
}

export const module_回合管理: SkillModule = { createSkill, onInit };
registerSkillModule('回合管理', module_回合管理);
