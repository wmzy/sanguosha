// 武烈(界孙坚·吴·限定技,OL hero/458 官方逐字):
//   "限定技,结束阶段,你可以失去任意点体力,令X名其他角色获得'烈'标记
//    (X为以此法失去的体力值)。当有'烈'的角色受到伤害时,其移除'烈'并防止此伤害。"
//
// 时机:阶段开始(回合结束) after-hook —— 孙坚的结束阶段开始。
// 流程:
//   1. 限定技未用 + 孙坚存活 + 体力≥1 + 有其他存活角色 → 询问孙坚是否发动。
//   2. 确认发动 → 询问失去N点体力(1..当前体力,通过 hpCount 参数回复)。
//   3. 询问选 N 名其他角色(可选目标数 clamp 到存活其他角色数 targetCount)。
//   4. 标记限定技已用(player.vars['武烈/used'],整局一次,不被 回合结束 清理)。
//   5. 失去 N 点体力(可能进入濒死;若孙坚失血致死且无人救援,后续不发标记)。
//   6. 孙坚存活 → 给每个目标加 1 个「烈」标记(mark.id='武烈/烈',scope=目标座次)。
//
// 「烈」效果(锁定):
//   - 造成伤害 before-hook:若 target 有「烈」标记 → 移去1枚「烈」(去标记)+ cancel 原伤害。
//   - 多枚「烈」可叠加(每次受到伤害仅移去1枚),用 marks 数组的多条目实现。
//
// 关键点:
//   - 限定技整局一次:player.vars['武烈/used'](永久 vars,不被自动清理)。
//   - 失去任意点体力:N ∈ [1, 当前体力];N=当前体力会令孙坚进入濒死(求桃)。
//   - 等量其他角色各获1个「烈」:目标数 = min(N, 存活其他角色数)。
//   - 防止伤害 before-hook 作用于任意持有「烈」的角色(不限孙坚的「烈」来源)。
//   - N 路由通过 params.hpCount(prompt 是 confirm 样式,前端可定制数字选择器)。
//
// 模式参考:闭月(结束阶段 after-hook)、天香(造成伤害 before-hook cancel)。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Mark,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook, type SkillModule } from '../skill';

