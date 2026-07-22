// 界镇军(界于禁·魏·主动技,OL 界限突破 hero/756 逐字):
//   准备阶段,你可以弃置一名角色X张牌(X为其手牌数减体力值且至少为1),
//   然后选择一项:
//     1.你弃置与其中非装备牌数等量张牌;
//     2.结束阶段,其摸与其中非装备牌数等量张牌。
//
// 与标版镇军差异:
//   - 标版选项2:"其摸与其中非装备牌数等量张牌"(立即摸牌)
//   - 界版选项2:"结束阶段,其摸..."(延迟到自己结束阶段才摸)
//   其余完全一致。由于标版镇军尚未实现,直接独立创建界版文件。
//
// 流程(主动技,准备阶段触发,每回合一次):
//   阶段开始(准备) after-hook → 询问发动 → 选目标 → 选X张目标牌弃置
//     → 数其中非装备牌数N → 选1或2:
//       1. 选N张自己手牌弃置
//       2. 记录延迟摸牌条目 → 阶段开始(回合结束) after-hook 消费,目标摸N张
//
// 限制与边界:
//   - X = max(target.hand.length - target.health, 1)
//   - 目标总牌数(手牌+装备)须 ≥ X 才能被选(否则无法弃置X张)
//   - 选项1须 ownerId 手牌数 ≥ N(否则只能选选项2)
//   - 选项2延迟到 ownerId 结束阶段(同一回合内,turn.vars 天然在「回合结束」清空)
//   - N=0 时两选项都"等量0张",无副作用;选项1允许 owner 跳过弃牌,选项2目标摸0张
//
// 跨 atom 通信:
//   - turn.vars['界镇军/usedThisTurn']:本回合是否已发动(由「回合结束」atom 自动清空)
//   - turn.vars['界镇军/deferDraw']:延迟摸牌条目 {target, count},由结束阶段 hook 消费
//   - state.localVars:四个 respond 询问的结果(target/cardIds/option/selfCardIds)
//
// 命名:文件名/loader key/character skill name 均为 '界镇军'(避开标镇军冲突);
//   内部 Skill.name = '镇军'(OL 官方技能名,玩家可见)。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界镇军';
const DISPLAY_NAME = '镇军';

/** 本回合是否已发动界镇军(后缀 /usedThisTurn → 「回合结束」atom 自动清空) */
const USED_KEY = `${SKILL_ID}/usedThisTurn`;
/** 延迟摸牌条目 {target, count},结束阶段消费(随 turn.vars 清空) */
const DEFER_KEY = `${SKILL_ID}/deferDraw`;

/** 询问 requestTypes */
const RT_ASK_USE = `${SKILL_ID}/askUse`; // 发动?
const RT_ASK_TARGET = `${SKILL_ID}/askTarget`; // 选目标
const RT_ASK_CARDS = `${SKILL_ID}/askCards`; // 选目标的 X 张牌
const RT_ASK_OPTION = `${SKILL_ID}/askOption`; // 选选项 1 或 2
const RT_ASK_OWN = `${SKILL_ID}/askOwn`; // 选自己 N 张手牌弃置(选项1)

/** localVars 键 */
const LV_USE = `${SKILL_ID}/use`; // boolean
const LV_TARGET = `${SKILL_ID}/target`; // number
const LV_CARDS = `${SKILL_ID}/cards`; // string[]
const LV_OPTION = `${SKILL_ID}/option`; // 'self' | 'defer'
const OWN_KEY = `${SKILL_ID}/ownCards`; // string[]

/** 上下文 localVars 键(after-hook 写、respond validate 读。调词口由各步骤独立设置)
 *  - CTX_TARGET / CTX_X:RT_ASK_CARDS 询问时设置,validate 读取
 *  - CTX_N:RT_ASK_OPTION / RT_ASK_OWN 询问时设置,validate 读取
 */
const CTX_TARGET = `${SKILL_ID}/ctx/target`;
const CTX_X = `${SKILL_ID}/ctx/x`;
const CTX_N = `${SKILL_ID}/ctx/n`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '准备阶段,弃置一名角色X张牌(X为其手牌数减体力值且至少为1),然后选择:1.你弃置等量非装备牌数的牌;2.结束阶段其摸等量非装备牌数的牌',
  };
}

