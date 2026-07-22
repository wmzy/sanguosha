// 界乱武(界贾诩·群·限定技,OL 界限突破官方逐字):
//   "限定技,出牌阶段,你可以令所有其他角色依次选择一项:1.对其距离最小的另一名角色
//    使用一张【杀】;2.失去1点体力。所有角色结算完毕后,你可以视为使用一张无距离
//    限制的【杀】。"
//
// 与标版乱武(src/engine/skills/乱武.ts)的区别:
//   - 标版:仅"令所有其他角色依次对距离最近者出杀,无法如此做者失去1点体力"。
//   - 界版:在标版主循环结束后,追加一次询问——贾诩可选择视为使用一张【杀】,
//     无距离限制。视为使用的【杀】占出杀次数限制(与界仁德视为使用基本牌一致)。
//
// 实现要点:
//   - 主循环(令他人选杀最近者或失1体力)复用标版乱武的 resolveForcedSlash 与 nearestOthers。
//   - 主循环结束后,若贾诩仍存活且有出杀次数剩余(canSlash),发起 choosePlayer 询问:
//     目标为任意存活其他角色(targetFilter 不校验距离 → 无距离限制)。
//     贾诩选目标 → 走 virtualKill(虚拟杀结算,模型参考 界仁德.virtualKill);
//     贾诩 pass / 超时 → 不视为使用杀。
//   - 视为使用杀占出杀次数:incSlashUsed + 回合用量投影 view。
//
// 命名:文件名/loader key/character skill name 均为 '界乱武';内部 Skill.name='乱武'。
import type { Card, FrontendAPI, GameState, GameView, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { defaultPlayActive } from '../action-active';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { effectiveDistance } from '../distance';
import { canSlash, incSlashUsed, slashUsed } from '../slash-quota';

const SKILL_ID = '界乱武';
const DISPLAY_NAME = '乱武';

const USED_KEY = '乱武/used';
/** 他人响应乱武询问的出杀选择(use action 内消费) */
const CHOICE_VAR = '乱武/出杀';
/** 他人响应乱武询问的 requestType */
const REQUEST_TYPE = '乱武/出杀';
/** 界版追加:贾诩选择"视为使用杀"目标的 requestType/localVars key */
const FINAL_TARGET_VAR = '界乱武/最终杀目标';
const FINAL_TARGET_RT = '界乱武/最终杀目标';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '限定技:出牌阶段令所有其他角色依次对距离最小者出杀,无法如此做者失去1点体力;结算后可视为使用一张无距离限制的【杀】',
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

/**
 * 执行一次"视为出杀"的完整结算(无实体牌)。模型参考 界仁德.virtualKill。
 * 无距离限制(调用方已选择目标,不再校验距离)。
 */
async function virtualKill(state: GameState, source: number, target: number): Promise<void> {
  if (!state.players[target]?.alive) return;
  const cardId = `界乱武:杀:${source}:${target}:${state.seq}`;
  // 直接写 cardMap:虚拟杀无实体,但结算流程中 atoms/toViewEvents 需要 cardMap[id] 存在
  state.cardMap[cardId] = {
    id: cardId,
    name: '杀',
    suit: '',
    color: '无色',
    rank: 'A',
    type: '基本牌',
  };

  await pushFrame(state, '界乱武', source, { virtualKillCardId: cardId });
  try {
    await applyAtom(state, { type: '指定目标', source, target, cardId });
    await applyAtom(state, { type: '成为目标', source, target, cardId });
    const valid = await applyAtom(state, { type: '检测有效性', source, target, cardId });
    if (!valid) return;
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
    } else {
      await applyAtom(state, { type: '造成伤害', target, amount: 1, source, cardId });
    }
  } finally {
    delete state.cardMap[cardId];
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
        const others = st.players.filter((p) => p.alive && p.index !== ownerId);
        if (others.length === 0) return '场上没有其他角色';
        return null;
      },
      async (st: GameState, _params: Record<string, Json>) => {
        const from = ownerId;
        // 限定技标记:第一个 await 前设置,防 dispatch 重入
        st.players[from].vars[USED_KEY] = true;
        await pushFrame(state, '界乱武', from, {});
        try {
          const n = st.players.length;
          // ── 主循环:从贾诩下家起,按座次依次处理每个其他存活角色 ──
          for (let step = 1; step < n; step++) {
            const p = (from + step) % n;
            if (p === from) continue;
            if (!st.players[p]?.alive) continue;

            const nearest = nearestOthers(st, p);
            if (nearest.length === 0) {
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

          // ── 界版追加:所有角色结算完毕后,贾诩可视为使用一张无距离限制的【杀】 ──
          // 贾诩仍存活 + 有出杀次数剩余 + 场上有其他存活角色 → 发起目标询问
          if (st.players[from]?.alive && canSlash(st, from)) {
            const aliveOthers = st.players.filter((p) => p.alive && p.index !== from);
            if (aliveOthers.length > 0) {
              delete st.localVars[FINAL_TARGET_VAR];
              await applyAtom(st, {
                type: '请求回应',
                requestType: FINAL_TARGET_RT,
                target: from,
                prompt: {
                  type: 'choosePlayer',
                  title: '界乱武:视为使用一张无距离限制的【杀】,选择目标(pass 则不使用)',
                  min: 1,
                  max: 1,
                  filter: (_view: GameView, t: number) =>
                    t !== from && st.players[t]?.alive === true,
                },
                timeout: 20,
              });
              const finalTarget = st.localVars[FINAL_TARGET_VAR] as number | undefined;
              delete st.localVars[FINAL_TARGET_VAR];
              if (typeof finalTarget === 'number' && st.players[finalTarget]?.alive) {
                await virtualKill(st, from, finalTarget);
                // 视为出杀占出杀次数(incSlashUsed + 回合用量投影 view)
                incSlashUsed(st);
                await applyAtom(st, {
                  type: '回合用量',
                  player: from,
                  key: '杀/usedCount',
                  value: slashUsed(st),
                });
              }
            }
          }
        } finally {
          await popFrame(state);
        }
      },
    ),
  );

  // ── respond(注册到每个座次)──
  // ① 他人响应乱武主询问(REQUEST_TYPE):选杀+最近目标
  // ② 贾诩响应界版追加询问(FINAL_TARGET_RT):选最终杀目标
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
          if (atom.requestType !== REQUEST_TYPE && atom.requestType !== FINAL_TARGET_RT) {
            return '当前不是乱武询问';
          }
          if (atom.requestType === FINAL_TARGET_RT) {
            // 最终杀目标:仅需 target(任意存活其他角色,无距离限制)
            const t =
              (params.targets as number[] | undefined)?.[0] ??
              (typeof params.target === 'number' ? params.target : undefined);
            if (typeof t !== 'number') return '请选择目标';
            if (t === seat) return '不能以自己为目标';
            if (!st.players[t]?.alive) return '目标不存在或已死亡';
            return null;
          }
          // REQUEST_TYPE 主询问:杀+最近目标
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
          const slot = st.pendingSlots.get(seat);
          const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
          if (rt === FINAL_TARGET_RT) {
            const t =
              (params.targets as number[] | undefined)?.[0] ??
              (typeof params.target === 'number' ? params.target : undefined);
            if (typeof t === 'number') st.localVars[FINAL_TARGET_VAR] = t;
            return;
          }
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
      title: '乱武(限定技):令所有其他角色依次对距离最近者出杀,无法如此做者失去1点体力;结算后可视为使用一张无距离限制的【杀】',
    },
    activeWhen: (ctx) => defaultPlayActive(ctx),
  });
  // respond:被乱武问询的角色选杀+最近目标 / 贾诩选最终杀目标。前端按 pending prompt 渲染。
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

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
