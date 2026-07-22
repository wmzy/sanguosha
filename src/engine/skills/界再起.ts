// 界再起(界孟获·蜀·主动技,OL hero/492 现行版):
//   "结束阶段,你可以令至多 X 名角色各选择一项
//    (X 为本回合置入弃牌堆的红色牌数量):
//      1.摸一张牌;
//      2.令你回复 1 点体力。"
//
// 与标版再起(src/engine/skills/再起.ts)完全不同:
//   - 标版:摸牌阶段,放弃摸牌,展示牌堆顶 X 张(X=已损失体力),
//     红桃回血+弃置,非红桃入手。
//   - 界版:结束阶段,基于"本回合置入弃牌堆的红色牌数量"X,
//     令至多 X 名角色各选一项(目标摸一张 / 孟获回 1 血)。
//
// 机制:
//   1. 红色牌计数:回合开始 after-hook 记录弃牌堆基线长度 turn.vars['界再起/base']。
//      结束阶段扫描 discardPile.slice(base),取红色(♥/♦)牌数量 = X。
//      (用快照而非逐 atom hook:能覆盖所有置入弃牌堆的路径——弃置/拼点/移动牌/判定/
//       使用结算等;基线随「回合结束」atom 自动随 turn.vars 清空重置。)
//   2. 多目标选择:阶段开始(回合结束) after-hook 询问孟获是否发动,
//      确认后令其选 0..X 名目标(choosePlayer,可含自己,存活即可)。
//   3. 逐目标选项:对每个目标发 请求回应(confirm),目标选 1(摸牌)或 2(孟获回 1 血);
//      选项权在目标手里(孟获只决定"令谁选")。
//
// 关键点:
//   - 「至多 X 名角色」:X=0 时不发动;目标数 clamp 到存活角色数;可含孟获自己。
//   - 「各选择一项」:逐目标串行询问(避免并发 pending 干扰);目标必须选一项,
//     无"跳过"选项;超时默认选项 1(摸一张)。
//   - 时序:结束阶段 = 阶段开始(回合结束) after-hook,孟获存活才发动。
//   - respond 路由:dispatch 按 (skillId, ownerId=seatId, 'respond') 查 action。
//     故 respond 注册到每个座次(反间同构),以 skillId='界再起' 隔离。
//     ownerId 座次的 handler 额外处理 trigger/chooseTargets 两类孟获本人询问;
//     其他座次仅处理 option 询问。同一 (skill,seat,'respond') 只能注册一条,
//     故合并为一个 handler,内部按 requestType 分支。
//   - 重洗可能令弃牌堆变短;此时基线失效,保守视为 X=0(本回合不发动)。
import type {
  FrontendAPI,
  GameView,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const BASE_VAR = '界再起/base'; // turn.vars:本回合弃牌堆基线长度
const X_VAR = '界再起/x'; // localVars:本次最大目标数(供 chooseTargets validate 校验)
const TRIGGER_RT = '界再起/trigger'; // 孟获确认是否发动
const CHOOSE_TARGETS_RT = '界再起/chooseTargets'; // 孟获选目标(多选)
const OPTION_RT_PREFIX = '界再起/option/'; // +targetIdx → 目标选选项(独立 requestType)
const TRIGGER_CONFIRMED_KEY = '界再起/confirmed';
const TARGETS_KEY = '界再起/targets';
const OPTION_RESULTS_KEY = '界再起/optionResults'; // { [seatId]: 1|2 }

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界再起',
    description:
      '结束阶段,你可以令至多X名角色各选一项(X=本回合置入弃牌堆的红色牌数):1.摸一张牌;2.令你回复1点体力',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 回合开始 after-hook:记录本回合弃牌堆基线长度 ──
  const unloadTurnStartHook = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '回合开始',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '回合开始') return;
      if (atom.player !== ownerId) return;
      ctx.state.turn.vars[BASE_VAR] = ctx.state.zones.discardPile.length;
    },
  );

  // ── respond:注册到每个座次(以 skillId='界再起' 隔离)──
  //   ownerId 座次额外处理 trigger/chooseTargets;所有座次都处理 option。
  //   (dispatch 按 (skillId, seatId, 'respond') 查 action,故每座次独立闭包绑定 seatId。)
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const seatId = p.index;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as Record<string, unknown>;
        if (atom['type'] !== '请求回应') return '当前不需要回应';
        const rt = atom['requestType'] as string;

        // 孟获本人询问:仅 ownerId 座次回应
        if (rt === TRIGGER_RT || rt === CHOOSE_TARGETS_RT) {
          if (seatId !== ownerId) return '当前不是你的询问';
          if (rt === CHOOSE_TARGETS_RT) {
            const x = st.localVars[X_VAR] as number | undefined;
            const targets = params.targets as Json[] | undefined;
            if (!Array.isArray(targets)) return '需选择目标(可为空)';
            const maxN = typeof x === 'number' ? x : 0;
            if (targets.length > maxN) return `至多选择 ${maxN} 名角色`;
            for (const t of targets) {
              if (typeof t !== 'number') return '目标不合法';
              if (!st.players[t]?.alive) return '目标不合法';
            }
          }
          return null;
        }

        // 选项询问:任何座次(以 OPTION_RT_PREFIX+seatId 命名,确保是问自己的)
        if (typeof rt === 'string' && rt === OPTION_RT_PREFIX + seatId) {
          return null; // confirm 二选一,choice/confirmed 即答案
        }

        return '当前不是界再起询问';
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(seatId);
        const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
        if (rt === TRIGGER_RT) {
          st.localVars[TRIGGER_CONFIRMED_KEY] =
            params.choice === true || params.confirmed === true;
        } else if (rt === CHOOSE_TARGETS_RT) {
          const targets = params.targets as Json[] | undefined;
          st.localVars[TARGETS_KEY] = Array.isArray(targets)
            ? (targets.filter((t): t is number => typeof t === 'number') as number[])
            : [];
        } else if (rt === OPTION_RT_PREFIX + seatId) {
          // choice=true / confirmed=true → 选项 1(摸一张牌);否则 → 选项 2(孟获回 1 血)
          const choice = params.choice === true || params.confirmed === true;
          const option: 1 | 2 = choice ? 1 : 2;
          const results =
            (st.localVars[OPTION_RESULTS_KEY] as Record<string, Json> | undefined) ?? {};
          results[String(seatId)] = option;
          st.localVars[OPTION_RESULTS_KEY] = results;
        }
      },
    );
    unloaders.push(u);
  }

  // ── 阶段开始(回合结束) after-hook:界再起主逻辑 ──
  const unloadEndHook = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '回合结束') return;
      const st = ctx.state;
      const self = st.players[ownerId];
      if (!self?.alive) return;

      // 计算 X = 本回合置入弃牌堆的红色牌数量
      const base = st.turn.vars[BASE_VAR] as number | undefined;
      if (typeof base !== 'number') return;
      // 重洗可能令弃牌堆变短;基线失效则 X=0(本回合不发动)
      if (st.zones.discardPile.length < base) return;
      const newCardIds = st.zones.discardPile.slice(base);
      const x = newCardIds.filter((id) => st.cardMap[id]?.color === '红').length;
      if (x <= 0) return; // X=0 → 不发动

      const aliveCount = st.players.filter((p) => p.alive).length;
      if (aliveCount === 0) return;
      const maxTargets = Math.min(x, aliveCount);

      // 1) 询问孟获是否发动(描述"你可以"= 可选)
      delete st.localVars[TRIGGER_CONFIRMED_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: TRIGGER_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `界再起:本回合置入弃牌堆 ${x} 张红色牌。是否令至多 ${maxTargets} 名角色各选一项?`,
          description: '选项:1.摸一张牌;2.令孟获回复1点体力',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 20,
      });
      const confirmed = st.localVars[TRIGGER_CONFIRMED_KEY] === true;
      delete st.localVars[TRIGGER_CONFIRMED_KEY];
      if (!confirmed) return; // 不发动 / 超时

      // 2) 选 0..maxTargets 名目标(可含自己;存活即可)
      st.localVars[X_VAR] = maxTargets;
      delete st.localVars[TARGETS_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CHOOSE_TARGETS_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: `界再起:选择至多 ${maxTargets} 名角色(各选一项:摸一张牌 或 令你回复1点体力)`,
          min: 0,
          max: maxTargets,
          filter: (_view: GameView, t: number) => st.players[t]?.alive === true,
        },
        timeout: 30,
      });
      delete st.localVars[X_VAR];
      const rawTargets = st.localVars[TARGETS_KEY] as number[] | undefined;
      delete st.localVars[TARGETS_KEY];
      const targets = Array.isArray(rawTargets)
        ? rawTargets
            .filter((t, i, arr) => st.players[t]?.alive && arr.indexOf(t) === i) // 去重 + 存活
            .slice(0, maxTargets)
        : [];
      if (targets.length === 0) return; // 未选目标 → 不结算

      // 3) 逐目标询问选项 1/2,逐个结算(串行避免并发 pending 干扰)
      for (const t of targets) {
        if (!st.players[t]?.alive) continue; // 中途死亡则跳过
        delete st.localVars[OPTION_RESULTS_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: OPTION_RT_PREFIX + t,
          target: t,
          prompt: {
            type: 'confirm',
            title: '界再起(孟获):选择一项——1.摸一张牌;2.令孟获回复1点体力',
            confirmLabel: '1·摸一张牌',
            cancelLabel: '2·令孟获回复1点体力',
          },
          defaultChoice: true, // 超时默认选项 1(摸一张牌)
          timeout: 20,
        });
        const results = st.localVars[OPTION_RESULTS_KEY] as Record<string, Json> | undefined;
        const optionRaw = results?.[String(t)];
        // choice=true/超时 → 1;choice=false → 2
        const option: 1 | 2 = optionRaw === 2 ? 2 : 1;

        if (option === 1) {
          // 选项 1:目标摸一张牌
          await applyAtom(st, { type: '摸牌', player: t, count: 1 });
        } else {
          // 选项 2:孟获回复 1 点体力(孟获仍存活且未满血才回)
          const mh = st.players[ownerId];
          if (mh?.alive && mh.health < mh.maxHealth) {
            await applyAtom(st, { type: '回复体力', target: ownerId, amount: 1 });
          }
        }
      }
      delete st.localVars[OPTION_RESULTS_KEY];
    },
  );

  return () => {
    unloadTurnStartHook();
    unloaders.forEach((u) => u());
    unloadEndHook();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 被动触发(结束阶段 after-hook),无主动 action 按钮;无前端 prompt 注册。
  // respond 询问由 engine 通用 confirm UI 渲染(prompt 随请求回应 atom 下发)。
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