const USED_KEY = '武烈/used';
const CONFIRM_RT = '武烈/confirm';
const HP_RT = '武烈/hp';
const CHOOSE_RT = '武烈/choose';
const CONFIRMED_KEY = '武烈/confirmed';
const HP_KEY = '武烈/hpCount';
const CHOSEN_KEY = '武烈/targets';
const LIE_MARK_ID = '武烈/烈';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '武烈',
    description:
      '限定技,结束阶段,你可以失去任意点体力,令等量的其他角色各获得1个「烈」标记。有「烈」的角色受到伤害时,防止此伤害,然后移去「烈」',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:孙坚本人回应(confirm / hpCount / 多选目标)──
  const unloadAction = registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== CONFIRM_RT && rt !== HP_RT && rt !== CHOOSE_RT) return '当前不是武烈询问';
      if (rt === HP_RT) {
        const hp = st.players[ownerId]?.health ?? 0;
        const n = typeof params.hpCount === 'number' ? params.hpCount : NaN;
        if (!Number.isInteger(n) || n < 1 || n > hp) {
          return `请选择 1-${hp} 之间的整数`;
        }
      }
      if (rt === CHOOSE_RT) {
        const expected = st.localVars[HP_KEY] as number | undefined;
        const targets = params.targets as number[] | undefined;
        if (!Array.isArray(targets) || typeof expected !== 'number' || targets.length !== expected) {
          return `请选择 ${expected ?? '?'} 名其他角色`;
        }
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === HP_RT) {
        const n = typeof params.hpCount === 'number' ? params.hpCount : 1;
        st.localVars[HP_KEY] = n;
      } else if (rt === CHOOSE_RT) {
        const targets = params.targets as number[] | undefined;
        if (Array.isArray(targets)) st.localVars[CHOSEN_KEY] = targets;
      }
    },
  );

  // ── 阶段开始(回合结束) after-hook:孙坚的结束阶段 ──
  const unloadEndHook = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomAfterContext): Promise<void> => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '回合结束') return;
      const st = ctx.state;
      const self = st.players[ownerId];
      if (!self?.alive) return;
      if (self.vars[USED_KEY]) return; // 限定技已用
      if (self.health < 1) return; // 无体力可失
      const otherAlive = st.players.filter((p) => p.alive && p.index !== ownerId);
      if (otherAlive.length === 0) return; // 无其他存活角色

      // 1) 询问是否发动武烈
      delete st.localVars[CONFIRMED_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动武烈?(限定技)',
          description: '结束阶段:失去任意点体力,令等量其他角色各获得1个「烈」标记',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!st.localVars[CONFIRMED_KEY]) {
        delete st.localVars[CONFIRMED_KEY];
        return;
      }
      delete st.localVars[CONFIRMED_KEY];

      // 2) 询问失去 N 点体力(1..当前体力;通过 hpCount 参数回复)
      const maxN = self.health;
      delete st.localVars[HP_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: HP_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `武烈:失去几点体力?(1-${maxN})`,
          description: `失去 N 点体力,令 N 名其他角色各获得1个「烈」标记(N 通过 hpCount 参数回复)`,
          confirmLabel: '确认',
          cancelLabel: '取消',
        },
        defaultChoice: false,
        timeout: 20,
      });
      const n = st.localVars[HP_KEY] as number | undefined;
      delete st.localVars[HP_KEY];
      if (typeof n !== 'number' || n < 1 || n > maxN) return; // 无效/超时 → 放弃

      // 3) 询问选 N 名其他角色(clamp 到存活其他角色数)
      const targetCount = Math.min(n, otherAlive.length);
      delete st.localVars[CHOSEN_KEY];
      // 注意:HP_KEY 同时供 CHOOSE_RT 校验读取,故在此保留(选择阶段仍需对照)
      st.localVars[HP_KEY] = targetCount;
      await applyAtom(st, {
        type: '请求回应',
        requestType: CHOOSE_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: `武烈:选择 ${targetCount} 名其他角色(各获1个「烈」标记)`,
          min: targetCount,
          max: targetCount,
          filter: (_view, t) => t !== ownerId && st.players[t]?.alive === true,
        },
        timeout: 30,
      });
      const chosen = st.localVars[CHOSEN_KEY] as number[] | undefined;
      delete st.localVars[CHOSEN_KEY];
      delete st.localVars[HP_KEY];
      if (!Array.isArray(chosen) || chosen.length !== targetCount) return;

      // 4) 标记限定技已使用(失去体力前先标记,即便后续致死也算用过)
      st.players[ownerId].vars[USED_KEY] = true;

      // 5) 失去 N 点体力(可能进入濒死;孙坚有桃可救,无桃则击杀)
      await applyAtom(st, { type: '失去体力', target: ownerId, amount: n });
      if (!st.players[ownerId]?.alive) return; // 失血致死 → 不发放标记

      // 6) 给每个目标加1个「烈」标记
      for (const t of chosen) {
        if (!st.players[t]?.alive) continue;
        const lieMark: Mark = { id: LIE_MARK_ID, scope: t, payload: { source: ownerId } };
        await applyAtom(st, { type: '加标记', player: t, mark: lieMark });
      }
    },
  );

  // ── 造成伤害 before-hook:目标有「烈」→ 移去1枚「烈」+ 防止此伤害 ──
  const unloadDmgHook = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; target?: number; amount?: number };
      if (atom.type !== '造成伤害') return;
      if (typeof atom.target !== 'number') return;
      if ((atom.amount ?? 0) <= 0) return;
      const st = ctx.state;
      const target = atom.target;
      const tp = st.players[target];
      if (!tp?.alive) return;
      if (!tp.marks.some((m) => m.id === LIE_MARK_ID)) return;
      // 移去1枚「烈」(去标记移除第一条匹配项),然后防止此伤害
      await applyAtom(st, { type: '去标记', player: target, markId: LIE_MARK_ID });
      return { kind: 'cancel' };
    },
  );

  return () => {
    unloadAction();
    unloadEndHook();
    unloadDmgHook();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 限定技:无主动 action(由 after-hook 被动触发);无主动 prompt
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
