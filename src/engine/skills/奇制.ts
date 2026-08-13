// 奇制(王基·魏·被动技,OL hero/362 风林火山官方逐字):
//   "当你于回合内使用非装备牌指定目标后,你可以弃置另一名角色一张牌,然后令其摸一张牌。"
//
// 实现(被动 after-hook + 三步 respond):
//   指定目标后 after-hook(source===ownerId, 回合内, 非装备牌, 有可弃目标):
//     1. 询问是否发动(请求回应 requestType='奇制/confirm',confirm prompt)
//     2. confirm 后选另一名角色(请求回应 requestType='奇制/选目标',choosePlayer prompt)
//     3. 选目标后弹选牌面板弃其一张牌(复用 runPickTargetCardPanel,discard 模式)
//     4. 令该角色摸一张牌(摸牌 atom)
//     5. 累加奇制发动次数(turn.vars['奇制/count'] + 1,供进趋读取)
//
// 关键点:
//   - 触发时机:指定目标后(逐目标触发,多目标牌可多次发动奇制)。挂在 指定目标后 而非
//     指定目标:前者只在目标未被空城/帷幕 cancel 时触发(对齐官方"指定目标后"语义)。
//   - "另一名角色":任意其他存活角色(非自己),与被指定目标可不同。
//   - "弃其一张牌然后令其摸一张牌":弃牌与摸牌均作用于同一角色(被弃牌者)。
//   - 计数:turn.vars['奇制/count'],回合结束 atom 自动清空;进趋在 阶段开始(回合结束)
//     读取,此时 turn.vars 尚未被 回合结束 atom 清空(阶段开始(回合结束)先于 回合结束 atom)。
//   - requestType '奇制/选牌' 经 resolvePendingRespond 按 [/_] 分割得 skillId='奇制'。
import type {
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import { runPickTargetCardPanel } from '../flows/pick-card-panel';
import type { SkillModule } from '../types';
import { QIZHI_COUNT_KEY as COUNT_VAR, PICK_RESULT_KEY } from '../rules/vars-keys';

const SKILL_ID = '奇制';
const CONFIRM_RT = `${SKILL_ID}/confirm`;
const TARGET_RT = `${SKILL_ID}/选目标`;
const PICK_CARD_RT = `${SKILL_ID}/选牌`;

const CONFIRM_KEY = `${SKILL_ID}/confirmed`;
const TARGET_KEY = `${SKILL_ID}/target`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description: '回合内使用非装备牌指定目标后,可弃置另一名角色一张牌并令其摸一张牌',
  };
}

/** 玩家区域(手牌+装备)是否有牌可被弃 */
function hasDiscardableCards(player: GameState['players'][number]): boolean {
  if (!player) return false;
  if (player.hand.length > 0) return true;
  return Object.values(player.equipment).some((id) => typeof id === 'string');
}

/** 是否存在可被弃牌的其他角色(存活、非自己、有牌) */
function hasValidTargets(state: GameState, ownerId: number): boolean {
  return state.players.some(
    (p) => p.alive && p.index !== ownerId && hasDiscardableCards(p),
  );
}

/** 当前 pending 的 requestType(类型安全读取) */
function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as unknown as { requestType?: string }).requestType;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:奇制本人对各询问的回应(confirm/选目标/选牌) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const rt = currentRequestType(st, ownerId);
      if (rt !== CONFIRM_RT && rt !== TARGET_RT && rt !== PICK_CARD_RT) {
        return '当前不是奇制询问';
      }
      if (rt === CONFIRM_RT) return null; // confirm:任意 choice 均可

      if (rt === TARGET_RT) {
        // choosePlayer:校验目标是其他存活且有牌的角色
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t !== 'number') return '请选择一名角色';
        if (t === ownerId) return '不能选择自己';
        const tp = st.players[t];
        if (!tp?.alive) return '目标已死亡';
        if (!hasDiscardableCards(tp)) return '目标无可弃置的牌';
        return null;
      }

      // PICK_CARD_RT:选牌面板结果(与过河拆桥/反馈共用 '选牌/结果' 契约)
      const zone = params.zone;
      if (zone === 'equipment') {
        if (typeof params.cardId !== 'string') return 'cardId required';
      } else if (zone === 'hand') {
        if (typeof params.handIndex !== 'number') return 'handIndex required';
      } else {
        return 'zone required (equipment|hand)';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const rt = currentRequestType(st, ownerId);
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
        return;
      }
      if (rt === TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
        return;
      }
      if (rt === PICK_CARD_RT) {
        // 选牌面板结果(与过河拆桥/反馈共用 '选牌/结果' 契约)
        st.localVars[PICK_RESULT_KEY] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
          handIndex: params.handIndex ?? null,
        };
        return;
      }
    },
  );

  // ── 主效果:指定目标后 after-hook ──
  registerAfterHook(state, skill.id, ownerId, '指定目标后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '指定目标后') return;
    if (atom.source !== ownerId) return; // 王基使用的牌
    // 回合内:仅自己回合触发
    if (ctx.state.currentPlayerIndex !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    // 非装备牌(装备牌无目标,不会到此;此处显式排除以精确对齐官方"非装备牌"语义)
    const card = atom.cardId !== undefined ? ctx.state.cardMap[atom.cardId] : undefined;
    if (card && card.type === '装备牌') return;
    // 须有可弃目标(其他存活且有牌的角色)
    if (!hasValidTargets(ctx.state, ownerId)) return;

    // 1. confirm 询问是否发动奇制
    delete ctx.state.localVars[CONFIRM_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动奇制?(弃置另一名角色一张牌,然后令其摸一张牌)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars[CONFIRM_KEY]) {
      delete ctx.state.localVars[CONFIRM_KEY];
      return;
    }
    delete ctx.state.localVars[CONFIRM_KEY];

    // 2. 二次校验:自身存活 + 仍有可弃目标
    if (!ctx.state.players[ownerId]?.alive) return;
    if (!hasValidTargets(ctx.state, ownerId)) return;

    // 3. 选目标(其他存活且有牌的角色)
    delete ctx.state.localVars[TARGET_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: TARGET_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '奇制:选择要弃置其一张牌的其他角色',
        min: 1,
        max: 1,
        filter: (_view: GameView, t: number) =>
          t !== ownerId &&
          ctx.state.players[t]?.alive === true &&
          hasDiscardableCards(ctx.state.players[t]),
      },
      timeout: 20,
    });
    const targetIdx = ctx.state.localVars[TARGET_KEY] as number | undefined;
    delete ctx.state.localVars[TARGET_KEY];
    if (typeof targetIdx !== 'number') return;

    const target = ctx.state.players[targetIdx];
    if (!target?.alive || !hasDiscardableCards(target)) return;

    // 4. 弃置该角色一张牌(复用过河拆桥选牌面板;不含判定区)
    await runPickTargetCardPanel(ctx.state, ownerId, targetIdx, target, {
      mode: 'discard',
      requestType: PICK_CARD_RT,
      title: `奇制:选择要从 ${target.name} 弃置的 1 张牌`,
      includeJudge: false,
    });

    // 5. 令该角色摸一张牌(被弃牌者摸一张)
    if (ctx.state.players[targetIdx]?.alive) {
      await applyAtom(ctx.state, { type: '摸牌', player: targetIdx, count: 1 });
    }

    // 6. 累加奇制发动次数(供进趋读取)
    const prev = (ctx.state.turn.vars[COUNT_VAR] as number | undefined) ?? 0;
    ctx.state.turn.vars[COUNT_VAR] = prev + 1;
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: SKILL_ID,
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '奇制',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