/** 角色总牌数(手牌+装备区) */
function totalCardCount(p: { hand: string[]; equipment: Record<string, string | undefined> }): number {
  const equipCount = Object.values(p.equipment).filter((id): id is string => !!id).length;
  return p.hand.length + equipCount;
}

/** 计算镇军 X 值:target.hand.length - target.health,最小 1 */
function computeX(target: { hand: string[]; health: number }): number {
  return Math.max(1, target.hand.length - target.health);
}

/** 目标牌中非装备牌数(即手牌数,因为目标牌来源只能是手牌或装备区) */
function countNonEquipment(state: GameState, target: number, cardIds: string[]): number {
  const equipSet = new Set(
    Object.values(state.players[target]?.equipment ?? {}).filter((id): id is string => !!id),
  );
  return cardIds.filter((id) => !equipSet.has(id)).length;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:统一处理四种询问(发动/选目标/选牌/选项/选自己牌) ──
  registerAction(
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
      if (
        rt !== RT_ASK_USE &&
        rt !== RT_ASK_TARGET &&
        rt !== RT_ASK_CARDS &&
        rt !== RT_ASK_OPTION &&
        rt !== RT_ASK_OWN
      ) {
        return '当前不是界镇军回应';
      }

      if (rt === RT_ASK_USE) {
        // choice=true/false
        return null;
      }
      if (rt === RT_ASK_TARGET) {
        // {target: number} 或 {targets: [number]}
        const t =
          (typeof params.target === 'number' ? params.target : undefined) ??
          (Array.isArray(params.targets) && typeof params.targets[0] === 'number'
            ? (params.targets[0] as number)
            : undefined);
        if (t === undefined) return '需要选择目标';
        return null;
      }
      if (rt === RT_ASK_CARDS) {
        // {cardIds: string[]},长度=X,均在目标手牌或装备区
        const cardIds = params.cardIds;
        if (!Array.isArray(cardIds)) return '需要选择牌';
        // 目标和 X 从 localVars 上下文读(after-hook 设置)
        const promptTarget = st.localVars[CTX_TARGET] as number | undefined;
        const promptX = st.localVars[CTX_X] as number | undefined;
        if (typeof promptTarget !== 'number') return '询问上下文异常';
        const targetPlayer = st.players[promptTarget];
        if (!targetPlayer) return '目标不存在';
        const equipSet = new Set(
          Object.values(targetPlayer.equipment).filter((id): id is string => !!id),
        );
        for (const id of cardIds) {
          if (typeof id !== 'string') return 'cardIds 必须为字符串数组';
          if (!targetPlayer.hand.includes(id) && !equipSet.has(id)) return '牌不在目标区域';
        }
        // 长度须 = X
        if (typeof promptX === 'number' && cardIds.length !== promptX) {
          return `需要选择 ${promptX} 张牌`;
        }
        // 不能重复
        if (new Set(cardIds).size !== cardIds.length) return '不能重复选牌';
        return null;
      }
      if (rt === RT_ASK_OPTION) {
        // option='self'|'defer' 或 choice=true/false
        const opt = params.option;
        if (opt !== 'self' && opt !== 'defer') {
          // 兼容 choice=true/false(true=self/false=defer)
          if (typeof params.choice === 'boolean') return null;
          return "option 必须为 'self' 或 'defer'";
        }
        // 选项1须自己手牌数 ≥ N(从 localVars 读)
        if (opt === 'self') {
          const promptN = st.localVars[CTX_N] as number | undefined;
          const myHand = st.players[ownerId]?.hand.length ?? 0;
          if (typeof promptN === 'number' && myHand < promptN) {
            return `手牌不足,不能选选项1(需 ${promptN} 张)`;
          }
        }
        return null;
      }
      // RT_ASK_OWN: {cardIds: string[]},长度=N,均在自己手牌
      const cardIds = params.cardIds;
      if (!Array.isArray(cardIds)) return '需要选择牌';
      const promptN = st.localVars[CTX_N] as number | undefined;
      const self = st.players[ownerId];
      if (!self) return '玩家不存在';
      for (const id of cardIds) {
        if (typeof id !== 'string') return 'cardIds 必须为字符串数组';
        if (!self.hand.includes(id)) return '牌不在自己手牌中';
      }
      if (typeof promptN === 'number' && cardIds.length !== promptN) {
        return `需要选择 ${promptN} 张牌`;
      }
      if (new Set(cardIds).size !== cardIds.length) return '不能重复选牌';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as Record<string, unknown> | undefined)?.['requestType'] as
        | string
        | undefined;

      if (rt === RT_ASK_USE) {
        st.localVars[LV_USE] = params.choice === true;
      } else if (rt === RT_ASK_TARGET) {
        const t =
          (typeof params.target === 'number' ? params.target : undefined) ??
          (Array.isArray(params.targets) && typeof params.targets[0] === 'number'
            ? (params.targets[0] as number)
            : undefined);
        if (typeof t === 'number') st.localVars[LV_TARGET] = t;
      } else if (rt === RT_ASK_CARDS) {
        st.localVars[LV_CARDS] = params.cardIds;
      } else if (rt === RT_ASK_OPTION) {
        const opt = params.option;
        if (opt === 'self' || opt === 'defer') {
          st.localVars[LV_OPTION] = opt;
        } else {
          // choice=true→self / false→defer
          st.localVars[LV_OPTION] = params.choice === true ? 'self' : 'defer';
        }
      } else if (rt === RT_ASK_OWN) {
        st.localVars[OWN_KEY] = params.cardIds;
      }
    },
  );

  // ── 准备阶段 after-hook:界镇军主流程 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '准备') return;
    if (atom.player !== ownerId) return;
    if (ctx.state.currentPlayerIndex !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    // 本回合已用过 → 跳过
    if (ctx.state.turn.vars[USED_KEY]) return;

    // 至少一名其他角色有牌(手牌+装备)才能发动
    const hasValidTarget = ctx.state.players.some(
      (p, i) => i !== ownerId && p.alive && totalCardCount(p) > 0,
    );
    if (!hasValidTarget) return;

    await pushFrame(ctx.state, SKILL_ID, ownerId, {});

    // 标记本回合已用(防 dispatch 重入)
    ctx.state.turn.vars[USED_KEY] = true;

    try {
      // ── 1. 询问发动 ──
      delete ctx.state.localVars[LV_USE];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: RT_ASK_USE,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动镇军?(弃置一名角色X张牌,X为其手牌数减体力值且至少为1)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (ctx.state.localVars[LV_USE] !== true) {
        // 不发动 → 撤销 USED 标记,允许后续触发(虽然准备阶段不会再触发)
        delete ctx.state.turn.vars[USED_KEY];
        return;
      }

      // ── 2. 询问选目标(有牌且总牌数≥X 才合法)──
      delete ctx.state.localVars[LV_TARGET];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: RT_ASK_TARGET,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '镇军:选择一名角色(弃置其X张牌,X为其手牌数减体力值且至少为1)',
          min: 1,
          max: 1,
          filter: (_view: GameView, target: number) => {
            if (target === ownerId) return false;
            const p = ctx.state.players[target];
            if (!p?.alive) return false;
            const x = computeX(p);
            return totalCardCount(p) >= x;
          },
        },
        timeout: 20,
      });

      const target = ctx.state.localVars[LV_TARGET] as number | undefined;
      if (typeof target !== 'number' || !ctx.state.players[target]?.alive) {
        // 未选到有效目标 → 撤销 USED
        delete ctx.state.turn.vars[USED_KEY];
        return;
      }
      const targetPlayer = ctx.state.players[target];
      const X = computeX(targetPlayer);
      if (totalCardCount(targetPlayer) < X) {
        delete ctx.state.turn.vars[USED_KEY];
        return;
      }

      // ── 3. 询问选 X 张目标牌(手牌或装备)──
      delete ctx.state.localVars[LV_CARDS];
      // 写入上下文(供 respond validate 读取)
      ctx.state.localVars[CTX_TARGET] = target;
      ctx.state.localVars[CTX_X] = X;
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: RT_ASK_CARDS,
        target: ownerId,
        prompt: {
          type: 'distribute',
          mode: 'select',
          title: `镇军:选择 ${targetPlayer.name} 的 ${X} 张牌弃置(可从手牌或装备区)`,
          // 静态列出目标当前所有牌(供前端展示;真实面杀手牌为暗牌,前端可渲染牌背)
          cardIds: [
            ...targetPlayer.hand,
            ...Object.values(targetPlayer.equipment).filter(
              (id): id is string => !!id,
            ),
          ],
          minTotal: X,
          maxTotal: X,
        },
        timeout: 30,
      });

      const pickedRaw = ctx.state.localVars[LV_CARDS];
      const picked = Array.isArray(pickedRaw) ? (pickedRaw as string[]) : [];
      if (picked.length !== X) {
        // 异常:不应发生(validate 已校验长度)
        delete ctx.state.turn.vars[USED_KEY];
        return;
      }

      // 数其中非装备牌数 N
      const N = countNonEquipment(ctx.state, target, picked);

      // 弃置目标的 X 张牌
      await applyAtom(ctx.state, { type: '弃置', player: target, cardIds: picked });

      // ── 4. 询问选选项 ──
      const myHandCount = ctx.state.players[ownerId].hand.length;
      const canOption1 = myHandCount >= N;
      delete ctx.state.localVars[LV_OPTION];
      // 写入 N 上下文(供选项1/自己选牌 validate 读取)
      ctx.state.localVars[CTX_N] = N;
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: RT_ASK_OPTION,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title:
            N === 0
              ? '镇军:其中无非装备牌,两选项均无额外效果'
              : canOption1
                ? `镇军:选项1(你弃置 ${N} 张手牌) 还是 选项2(结束阶段 ${targetPlayer.name} 摸 ${N} 张)?`
                : `镇军:手牌不足 ${N} 张,只能选选项2(结束阶段 ${targetPlayer.name} 摸 ${N} 张)`,
          confirmLabel: canOption1 ? `选项1:弃置 ${N} 张` : `(手牌不足)`,
          cancelLabel: `选项2:${targetPlayer.name} 摸 ${N} 张`,
        },
        defaultChoice: false,
        timeout: 20,
      });

      const option = ctx.state.localVars[LV_OPTION] as 'self' | 'defer' | undefined;
      // 手牌不足时强制走选项2(防止 validate 已挡但 choice 仍传 true)
      const useOption: 'self' | 'defer' =
        option === 'self' && canOption1 ? 'self' : 'defer';

      if (useOption === 'self') {
        // ── 选项1:你弃置 N 张手牌 ──
        if (N > 0) {
          delete ctx.state.localVars[OWN_KEY];
          await applyAtom(ctx.state, {
            type: '请求回应',
            requestType: RT_ASK_OWN,
            target: ownerId,
            prompt: {
              type: 'distribute',
              mode: 'select',
              title: `镇军:选择你自己的 ${N} 张手牌弃置`,
              source: 'hand',
              minTotal: N,
              maxTotal: N,
            },
            timeout: 30,
          });

          const ownRaw = ctx.state.localVars[OWN_KEY];
          const ownIds = Array.isArray(ownRaw) ? (ownRaw as string[]) : [];
          // 实际弃置的牌数 = min(N, 实选),防异常
          if (ownIds.length > 0) {
            await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: ownIds });
          }
        }
      } else {
        // ── 选项2:记录延迟摸牌条目 ──
        if (N > 0) {
          ctx.state.turn.vars[DEFER_KEY] = { target, count: N } as unknown as Json;
        }
      }
    } finally {
      await popFrame(ctx.state);
    }
  });

  // ── 回合结束阶段 after-hook:消费延迟摸牌 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '回合结束') return;
    if (atom.player !== ownerId) return;

    const defer = ctx.state.turn.vars[DEFER_KEY] as { target: number; count: number } | undefined;
    if (!defer) return;
    // 消费条目(防重复触发)
    delete ctx.state.turn.vars[DEFER_KEY];

    const target = ctx.state.players[defer.target];
    if (target?.alive) {
      await applyAtom(ctx.state, {
        type: '摸牌',
        player: defer.target,
        count: defer.count,
      });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '镇军',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
