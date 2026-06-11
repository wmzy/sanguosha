// src/engine/skills/回合管理.ts
// 回合控制:每玩家一个实例,监听上家"回合结束"→启动自己回合
// 设计:见 docs/ENGINE-DESIGN.md §4.14
import type { BackendAPI, GameView, Json, SettlementFrame, Skill } from '../types';
import { registerSkillModule, type SkillModule } from '../skill';

const PHASE_ORDER = ['准备', '判定', '摸牌', '出牌', '弃牌', '回合结束'] as const;

function nextPhase(current: string): string | null {
  const idx = PHASE_ORDER.indexOf(current as typeof PHASE_ORDER[number]);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1];
}

/** 从 fromIndex 之后找第一个存活玩家的索引;全死亡时返回 fromIndex */
function findNextAlive(state: { players: { alive: boolean }[] }, fromIndex: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    if (state.players[idx].alive) return idx;
  }
  return fromIndex;
}

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '回合管理', description: '监听上家回合结束,自动开始自己的回合' };
}

export function onInit(skill: Skill, api: BackendAPI): () => void {
  const me = skill.ownerId;

  // ─── 阶段结束 → 自动推进到下一阶段(自己回合内) ───
  api.onAtomAfter('阶段结束', async (ctx) => {
    if (ctx.atom.type !== '阶段结束') return;
    const { player, phase } = ctx.atom;
    // 只让本回合所属玩家实例处理,避免和其他玩家的实例重复
    if (player !== me) return;

    const next = nextPhase(phase);
    if (!next) return;

    await ctx.api.apply({ type: '阶段开始', player, phase: next });

    // 摸牌阶段自动摸 2 张
    if (next === '摸牌') {
      await ctx.api.apply({ type: '摸牌', player, count: 2 });
    }

    // 自动阶段(准备/判定/摸牌)立即结束,推进到下一阶段
    if (next === '准备' || next === '判定' || next === '摸牌') {
      await ctx.api.apply({ type: '阶段结束', player, phase: next });
    }
  });

  // ─── 上家回合结束 → 如果我是下一家,启动自己的回合 ───
  api.onAtomAfter('回合结束', async (ctx) => {
    if (ctx.atom.type !== '回合结束') return;
    const finishedName = ctx.atom.player;
    const state = ctx.state;
    const finishedIndex = state.players.findIndex(p => p.name === finishedName);
    if (finishedIndex < 0) return;

    const nextIndex = findNextAlive(state, finishedIndex);
    const nextName = state.players[nextIndex].name;
    // 不是我就跳过——只有轮到的玩家启动自己的回合
    if (nextName !== me) return;

    await ctx.api.apply({ type: '回合开始', player: me });
    await ctx.api.apply({ type: '阶段开始', player: me, phase: '准备' });
    // 触发阶段结束,让本实例的阶段推进钩子接着跑(准备→判定→摸牌→出牌)
    await ctx.api.apply({ type: '阶段结束', player: me, phase: '准备' });
  });

  // ─── 主动结束回合 ───
  api.registerAction(
    'end',
    (_view: GameView, _params: Record<string, Json>) => null,
    async (frame: SettlementFrame) => {
      const player = frame.from;

      await api.apply({ type: '阶段结束', player, phase: '出牌' });
      await api.apply({ type: '阶段结束', player, phase: '弃牌' });
      // 清理回合级标记(如 杀/killsPlayed)
      await api.apply({ type: '清过期标记', player });
      // 触发所有 onAtomAfter('回合结束') 钩子——下家实例发现自己接手,启动回合
      await api.apply({ type: '回合结束', player });
      // 推进 currentPlayerIndex 到下一家
      await api.apply({ type: '下一玩家' });
    },
  );

  // ─── 首次开局(由主公位玩家触发)───
  api.registerAction(
    'start',
    (view: GameView) => {
      if (view.currentPlayerIndex !== 0) return '只有主公位可以开局';
      return null;
    },
    async (frame: SettlementFrame) => {
      const player = frame.from;
      await api.apply({ type: '回合开始', player });
      await api.apply({ type: '阶段开始', player, phase: '准备' });
      // 触发阶段结束,让阶段推进钩子跑(准备→判定→摸牌→出牌)
      await api.apply({ type: '阶段结束', player, phase: '准备' });
    },
  );

  return () => {};
}

export const module_回合管理: SkillModule = { createSkill, onInit };
registerSkillModule('回合管理', module_回合管理);
