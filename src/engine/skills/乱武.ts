// 乱武(贾诩·群·限定技):出牌阶段,你可以令所有其他角色依次对与其距离最近的另一名角色
//   使用一张【杀】,无法如此做者失去1点体力。
//
// 实现:
//   - use action(主动,限定技):出牌阶段、自己回合、无阻塞 pending、存活、未使用过。
//     立即标记 player.vars['乱武/used']=true(限定技,整局一次,防重入)。
//   - 从贾诩下家起,按座次依次遍历每个其他存活角色 P:
//       1. 计算 P 到所有其他存活角色(含贾诩)的有效距离,取最小者 → "最近角色"集合。
//       2. 请求回应('乱武/出杀', target=P):选一张【杀】+ 一名最近角色为目标。
//       3. P 打出有效【杀】+合法目标 → 以 P 为 source 走完整杀结算
//          (指定目标→成为目标→检测有效性→询问闪→伤害/抵消),不计入出杀次数。
//       4. 否则(无杀/超时/pass)→ 失去体力 1。
//   - respond action 注册到每个座次:被问询者非贾诩,须按座次注册才能被 dispatch 路由。
//     onInit 返回合并卸载函数,保证卸载 乱武 实例时清理所有座次的 respond 注册
//     (unloadSkillInstance 仅按 (skillId,贾诩座次) 清 action,清不到其他座次)。
//
// 关键点:
//   - "另一名角色"含贾诩——贾诩可作为最近目标被指定。
//   - 距离最近:effectiveDistance 最小者;并列时由该角色自选(前端 targetFilter 提示,
//     后端 respond validate 权威校验)。
//   - 强制出的杀不计入 turn.vars['杀/quota'](技能效果,非主动出杀,不调 incSlashUsed)。
//   - "无法如此做"按 pass/超时 = 失去 1 体力(描述语义:无杀或不出即失血)。
//   - 限定技标记用 player.vars(整局永久),非 turn.vars。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction, hasBlockingPending } from '../skill';
import { effectiveDistance } from '../distance';

const USED_KEY = '乱武/used';
const CHOICE_VAR = '乱武/出杀';
const REQUEST_TYPE = '乱武/出杀';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '乱武',
    description: '限定技:出牌阶段令所有其他角色依次对距离最近者出杀,无法如此做者失去1点体力',
  };
}

/** P 的"距离最近的另一名角色"集合(存活,含贾诩) */
function nearestOthers(state: GameState, p: number): number[] {
  let min = Infinity;
  const dist = new Map<number, number>();
  for (let i = 0; i < state.players.length; i++) {
    if (i === p) continue;
    if (!state.players[i]?.alive) continue;
    const d = effectiveDistance(state, p, i);
    dist.set(i, d);
    if (d < min) min = d;
  }
  const result: number[] = [];
  for (const [i, d] of dist) {
    if (d === min) result.push(i);
  }
  return result;
}

