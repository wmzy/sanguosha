// 界翦灭(界张春华·主动技,OL hero/625 官方逐字):
//   "出牌阶段限一次,你可与一名其他角色同时选择一种颜色,你与其弃置各自选择颜色的手牌,
//    然后弃置牌较多的角色视为对另一角色使用【决斗】。"
//
// 实现(主动技,sequential 选色):
//   1. use action:出牌阶段限一次,选一名其他存活角色为目标
//   2. 春华先选色(请求回应 confirm,confirm=红/cancel=黑)— 顺序中先问发动者
//   3. 目标再选色(请求回应 confirm,confirm=红/cancel=黑)
//      两人独立 confirm,互不知对方选择(信息隔离;虽是顺序执行,目标看的是自己的 prompt,
//      不见 春华的 localVars)。机制上与"同时"等价。
//   4. 收集 春华所选颜色的手牌 → 弃置(春华)
//      收集 目标所选颜色的手牌 → 弃置(目标)
//      (若一方在该颜色下 0 张,跳过其弃置,弃置 atom validate 不接受空数组)
//   5. 比较:count(春华) > count(目标) → 春华 视为对 目标 使用决斗;
//           count(目标) > count(春华) → 目标 视为对 春华 使用决斗;
//           相等(含双方都为 0)→ 无事发生
//   6. 调用 runDuelResolution(winner, loser, undefined, true)(无实体牌,跳过无懈——
//      "视为使用决斗"通常不可被无懈,与离间一致)
//
// 关键点:
//   - 限一次/回合:用 界翦灭/usedThisTurn(once-per-turn helpers)
//   - 目标 respond 需为所有玩家注册 respond action(validate 严格检查 pending requestType)
//   - 决斗由 runDuelResolution 复用(无双/轮流出杀/输者受伤)
//   - 若 春华是决斗发起者(source),其造成的伤害会被 界绝情 before-hook 自动转为"失去体力"
//   - 颜色映射:choice=true → '红';choice=false/超时 → '黑'
//   - 春华 / 目标 须有手牌(否则选色无意义且可能死锁)。validate 强制 hand>0
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { runDuelResolution } from './决斗';

const SKILL_ID = '界翦灭';
const DISPLAY_NAME = '翦灭';
const OWNER_COLOR_RT = `${SKILL_ID}/我选色`;
const TARGET_COLOR_RT = `${SKILL_ID}/敌选色`;
const OWNER_COLOR_KEY = `${SKILL_ID}/ownerColor`;
const TARGET_COLOR_KEY = `${SKILL_ID}/targetColor`;

type Color = '红' | '黑';

