// 回合管理(系统级):
//   每玩家一个实例,负责回合/阶段的自动推进:
//   1) 监听上家 回合结束 → 若我是下家则启动我的回合
//   2) 监听 阶段结束 → 推进到下一阶段;自动阶段(准备/判定/摸牌)直接结束
//   3) 主动 end action:玩家在出牌阶段点"结束回合"
//   4) 主动 start action:仅主公位首次开局触发
import type { GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

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

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '回合管理', description: '监听上家回合结束,自动开始自己的回合' };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  const me = skill.ownerId;

  // ─── 阶段结束 → 自动推进到下一阶段(自己回合内) ───
  registerAfterHook(skill.id, ownerId, '阶段结束', async (ctx) => {
    if (ctx.atom.type !== '阶段结束') return;
    const { player, phase } = ctx.atom;
    // 只让本回合所属玩家实例处理,避免和其他玩家的实例重复
    if (player !== me) return;

    const next = nextPhase(phase);
    if (!next) return;

    await applyAtom(ctx.state, { type: '阶段开始', player, phase: next });

    // 摸牌阶段自动摸 2 张
    if (next === '摸牌') {
      await applyAtom(ctx.state, { type: '摸牌', player, count: 2 });
    }

    // 弃牌阶段:检查手牌是否超过体力上限
    if (next === '弃牌') {
      const playerState = ctx.state.players[player];
      const handCount = playerState.hand.length;
      const maxHealth = playerState.maxHealth;
      if (handCount > maxHealth) {
        const excess = handCount - maxHealth;
        // 创建弃牌 pending,等玩家选择弃哪些牌
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: '__弃牌',
          target: player,
          prompt: {
            type: 'useCard',
            title: `弃牌阶段:需弃 ${excess} 张牌`,
            cardFilter: { filter: () => true, min: excess, max: excess },
          },
          timeout: 30,
        });
      }
    }

    // 自动阶段(准备/判定/摸牌)立即结束,推进到下一阶段
    if (next === '准备' || next === '判定' || next === '摸牌') {
      await applyAtom(ctx.state, { type: '阶段结束', player, phase: next });
    }
  });

  // ─── 上家回合结束 → 如果我是下一家,启动自己的回合 ───
  registerAfterHook(skill.id, ownerId, '回合结束', async (ctx) => {
    if (ctx.atom.type !== '回合结束') return;
    const finishedIndex = ctx.atom.player;
    const state = ctx.state;

    const nextIndex = findNextAlive(state, finishedIndex);
    // 不是我就跳过——只有轮到的玩家启动自己的回合
    if (nextIndex !== me) return;

    await applyAtom(ctx.state, { type: '回合开始', player: me });
    await applyAtom(ctx.state, { type: '阶段开始', player: me, phase: '准备' });
    // 触发阶段结束,让本实例的阶段推进钩子接着跑(准备→判定→摸牌→出牌)
    await applyAtom(ctx.state, { type: '阶段结束', player: me, phase: '准备' });
  });

  // ─── 主动结束回合 ───
  registerAction(skill.id, ownerId, 'end', (state: GameState, params: Record<string, Json>) => null, async (state: GameState, params: Record<string, Json>) => {
      
      const player = ownerId;

      await applyAtom(state, { type: '阶段结束', player, phase: '出牌' });
      await applyAtom(state, { type: '阶段结束', player, phase: '弃牌' });
      // 清理回合级标记(如 杀/killsPlayed)
      await applyAtom(state, { type: '清过期标记', player });
      // 触发所有 onAtomAfter('回合结束') 钩子——下家实例发现自己接手,启动回合
      await applyAtom(state, { type: '回合结束', player });
      // 推进 currentPlayerIndex 到下一家
      await applyAtom(state, { type: '下一玩家' });
    }, );

  // ─── 首次开局(由主公位玩家触发)───
  registerAction(skill.id, ownerId, 'start', (state: GameState, params: Record<string, Json>) => {
      if (state.currentPlayerIndex !== 0) return '只有主公位可以开局';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const player = ownerId;
      await applyAtom(state, { type: '回合开始', player });
      await applyAtom(state, { type: '阶段开始', player, phase: '准备' });
      // 触发阶段结束,让阶段推进钩子跑(准备→判定→摸牌→出牌)
      await applyAtom(state, { type: '阶段结束', player, phase: '准备' });
    }, );

  return () => {};
}