/** 以 source 对 target 走一次完整杀结算(实体杀牌),不计入出杀次数 */
async function resolveForcedSlash(
  state: GameState,
  source: number,
  target: number,
  cardId: string,
): Promise<void> {
  await pushFrame(state, '乱武', source, { forcedSlashCardId: cardId, forcedTarget: target });
  try {
    // 杀牌进处理区
    await applyAtom(state, {
      type: '移动牌',
      cardId,
      from: { zone: '手牌', player: source },
      to: { zone: '处理区' },
    });
    await applyAtom(state, { type: '指定目标', source, target, cardId });
    const became = await applyAtom(state, { type: '成为目标', source, target, cardId });
    if (became) {
      const valid = await applyAtom(state, { type: '检测有效性', source, target, cardId });
      if (valid) {
        await applyAtom(state, { type: '询问闪', target, source });
        const dodgeIds = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
        if (dodgeIds.length > 0) {
          await applyAtom(state, { type: '被抵消', source, target, cardId });
          for (const dId of dodgeIds) {
            await applyAtom(state, {
              type: '移动牌',
              cardId: dId,
              from: { zone: '处理区' },
              to: { zone: '弃牌堆' },
            });
          }
        } else if (state.players[target]?.alive) {
          await applyAtom(state, { type: '造成伤害', target, amount: 1, source, cardId });
        }
      }
    }
    // 杀牌移出处理区→弃牌堆
    if (frameCards(state).includes(cardId)) {
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    }
  } finally {
    await popFrame(state);
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── use(贾诩主动发动)──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (st: GameState, _params: Record<string, Json>): string | null => {
        if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
        if (st.phase !== '出牌') return '只能在出牌阶段发动';
        if (hasBlockingPending(st)) return '当前有未完成的询问';
        if (st.players[ownerId]?.vars[USED_KEY]) return '乱武已使用过(限定技)';
        if (!st.players[ownerId]?.alive) return '玩家不存在或已死亡';
        // 至少需要 1 名其他存活角色才有意义
        const others = st.players.filter((p) => p.alive && p.index !== ownerId);
        if (others.length === 0) return '场上没有其他角色';
        return null;
      },
      async (st: GameState, _params: Record<string, Json>) => {
        const from = ownerId;
        // 限定技标记:第一个 await 前设置,防 dispatch 重入
        st.players[from].vars[USED_KEY] = true;
        await pushFrame(state, '乱武', from, {});
        try {
          const n = st.players.length;
          // 从贾诩下家起,按座次依次处理每个其他存活角色
          for (let step = 1; step < n; step++) {
            const p = (from + step) % n;
            if (p === from) continue;
            if (!st.players[p]?.alive) continue;

            const nearest = nearestOthers(st, p);
            if (nearest.length === 0) {
              // 无其他存活角色 → 无法如此做
              await applyAtom(st, { type: '失去体力', target: p, amount: 1 });
              continue;
            }

            delete st.localVars[CHOICE_VAR];
            await applyAtom(st, {
              type: '请求回应',
              requestType: REQUEST_TYPE,
              target: p,
              prompt: {
                type: 'useCardAndTarget',
                title: `乱武:对距离最近的角色使用一张【杀】,否则失去1点体力`,
                cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
                targetFilter: { min: 1, max: 1, filter: (_view, t: number) => nearest.includes(t) },
              },
              timeout: 20,
            });

            const choice = st.localVars[CHOICE_VAR] as
              | { cardId: string; target: number }
              | undefined;
            delete st.localVars[CHOICE_VAR];
            // 二次校验:手牌仍持有 + 目标仍在最近集合(防止超时兜底/竞态)
            if (
              choice &&
              st.players[p].hand.includes(choice.cardId) &&
              nearestOthers(st, p).includes(choice.target) &&
              st.players[choice.target]?.alive
            ) {
              await resolveForcedSlash(st, p, choice.target, choice.cardId);
            } else {
              await applyAtom(st, { type: '失去体力', target: p, amount: 1 });
            }
          }
        } finally {
          await popFrame(state);
        }
      },
    ),
  );

  // ── respond(注册到每个座次:被乱武问询的角色选杀+最近目标)──
  for (const pl of state.players) {
    const seat = pl.index;
    unloaders.push(
      registerAction(
        state,
        skill.id,
        seat,
        'respond',
        (st: GameState, params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(seat);
          if (!slot) return '当前不需要回应';
          const atom = slot.atom as { requestType?: string };
          if (atom.requestType !== REQUEST_TYPE) return '当前不是乱武询问';
          const cardId = params.cardId as string | undefined;
          const target = params.target as number | undefined;
          if (typeof cardId !== 'string') return '请选择一张杀';
          if (typeof target !== 'number') return '请选择目标';
          const self = st.players[seat];
          if (!self?.hand.includes(cardId)) return '牌不在手牌中';
          if (st.cardMap[cardId]?.name !== '杀') return '只能使用杀';
          if (!nearestOthers(st, seat).includes(target)) return '目标不是距离最近的角色';
          return null;
        },
        async (st: GameState, params: Record<string, Json>) => {
          st.localVars[CHOICE_VAR] = {
            cardId: params.cardId as string,
            target: params.target as number,
          };
        },
      ),
    );
  }

  return () => {
    for (const u of unloaders) u();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '乱武',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '乱武(限定技):令所有其他角色依次对距离最近者出杀,无法如此做者失去1点体力',
    },
    activeWhen: (ctx) => defaultPlayActive(ctx),
  });
  // respond:被乱武问询的角色选杀+最近目标。前端按 pending prompt 渲染。
  api.defineAction('respond', {
    label: '出杀',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '乱武:对距离最近的角色使用一张【杀】,否则失去1点体力',
      cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
  });
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
