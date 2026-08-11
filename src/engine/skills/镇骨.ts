// 镇骨(郝昭·魏·被动技,风林火山 hero/408):
//   "结束阶段,你可以选择一名其他角色,本回合结束时和其下回合结束时,
//    其将手牌调整至与你手牌数相同(至多摸至五张)。"
//
// 机制(三段式,跨两回合):
//   1) 结束阶段(阶段开始·phase='回合结束',郝昭自己):询问选一名其他角色 X。
//      pass/超时 = 不发动。记 player.vars['镇骨/目标']=X、['镇骨/阶段']='本回合'。
//   2) 本回合结束时(回合结束 atom,player=郝昭):X 手牌调整至与郝昭相同 → 阶段='目标下回合'。
//   3) X 下回合结束时(回合结束 atom,player=X):X 再次调整 → 清除状态。
//
// 手牌调整规则:
//   - Xh < H:X 摸 min(H-Xh, 5) 张("至多摸至五张"仅限摸牌侧)。
//   - Xh > H:X 选 (Xh-H) 张手牌弃置(强制弃牌;超时自动从手牌首张起补弃)。
//   - Xh = H:无变化。
//
// 跨回合状态:存郝昭座次 player.vars(无 /usedThisTurn 等后缀,跨回合持久,不被
//   回合结束 atom 自动清空)。郝昭死亡 → 技能卸载 hook 不再触发,残留 vars 无害
//   (下次发动被覆盖)。X 死亡 → 其回合被跳过,第二段不触发,残留待下次发动覆盖。
//
// respond 注册到所有座次:弃牌询问 target=X(可为任意其他角色),dispatch 按
//   (skillId, seatId, actionType) 查;选目标询问仅 owner 座次命中(validate 校验)。
import type {
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import type { SkillModule } from '../types';

const SKILL_NAME = '镇骨';

/** player.vars key:镇骨选定的目标座次(number) */
const TARGET_KEY = '镇骨/目标';
/** player.vars key:待结算阶段 '本回合' | '目标下回合' */
const PHASE_KEY = '镇骨/阶段';
/** localVars key:选目标询问结果(number) */
const CHOOSE_LV = '镇骨/chooseTarget';
/** localVars key:弃牌询问 cardIds 结果 */
const DISCARD_LV = '镇骨/discardCards';

/** requestType:选目标询问(前缀=skillId,见 T1) */
const CHOOSE_RT = '镇骨/选目标';
/** requestType:弃牌询问 */
const DISCARD_RT = '镇骨/弃牌';

/** 摸牌张数上限("至多摸至五张") */
const MAX_DRAW = 5;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_NAME,
    description:
      '结束阶段,你可以选择一名其他角色,本回合结束时和其下回合结束时,其将手牌调整至与你手牌数相同(至多摸至五张)',
  };
}

/** 读取当前 pending 的 requestType(类型安全) */
function currentRequestType(state: GameState, seat: number): string | undefined {
  const slot = state.pendingSlots.get(seat);
  return (slot?.atom as { requestType?: string } | undefined)?.requestType;
}

/**
 * 将 target 手牌调整至与 owner 手牌数相同。
 * - target 少:摸 min(差额, MAX_DRAW) 张。
 * - target 多:强制选 (差额) 张弃置(超时自动补弃)。
 * - 相等:无操作。
 */
