// 回合管理(系统级):
//   每玩家一个实例,负责回合/阶段的自动推进:
//   1) 监听上家 回合结束 → 若我是下家则启动我的回合
//   2) 监听 阶段结束 → 推进到下一阶段;自动阶段(准备/判定/摸牌)直接结束
//   3) 主动 end action:玩家在出牌阶段点"结束回合"
//   4) 主动 start action:仅主公位首次开局触发
import type { GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, hasBlockingPending, type SkillModule } from '../skill'

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

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
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

    // 出牌阶段:启动 __出牌 循环(fire-and-forget,不阻塞 hook)
    // 循环创建 __出牌 询问。玩家出牌(use action)会 resolve 当前询问,
    // 循环检查 phase 仍为 '出牌' 则重新创建。玩家点 end 或超时则 phase 改变,循环退出。
    // 必须不阻塞 hook:否则调用方的 await applyAtom(阶段结束) 永远不会 resolve
    // (如兵粮寸断的 阶段开始 before hook 在 cancel 前 await 阶段结束)。
    if (next === '出牌') {
      void (async () => {
        while (ctx.state.phase === '出牌') {
          await applyAtom(ctx.state, {
            type: '请求回应',
            requestType: '__出牌',
            target: player,
            prompt: { type: 'confirm', title: '出牌阶段' },
            timeout: 50,
          });
        }
      })();
      return;
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
  // 合法条件:自己的出牌或弃牌阶段,且无 pending 挂起(须先回应询问)
  registerAction(skill.id, ownerId, 'end', (state: GameState, _params: Record<string, Json>) => {
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌' || state.phase === '弃牌';
      const free = !hasBlockingPending(state)
      if (myTurn && inActPhase && free) return null;
      return '现在不能结束回合';
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const player = ownerId;

      await applyAtom(state, { type: '阶段结束', player, phase: '出牌' });
      await applyAtom(state, { type: '阶段结束', player, phase: '弃牌' });
      // 清理回合级标记(如 杀/killsPlayed)
      await applyAtom(state, { type: '清过期标记', player });
      // 推进 currentPlayerIndex 到下一家(必须在 回合结束 hook 之前:hook 会启动下家回合,
      // 进入 __出牌 循环并挂起;如果 下一玩家 在后面,currentPlayerIndex 永远不会被推进)
      await applyAtom(state, { type: '下一玩家' });
      // 触发所有 onAtomAfter('回合结束') 钩子——下家实例发现自己接手,启动回合
      await applyAtom(state, { type: '回合结束', player });
    }, );

  // ─── 首次开局(由主公位玩家触发)───
  // 合法条件:主公位(ownerId===0 且 currentPlayerIndex===0),处于初始准备阶段,且无 pending
  registerAction(skill.id, ownerId, 'start', (state: GameState, _params: Record<string, Json>) => {
      const isLordSeat = ownerId === 0 && state.currentPlayerIndex === 0;
      const atInitial = state.phase === '准备' && state.pendingSlots.size === 0;
      if (isLordSeat && atInitial) return null;
      return '现在不能开局';
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const player = ownerId;
      await applyAtom(state, { type: '回合开始', player });
      await applyAtom(state, { type: '阶段开始', player, phase: '准备' });
      // 触发阶段结束,让阶段推进钩子跑(准备→判定→摸牌→出牌)
      await applyAtom(state, { type: '阶段结束', player, phase: '准备' });
    }, );

  return () => {};
}

