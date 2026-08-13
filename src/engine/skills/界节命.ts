// 界节命(界荀彧·被动技,OL 界限突破官方逐字):
//   "当你受到1点伤害后或死亡时,你可以令一名角色摸X张牌,然后将手牌弃至X张
//    (X为其体力上限且至多为5)。"
//
// 与标版节命区别:
//   - 触发时机:受伤后【或死亡时】(两处);标版仅受伤后。
//   - 效果:先令目标【摸 X 张牌】(无条件),【然后将手牌弃至 X 张】(先摸后弃)。
//     标版仅「摸至 X 张」(只摸不弃,且语义为补满而非固定张数)。
//   - 无额外效果(旧实现的「若目标手牌数原为 0,你摸一张牌」不在官方描述中,已移除)。
//
// 模式 A(被动触发·受伤):after hook 挂在「受到伤害后」。
//   受到伤害后(target=自己 + amount>0 + 自己存活) → runJieMing()
//   (濒死检查在扣减体力时执行,先于 受到伤害后:致死未救活时 !alive 跳过,
//    改由模式 B 死亡时 触发;非致死或致死被救活时此处触发。)
//
// 模式 B(被动触发·死亡):after hook 挂在「死亡时」(模块 B:系统处理牌之前)。
//   死亡时(player=自己) → runJieMing()(不 cancel,系统处理牌随后正常执行,
//   自己仍死亡,技能只发挥一次最后作用)。
//
// runJieMing 主体:
//   1) 询问发动(confirm,owner 回应)
//   2) 选目标(任意存活角色,含自己,owner 回应)
//   3) 目标摸 X 张(无条件,X = min(目标.maxHealth, 5))
//   4) 若目标手牌 > X:目标需弃 (hand - X) 张(目标座次回应 useCard)
//
// 关键点:
//   - 「摸 X 张」固定张数,不是补满;即使原手牌已 ≥ X 仍摸 X 张
//   - 「将手牌弃至 X 张」:摸完后 hand > X 才需弃,弃 (hand - X) 张
//   - 目标可选任意存活角色,包括自己(死亡触发时选自己无实际收益)
//   - 跨座次 respond:目标座次需 respond 选拓牌,故 respond 须为所有座次注册
//   - 死亡触发在 死亡时 after-hook:此时自己的手牌/装备仍在(系统处理牌尚未清空)
//   - 受伤触发按一次伤害一次;死亡触发整局一次(死亡后技能失效)
import type {
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';

// 内部 requestType/localVars 键名保持原前缀「节命/」,不改为「界节命/」
const CONFIRM_RT = '界节命/confirm';
const TARGET_RT = '界节命/target';
const DISCARD_RT = '界节命/discard';
const CONFIRMED_KEY = '节命/confirmed';
const TARGET_KEY = '节命/target';
const DISCARD_KEY = '节命/discardCards';
// 标记某次伤害的节命已在「受到伤害后」触发,供「死亡时」去重(避免伤害致死双重触发)。
const DAMAGE_HANDLED_KEY = '节命/伤害已触发';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界节命',
    description:
      '受到1点伤害后或死亡时,令一名角色摸X张牌,然后将手牌弃至X张(X为其体力上限且至多为5)',
  };
}