async function adjustHand(state: GameState, ownerId: number, target: number): Promise<void> {
  const owner = state.players[ownerId];
  const tp = state.players[target];
  if (!owner?.alive || !tp?.alive) return;

  const ownerHand = owner.hand.length;
  const targetHand = tp.hand.length;

  if (targetHand < ownerHand) {
    const draw = Math.min(ownerHand - targetHand, MAX_DRAW);
    if (draw > 0) {
      await applyAtom(state, { type: '摸牌', player: target, count: draw });
    }
    return;
  }

  if (targetHand > ownerHand) {
    const excess = targetHand - ownerHand;
    // 强制弃牌:询问 target 选 excess 张手牌弃置
    delete state.localVars[DISCARD_LV];
    await applyAtom(state, {
      type: '请求回应',
      requestType: DISCARD_RT,
      target,
      prompt: {
        type: 'useCard',
        title: `镇骨:手牌调整,弃 ${excess} 张牌`,
        cardFilter: { filter: () => true, min: excess, max: excess },
      },
      mandatory: true,
      timeout: 30,
    });

    let cardIds = state.localVars[DISCARD_LV] as string[] | undefined;
    delete state.localVars[DISCARD_LV];
    // 超时未回应 → 自动从手牌首张起补弃(不放弃弃牌义务)
    if ((!cardIds || cardIds.length === 0) && excess > 0) {
      cardIds = state.players[target]?.hand.slice(0, excess) ?? [];
    }
    if (cardIds && cardIds.length > 0) {
      await applyAtom(state, { type: '弃置', player: target, cardIds });
    }
  }
  // 相等:无变化
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── respond action:注册到每个座次 ──
  //   owner 座次:处理 选目标(CHOOSE_RT) 询问。
  //   所有座次:处理 弃牌(DISCARD_RT) 询问(target 可为任意其他角色)。
  for (const p of state.players) {
    const seatId = p.index;
    const isOwner = seatId === ownerId;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as { type: string; requestType?: string };
        if (atom.type !== '请求回应') return '当前不需要回应';
        const rt = atom.requestType;

        if (rt === CHOOSE_RT) {
          if (!isOwner) return '当前不是你的询问';
          return null; // choosePlayer:目标合法性由 filter 把关
        }
        if (rt === DISCARD_RT) {
          const cardIds = params.cardIds as string[] | undefined;
          if (!Array.isArray(cardIds) || cardIds.length === 0) return '请选择要弃置的牌';
          const tp = st.players[seatId];
          if (!tp) return '玩家不存在';
          for (const id of cardIds) {
            if (typeof id !== 'string' || !tp.hand.includes(id)) return `牌 ${id} 不在手牌中`;
          }
          return null;
        }
        return '当前不是镇骨询问';
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const rt = currentRequestType(st, seatId);
        if (rt === CHOOSE_RT) {
          const t =
            (params.targets as number[] | undefined)?.[0] ??
            (typeof params.target === 'number' ? params.target : undefined);
          if (typeof t === 'number') st.localVars[CHOOSE_LV] = t;
        } else if (rt === DISCARD_RT) {
          const ids = params.cardIds as string[] | undefined;
          if (Array.isArray(ids)) st.localVars[DISCARD_LV] = ids;
        }
      },
    );
    unloaders.push(u);
  }

  // ── 阶段开始(回合结束) after-hook:郝昭结束阶段选目标 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '回合结束') return;
    if (atom.player !== ownerId) return; // 仅自己的结束阶段

    const ownerState = ctx.state.players[ownerId];
    if (!ownerState?.alive) return;

    // 询问选一名其他角色(pass/超时 = 不发动)
    delete ctx.state.localVars[CHOOSE_LV];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CHOOSE_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '镇骨:选择一名其他角色(本回合结束及其下回合结束时,其手牌调整至与你相同)',
        min: 1,
        max: 1,
        filter: (view: GameView, t: number) =>
          t !== ownerId && view.players[t]?.alive === true,
      },
      timeout: 20,
    });

    const target = ctx.state.localVars[CHOOSE_LV] as number | undefined;
    delete ctx.state.localVars[CHOOSE_LV];
    if (typeof target !== 'number') return; // 不发动
    if (!ctx.state.players[target]?.alive) return;

    // 记录跨回合状态
    ownerState.vars[TARGET_KEY] = target;
    ownerState.vars[PHASE_KEY] = '本回合';
  });

  // ── 回合结束 after-hook:两段手牌调整 ──
  registerAfterHook(state, skill.id, ownerId, '回合结束', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '回合结束') return;

    const ownerState = ctx.state.players[ownerId];
    if (!ownerState) return;
    const phase = ownerState.vars[PHASE_KEY] as string | undefined;
    const target = ownerState.vars[TARGET_KEY] as number | undefined;

    if (phase === '本回合' && atom.player === ownerId) {
      // 第一段:本回合(郝昭)结束时 → 调整 target
      if (typeof target !== 'number') return;
      await adjustHand(ctx.state, ownerId, target);
      // 推进到第二段(目标下回合结束)。owner 死亡(极端)则清除。
      if (ctx.state.players[ownerId]?.alive) {
        ownerState.vars[PHASE_KEY] = '目标下回合';
      } else {
        delete ownerState.vars[PHASE_KEY];
        delete ownerState.vars[TARGET_KEY];
      }
      return;
    }

    if (
      phase === '目标下回合' &&
      typeof target === 'number' &&
      atom.player === target
    ) {
      // 第二段:目标下回合结束时 → 再次调整,然后清除
      await adjustHand(ctx.state, ownerId, target);
      delete ownerState.vars[PHASE_KEY];
      delete ownerState.vars[TARGET_KEY];
    }
  });

  return () => {
    unloaders.forEach((u) => u());
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '镇骨',
    style: 'primary',
    prompt: {
      type: 'choosePlayer',
      title: '镇骨:选择一名其他角色',
      min: 1,
      max: 1,
    },
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
