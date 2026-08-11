// 溃诛(孙亮·吴·被动技,风林火山 hero/403):
//   "弃牌阶段结束时,你可以选择一项:
//    1.令至多X名角色各摸一张牌;
//    2.对任意名体力值之和为X的角色各造成1点伤害。
//    (X为你本阶段弃置的牌数)"
//
// 机制(弃牌阶段结束二选一):
//   1) 弃置 afterHook:state.phase==='弃牌' && atom.player===ownerId 时,
//      累计本阶段弃置的牌数到 localVars。
//   2) 阶段结束(弃牌) beforeHook(自己):X = 累计弃牌数。
//      - X<=0 或自身死亡 → 不触发。
//      - 询问 chooseOption(摸牌/伤害/不发动)。
//      - 摸牌:choosePlayer(1..X) → 逐名摸 1。
//      - 伤害:choosePlayer(体力值之和=X) → 逐名造成 1 点伤害(来源=自己)。
//
// 关键点:
//   - 用 before-hook(同固政):after-hook 会在「阶段结束」atom apply 及回合管理的
//     after-hook(推进阶段)之后执行,导致 pending 错位。
//   - X 通过 localVars['溃诛/X'] 在 hook 内传递给 respond validate。
//   - 伤害走 runDamageFlow(完整伤害流程,触发加伤/减伤/反馈等下游)。
//   - 每个自己的弃牌阶段只有一个,自然满足"每阶段一次"。
import type { FrontendAPI, GameState, GameView, Json, Skill } from '../types';
import type { SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { runDamageFlow } from '../flows/damage';
import { registerAction, registerAfterHook, registerBeforeHook } from '../core/skill';
import { getHealthValue } from '../types';

const OPTION_RT = '溃诛/选择'; // chooseOption:摸牌/伤害/不发动
const DRAW_RT = '溃诛/摸牌选目标'; // choosePlayer:1..X 名角色
const DAMAGE_RT = '溃诛/伤害选目标'; // choosePlayer:体力值之和=X

const OPTION_KEY = '溃诛/选项';
const DRAW_KEY = '溃诛/摸牌目标';
const DAMAGE_KEY = '溃诛/伤害目标';
const X_KEY = '溃诛/X'; // 本阶段弃牌数(hook↔validate 传递)
const COUNT_KEY = '溃诛/弃牌数'; // 弃置 afterHook 累计

const OPT_DRAW = '摸牌';
const OPT_DAMAGE = '伤害';
const OPT_SKIP = '不发动';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '溃诛',
    description:
      '弃牌阶段结束时,选择一项:令至多X名角色各摸一张牌,或对体力值之和为X的角色各造成1点伤害(X为本阶段弃牌数)',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 弃置 afterHook:累计弃牌阶段弃置的牌数 ──
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    if (ctx.state.phase !== '弃牌') return;
    if (ctx.atom.player !== ownerId) return;
    const prev = (ctx.state.localVars[COUNT_KEY] as number | undefined) ?? 0;
    ctx.state.localVars[COUNT_KEY] = prev + ctx.atom.cardIds.length;
  });

  // ── 阶段结束(弃牌) beforeHook:发动溃诛 ──
  registerBeforeHook(state, skill.id, ownerId, '阶段结束', async (ctx) => {
    const atom = ctx.atom;
    if (atom.phase !== '弃牌') return;
    if (atom.player !== ownerId) return;
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;

    const X = (st.localVars[COUNT_KEY] as number | undefined) ?? 0;
    delete st.localVars[COUNT_KEY];
    if (X <= 0) return; // 本阶段未弃牌,不触发

    st.localVars[X_KEY] = X;
    await pushFrame(st, '溃诛', ownerId, { X });

    // ── 第一步:选择一项 ──
    delete st.localVars[OPTION_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: OPTION_RT,
      target: ownerId,
      prompt: {
        type: 'chooseOption',
        title: `溃诛:你本阶段弃置了 ${X} 张牌,选择一项`,
        options: [
          { value: OPT_DRAW, label: `令至多 ${X} 名角色各摸一张牌` },
          { value: OPT_DAMAGE, label: `对体力值之和为 ${X} 的角色各造成 1 点伤害` },
          { value: OPT_SKIP, label: '不发动' },
        ],
      },
      timeout: 30,
    });
    const option = st.localVars[OPTION_KEY] as string | undefined;
    delete st.localVars[OPTION_KEY];

    if (option !== OPT_DRAW && option !== OPT_DAMAGE) {
      delete st.localVars[X_KEY];
      await popFrame(st);
      return;
    }

    if (option === OPT_DRAW) {
      // ── 摸牌:选 1..X 名角色 ──
      delete st.localVars[DRAW_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: DRAW_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: `溃诛:选择 1 至 ${X} 名角色各摸一张牌`,
          min: 1,
          max: X,
          filter: (view: GameView, t: number) =>
            t !== ownerId && view.players[t]?.alive === true,
        },
        timeout: 30,
      });
      const targets = (st.localVars[DRAW_KEY] as number[] | undefined) ?? [];
      delete st.localVars[DRAW_KEY];
      for (const t of targets) {
        if (st.players[t]?.alive) {
          await applyAtom(st, { type: '摸牌', player: t, count: 1 });
        }
      }
    } else {
      // ── 伤害:选体力值之和为 X 的角色 ──
      delete st.localVars[DAMAGE_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: DAMAGE_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: `溃诛:选择体力值之和为 ${X} 的角色(各造成 1 点伤害)`,
          min: 1,
          max: X,
          filter: (view: GameView, t: number) =>
            t !== ownerId && view.players[t]?.alive === true,
        },
        timeout: 30,
      });
      const targets = (st.localVars[DAMAGE_KEY] as number[] | undefined) ?? [];
      delete st.localVars[DAMAGE_KEY];
      for (const t of targets) {
        if (st.players[t]?.alive) {
          await runDamageFlow(st, ownerId, t, 1);
        }
      }
    }

    delete st.localVars[X_KEY];
    await popFrame(st);
  });

  // ── respond action:处理 选择 / 摸牌选目标 / 伤害选目标 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是溃诛窗口';
      const atom = slot.atom as { requestType?: string };
      const X = (st.localVars[X_KEY] as number | undefined) ?? 0;

      if (atom.requestType === OPTION_RT) {
        const opt = params.option;
        if (opt !== OPT_DRAW && opt !== OPT_DAMAGE && opt !== OPT_SKIP) {
          return '请选择一项';
        }
        return null;
      }
      if (atom.requestType === DRAW_RT) {
        const targets = params.targets as number[] | undefined;
        if (!Array.isArray(targets) || targets.length === 0) return '请选择至少一名角色';
        if (targets.length > X) return `至多选择 ${X} 名角色`;
        for (const t of targets) {
          if (t === ownerId) return '不能选择自己';
          if (!st.players[t]?.alive) return '目标不合法';
        }
        return null;
      }
      if (atom.requestType === DAMAGE_RT) {
        const targets = params.targets as number[] | undefined;
        if (!Array.isArray(targets) || targets.length === 0) return '请选择至少一名角色';
        if (targets.length > X) return `至多选择 ${X} 名角色`;
        let sum = 0;
        for (const t of targets) {
          if (t === ownerId) return '不能选择自己';
          if (!st.players[t]?.alive) return '目标不合法';
          sum += getHealthValue(st.players[t]);
        }
        if (sum !== X) return `所选角色体力值之和(${sum})须等于 ${X}`;
        return null;
      }
      return '当前不是溃诛窗口';
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId)!;
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType === OPTION_RT) {
        st.localVars[OPTION_KEY] = params.option;
      } else if (atom.requestType === DRAW_RT) {
        st.localVars[DRAW_KEY] = params.targets as number[];
      } else if (atom.requestType === DAMAGE_RT) {
        st.localVars[DAMAGE_KEY] = params.targets as number[];
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
