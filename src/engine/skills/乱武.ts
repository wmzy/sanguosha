// 乱武(贾诩·群·限定技):出牌阶段,你可以令所有其他角色依次对与其距离最近的另一名角色
//   使用一张【杀】,无法如此做者失去1点体力。
//
// 实现:
//   - use action(主动,限定技):出牌阶段、自己回合、无阻塞 pending、存活、未使用过。
//     立即标记 player.vars['乱武/used']=true(限定技,整局一次,防重入)。
//   - 从贾诩下家起,按座次依次遍历每个其他存活角色 P:
//       1. 计算 P 到所有其他存活角色(含贾诩)的有效距离,取最小者 → "最近角色"集合。
//       2. 请求回应(询问 requestType 由调用方注入,标 '乱武/出杀' / 界 '界乱武/出杀'):
//          选一张【杀】+ 一名最近角色为目标。
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
//
// 本文件同时导出乱武族共享核心(nearestOthers/validateLuanwuUse/runLuanwuMainLoop/
// validateLuanwuSlashRespond/applyLuanwuSlashRespond/defineLuanwuSlashRespondAction):
// 标/界的主循环、use 校验、respond 校验与 onMount 定义逐字相同,仅询问 requestType
// 前缀不同('乱武/出杀' vs '界乱武/出杀',同对局两版共存时键空间隔离;限定技标记与
// 询问文案共享)。界乱武.ts 消费这些导出,只写"结算后视为出杀"差异段。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply'
import { popFrame, pushFrame } from '../core/frame';
import { runUseFlow } from './cards/use-card';
import { defaultPlayActive } from '../rules/action-active';
import { registerAction } from '../core/skill';
import { effectiveDistance } from '../rules/distance';
import { askResponse, registerRespondForAllSeats, engineCanPlayNowReason } from '../util/skillRuntime';

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

/** P 的"距离最近的另一名角色"集合(存活,含贾诩)。标/界共用。 */
export function nearestOthers(state: GameState, p: number): number[] {
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

/** use action 前置校验(标/界逐字相同;限定技标记共享 player.vars['乱武/used'])。 */
export function validateLuanwuUse(st: GameState, ownerId: number): string | null {
  const playError = engineCanPlayNowReason(st, ownerId);
  if (playError) return playError;
  if (st.players[ownerId]?.vars[USED_KEY]) return '乱武已使用过(限定技)';
  // 至少需要 1 名其他存活角色才有意义
  const others = st.players.filter((p) => p.alive && p.index !== ownerId);
  if (others.length === 0) return '场上没有其他角色';
  return null;
}

/**
 * 乱武主循环(标/界共用):从 from 下家起逆时针,令每个其他存活角色对距离最近者
 * 使用一张【杀】,无法如此做(无杀/超时/pass)则失去 1 点体力。
 * 询问 requestType 由调用方注入(标/界前缀不同)。
 */
export async function runLuanwuMainLoop(
  st: GameState,
  from: number,
  requestType: string,
): Promise<void> {
  const n = st.players.length;
  for (let step = 1; step < n; step++) {
    const p = (from - step + n) % n;
    if (p === from) continue;
    if (!st.players[p]?.alive) continue;

    const nearest = nearestOthers(st, p);
    if (nearest.length === 0) {
      // 无其他存活角色 → 无法如此做
      await applyAtom(st, { type: '失去体力', target: p, amount: 1 });
      continue;
    }

    const choice = await askResponse<{ cardId: string; target: number } | undefined>(
      st,
      requestType,
      p,
      {
        resultKey: CHOICE_VAR,
        prompt: {
          type: 'useCardAndTarget',
          title: `乱武:对距离最近的角色使用一张【杀】,否则失去1点体力`,
          cardFilter: { filter: (c: Card) => c.name === '杀', min: 1, max: 1 },
          targetFilter: { min: 1, max: 1, filter: (_view, t: number) => nearest.includes(t) },
        },
        timeout: 20,
      },
    );
    // 二次校验:手牌仍持有 + 目标仍在最近集合(防止超时兜底/竞态)
    if (
      choice &&
      st.players[p].hand.includes(choice.cardId) &&
      nearestOthers(st, p).includes(choice.target) &&
      st.players[choice.target]?.alive
    ) {
      // 走完整杀结算(runUseFlow→杀.resolveSlash),不计出杀次数;
      // 目标由 respond 权威校验;damageType 由 cardMap 自动传导(火杀/雷杀不再丢失)。
      await runUseFlow(st, p, choice.cardId, [choice.target], '杀');
    } else {
      await applyAtom(st, { type: '失去体力', target: p, amount: 1 });
    }
  }
}

/** respond 校验(标/界共用):主询问"选一张杀+最近目标"的权威校验。 */
export function validateLuanwuSlashRespond(
  st: GameState,
  seat: number,
  params: Record<string, Json>,
  requestType: string,
): string | null {
  const slot = st.pendingSlots.get(seat);
  if (!slot) return '当前不需要回应';
  const atom = slot.atom as { requestType?: string };
  if (atom.requestType !== requestType) return '当前不是乱武询问';
  const cardId = params.cardId as string | undefined;
  const target = params.target as number | undefined;
  if (typeof cardId !== 'string') return '请选择一张杀';
  if (typeof target !== 'number') return '请选择目标';
  const self = st.players[seat];
  if (!self?.hand.includes(cardId)) return '牌不在手牌中';
  if (st.cardMap[cardId]?.name !== '杀') return '只能使用杀';
  if (!nearestOthers(st, seat).includes(target)) return '目标不是距离最近的角色';
  return null;
}

/** respond 落笔(标/界共用):把"选杀+目标"写入 localVars['乱武/出杀']。 */
export function applyLuanwuSlashRespond(st: GameState, params: Record<string, Json>): void {
  st.localVars[CHOICE_VAR] = {
    cardId: params.cardId as string,
    target: params.target as number,
  };
}

/** onMount 侧"出杀" respond action 定义(标/界逐字相同;前端按 pending prompt 渲染)。 */
export function defineLuanwuSlashRespondAction(api: FrontendAPI): void {
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
      (st: GameState, _params: Record<string, Json>): string | null =>
        validateLuanwuUse(st, ownerId),
      async (st: GameState, _params: Record<string, Json>) => {
        const from = ownerId;
        // 限定技标记:第一个 await 前设置,防 dispatch 重入
        st.players[from].vars[USED_KEY] = true;
        await pushFrame(state, '乱武', from, {});
        try {
          await runLuanwuMainLoop(st, from, REQUEST_TYPE);
        } finally {
          await popFrame(state);
        }
      },
    ),
  );

  // ── respond(注册到每个座次:被乱武问询的角色选杀+最近目标)──
  unloaders.push(
    ...registerRespondForAllSeats(
      state,
      skill.id,
      (st, seat, params) => validateLuanwuSlashRespond(st, seat, params, REQUEST_TYPE),
      async (st, _seat, params) => {
        applyLuanwuSlashRespond(st, params);
      },
    ),
  );

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
  defineLuanwuSlashRespondAction(api);
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