/** 执行节命主体:询问发动 → 选目标 → 目标摸 X 张 → 目标弃至 X 张。 */
async function runJieMing(state: GameState, ownerId: number): Promise<void> {
  // 询问是否发动
  delete state.localVars[CONFIRMED_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CONFIRM_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '是否发动节命?(令一名角色摸X张牌,然后将手牌弃至X张)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
    defaultChoice: false,
    timeout: 10,
  });
  if (!state.localVars[CONFIRMED_KEY]) return;

  // 选目标(任意存活角色,含自己)
  delete state.localVars[TARGET_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: TARGET_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: '节命:选择一名角色(摸X张牌,然后将手牌弃至X张)',
      min: 1,
      max: 1,
      filter: (_view: GameView, t: number) => state.players[t]?.alive === true,
    },
    timeout: 15,
  });
  const target = state.localVars[TARGET_KEY] as number | undefined;
  delete state.localVars[TARGET_KEY];
  if (typeof target !== 'number') return;
  const targetPlayer = state.players[target];
  if (!targetPlayer?.alive) return;

  // X = min(目标体力上限, 5)
  const x = Math.min(targetPlayer.maxHealth, 5);

  // 先摸 X 张(无条件,与「摸至 X 张」不同——固定张数)
  if (x > 0) {
    await applyAtom(state, { type: '摸牌', player: target, count: x });
  }

  // 然后将手牌弃至 X 张:若手牌 > X,目标需弃 (hand - X) 张
  const handAfter = state.players[target]?.hand ?? [];
  const excess = handAfter.length - x;
  if (excess > 0) {
    delete state.localVars[DISCARD_KEY];
    await applyAtom(state, {
      type: '请求回应',
      requestType: DISCARD_RT,
      target,
      prompt: {
        type: 'useCard',
        title: `节命:需弃置 ${excess} 张手牌(将手牌弃至 ${x} 张)`,
        cardFilter: { filter: () => true, min: excess, max: excess },
      },
      // 强制型弃牌:前端隐藏"不回应"按钮 + 走多牌选择 UI;headless 不生成 skip
      mandatory: true,
      timeout: 15,
    });
    let discardIds = state.localVars[DISCARD_KEY] as string[] | undefined;
    delete state.localVars[DISCARD_KEY];
    // 强制弃牌:超时未回应 → 自动从手牌首张起补弃(不放弃弃牌义务)
    if ((!discardIds || discardIds.length === 0) && excess > 0) {
      discardIds = state.players[target]?.hand.slice(0, excess) ?? [];
    }
    if (discardIds && discardIds.length > 0) {
      await applyAtom(state, { type: '弃置', player: target, cardIds: discardIds });
    }
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:为所有座次注册 ──────────────────────────────────
  //   ownerId 座次:回应 confirm + 选目标
  //   任意目标座次:回应 弃牌 询问(目标可能是任意角色,故跨座次注册)
  // 参考 驱虎/享乐 跨座次注册模式,以 skillId='界节命' 隔离,不与他技 respond 冲突。
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const seatId = p.index;
    const off = registerAction(
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
        if (rt !== CONFIRM_RT && rt !== TARGET_RT && rt !== DISCARD_RT) {
          return '当前不是节命询问';
        }
        if (rt === DISCARD_RT) {
          // 目标座次选弃牌:校验 cardIds 在手牌中,数量 == excess
          const cardIds = Array.isArray(params.cardIds)
            ? (params.cardIds as string[])
            : typeof params.cardId === 'string'
              ? [params.cardId]
              : [];
          if (cardIds.length === 0) return '请选择要弃置的牌';
          const self = st.players[seatId];
          if (!self?.alive) return '你已死亡';
          for (const id of cardIds) {
            if (!self.hand.includes(id)) return '弃置的牌必须在手牌中';
          }
          const x = Math.min(self.maxHealth, 5);
          const excess = self.hand.length - x;
          if (excess <= 0) return '当前不需要弃牌';
          if (cardIds.length !== excess) return `必须弃置 ${excess} 张牌`;
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(seatId);
        const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
        if (rt === CONFIRM_RT) {
          st.localVars[CONFIRMED_KEY] = params.choice === true;
        } else if (rt === TARGET_RT) {
          const t =
            (params.targets as number[] | undefined)?.[0] ??
            (typeof params.target === 'number' ? params.target : undefined);
          if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
        } else if (rt === DISCARD_RT) {
          const cardIds = Array.isArray(params.cardIds)
            ? (params.cardIds as string[])
            : typeof params.cardId === 'string'
              ? [params.cardId]
              : [];
          if (cardIds.length > 0) st.localVars[DISCARD_KEY] = cardIds;
        }
      },
    );
    unloaders.push(off);
  }

  // ── 受到伤害后 after:荀彧受伤后触发(非致死 或 致死被救活)──
  // 濒死检查在扣减体力时(先于 受到伤害后)执行:若荀彧被救活(health>0)则此处触发;
  // 若荀彧未被救活(死亡),此处因 !alive 跳过,改由 死亡时 hook 触发。
  // 对所有存活伤害统一触发节命并置标记;若随后荀彧死亡,死亡时 hook 见标记去重跳过。
  unloaders.push(registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    ctx.state.localVars[DAMAGE_HANDLED_KEY] = true;
    await runJieMing(ctx.state, ownerId);
  }));

  // ── 死亡时 after:荀彧死亡时触发(系统处理牌之前)──
  // 伤害致死时,濒死检查先于 受到伤害后 执行:荀彧已死亡(alive=false),
  // 受到伤害后 hook 因 !alive 跳过(DAMAGE_HANDLED_KEY 未置)→ 死亡时 hook 触发节命。
  // 非伤害致死(失去体力/减上限等):死亡时 hook 直接触发。
  unloaders.push(registerAfterHook(state, skill.id, ownerId, '死亡时', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '死亡时') return;
    if (atom.player !== ownerId) return; // 仅荀彧本人死亡时触发
    if (ctx.state.localVars[DAMAGE_HANDLED_KEY]) {
      delete ctx.state.localVars[DAMAGE_HANDLED_KEY];
      return; // 伤害致死已由 受到伤害后 触发,跳过
    }
    // 荀彧 即将死亡(alive 仍为 true,系统处理牌随后置 false)
    // 不 cancel:让 系统处理牌 正常执行(荀彧仍死亡,技能只发挥一次最后作用)
    await runJieMing(ctx.state, ownerId);
  }));

  // ── 伤害结算结束后 after:清除伤害标记 ──
  // 荀彧受伤害但未死(非致死 或 致死被桃救活)时清除标记,避免残留导致日后
  // 非伤害致死时 死亡时 hook 误判为「已由伤害触发」而跳过。
  // 仅清本座次(荀彧为目标)的伤害结算,不受其他玩家伤害结算干扰。
  unloaders.push(registerAfterHook(state, skill.id, ownerId, '伤害结算结束后', async (ctx) => {
    if (ctx.atom.target !== ownerId) return;
    delete ctx.state.localVars[DAMAGE_HANDLED_KEY];
  }));

  return () => {
    for (const off of unloaders) off();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界节命',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动节命?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