/** 由 confirm 选择推出颜色:true→红,false/超时→黑。 */
function colorFromChoice(v: unknown): Color {
  return v === true ? '红' : '黑';
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段限一次:与一名其他角色各选一种颜色,各自弃置所选颜色的手牌,弃牌较多者视为对另一方使用决斗',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ─── use action:春华主动发动翦灭 ──────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>) => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId, SKILL_ID)) return '本回合已使用过翦灭';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      if (self.hand.length === 0) return '你需要有手牌才能发动翦灭';

      const target = params.target as number;
      if (typeof target !== 'number') return '需要指定一名目标';
      if (target === ownerId) return '不能以自己为目标';
      const tp = st.players[target];
      if (!tp?.alive) return '目标不存在或已死亡';
      if (tp.hand.length === 0) return '目标没有手牌';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = params.target as number;

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(st, from, SKILL_ID);

      await pushFrame(st, SKILL_ID, from, { ...params });

      try {
        // 1) 春华 选色
        delete st.localVars[OWNER_COLOR_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: OWNER_COLOR_RT,
          target: from,
          prompt: {
            type: 'confirm',
            title: '翦灭:选择你的颜色(确认=红色,取消=黑色)',
            confirmLabel: '红色',
            cancelLabel: '黑色',
          },
          defaultChoice: false,
          timeout: 15,
        });
        const ownerColor: Color = colorFromChoice(st.localVars[OWNER_COLOR_KEY]);

        // 2) 目标 选色
        delete st.localVars[TARGET_COLOR_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: TARGET_COLOR_RT,
          target,
          prompt: {
            type: 'confirm',
            title: `翦灭:${st.players[from].name} 与你各选一色,各自弃该色手牌,多者对少者决斗。选择你的颜色(确认=红色,取消=黑色)`,
            confirmLabel: '红色',
            cancelLabel: '黑色',
          },
          defaultChoice: false,
          timeout: 15,
        });
        const targetColor: Color = colorFromChoice(st.localVars[TARGET_COLOR_KEY]);

        // 3) 各自弃置所选颜色的手牌
        const ownerCards = colorCards(st, from, ownerColor);
        const targetCards = colorCards(st, target, targetColor);
        if (ownerCards.length > 0) {
          await applyAtom(st, { type: '弃置', player: from, cardIds: ownerCards });
        }
        if (targetCards.length > 0) {
          await applyAtom(st, { type: '弃置', player: target, cardIds: targetCards });
        }

        // 4) 比较:多者视为对少者使用决斗
        if (ownerCards.length > targetCards.length) {
          // 春华弃得多 → 春华 视为对 目标 使用决斗
          if (st.players[from]?.alive && st.players[target]?.alive) {
            await runDuelResolution(st, from, target, undefined, true);
          }
        } else if (targetCards.length > ownerCards.length) {
          // 目标弃得多 → 目标 视为对 春华 使用决斗
          if (st.players[from]?.alive && st.players[target]?.alive) {
            await runDuelResolution(st, target, from, undefined, true);
          }
        }
        // 相等(含均 0):无事发生
      } finally {
        await popFrame(st);
      }
    },
  );

  // ─── respond action:为所有玩家注册 ────────────────────────
  // 春华与目标均需 respond 选色;validate 严格检查 pending requestType,
  // 非翦灭 pending 一律拒绝(无副作用)。
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const pid = p.index;
    const u = registerAction(
      state,
      skill.id,
      pid,
      'respond',
      (st: GameState, _params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as { type?: string; requestType?: string };
        if (atom.type !== '请求回应') return '当前不需要回应';
        if (atom.requestType !== OWNER_COLOR_RT && atom.requestType !== TARGET_COLOR_RT) {
          return '当前不是翦灭选色';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return;
        const atom = slot.atom as { requestType?: string };
        const choice = params.choice === true || params.confirmed === true;
        if (atom.requestType === OWNER_COLOR_RT) {
          // 仅春华(ownerId)可回应此 RT
          if (pid !== ownerId) return;
          st.localVars[OWNER_COLOR_KEY] = choice;
        } else if (atom.requestType === TARGET_COLOR_RT) {
          st.localVars[TARGET_COLOR_KEY] = choice;
        }
      },
    );
    unloaders.push(u);
  }

  return () => {
    unloaders.forEach((u) => u());
  };
}

/** 取某玩家手中指定颜色的所有牌 id。 */
function colorCards(state: GameState, playerId: number, color: Color): string[] {
  const p = state.players[playerId];
  if (!p) return [];
  const result: string[] = [];
  for (const id of p.hand) {
    const c = state.cardMap[id];
    if (c?.color === color) result.push(id);
  }
  return result;
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'selectTarget',
      title: '翦灭:选择一名其他角色,各选一色弃牌,多者对少者决斗',
      description: '出牌阶段限一次;你和目标都需要有手牌',
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, t) => {
          const me = view.currentPlayerIndex;
          if (t === me) return false;
          const tp = view.players[t];
          if (!tp || tp.alive === false) return false;
          return (tp.handCount ?? 0) > 0;
        },
      },
    },
    activeWhen: (ctx) =>
      activeUnlessUsedThisTurn(SKILL_ID)(ctx) &&
      (ctx.view.players[ctx.perspectiveIdx]?.hand?.length ?? 0) > 0,
  });

  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '翦灭:选择你的颜色(确认=红色,取消=黑色)',
      confirmLabel: '红色',
      cancelLabel: '黑色',
    },
  });

  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
