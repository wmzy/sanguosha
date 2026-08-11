// 审时(蒯越蒯良·魏·主动技·转换技,官方 hero/404 逐字):
//   "转换技，阳：出牌阶段限一次，你可以交给手牌数最多的其他角色一张牌，并对其造成1点伤害。
//    若其因此死亡，你可以令一名角色将手牌摸至四张。
//    阴：当其他角色对你造成伤害后，你可以观看其手牌，并交给其一张牌。
//    当前回合结束阶段，若其未失去此牌，你将手牌摸至四张。"
//
// 转换技状态:player.vars['审时/态'] = '阳'(默认) | '阴',跨回合持久。
//   - 阳(主动 use):出牌阶段限一次。交给手牌数最多的其他角色一张牌 → 造成1点伤害 →
//     若致死,可令一名角色摸至四张。发动后翻为 阴。
//   - 阴(被动 after-hook on '受到伤害后'):其他角色对你造成伤害后,观看其手牌并
//     交给其一张牌,记录 {source, cardId}。当前回合结束阶段(阶段开始·回合结束时机),
//     若其未失去此牌,你摸至四张。发动后翻为 阳。
//
// 关键点:
//   - 转换态经「回合用量」atom 投影 view.turnUsage['审时/态'];该字段无 /usedThisTurn 后缀,
//     state.vars 中跨回合持久,但 view.turnUsage 在「回合结束」被整体清空,故在拥有者
//     「回合开始」after-hook 重新同步一次,保证出牌阶段 activeWhen 读到正确态。
//   - 阳限一次:'审时/usedThisTurn'(后缀约定,回合结束自动清空)。
//   - 阴追踪:'审时/阴/追踪' 存 [{source, cardId}],无后缀持久,由 回合结束阶段 hook 处理后清空。
//   - 一个 respond action 按 requestType 分支(阴确认/阴给牌/阳致死确认/阳致死目标)。
import type {
  FrontendAPI,
  GameView,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { runDamageFlow } from '../flows/damage';
import { usedThisTurn, markOncePerTurn } from '../rules/once-per-turn';
import { defaultPlayActive } from '../rules/action-active';
import { registerAction, registerAfterHook, hasBlockingPending } from '../core/skill';
import type { SkillModule } from '../types';

const SKILL_ID = '审时';
/** 转换态 state key(跨回合持久,无 /usedThisTurn 后缀)。 */
const STATE_KEY = '审时/态';
/** 转换态 view 同步 key(经 回合用量 atom 投影 turnUsage)。 */
const STATE_VIEW_KEY = '审时/态';

const YIN_CONFIRM_RT = '审时/阴/confirm';
const YIN_GIVE_RT = '审时/阴/give';
const YIN_TRACK_KEY = '审时/阴/追踪';
const YANG_DEATH_CONFIRM_RT = '审时/阳/致死确认';
const YANG_DEATH_TARGET_RT = '审时/阳/致死目标';

const YIN_CONFIRMED_KEY = '审时/阴/confirmed';
const YIN_GIVE_KEY = '审时/阴/giveCard';
const YANG_DEATH_CONFIRMED_KEY = '审时/阳/致死确认结果';
const YANG_DEATH_TARGET_KEY = '审时/阳/致死目标结果';

type YinTrack = Array<{ source: number; cardId: string }>;

function getState(state: GameState, ownerId: number): '阳' | '阴' {
  return state.players[ownerId]?.vars[STATE_KEY] === '阴' ? '阴' : '阳';
}

async function syncStateView(state: GameState, ownerId: number): Promise<void> {
  await applyAtom(state, {
    type: '回合用量',
    player: ownerId,
    key: STATE_VIEW_KEY,
    value: getState(state, ownerId),
  });
}

/** 手牌数最多的其他存活角色候选 */
function maxHandOthers(state: GameState, ownerId: number): number[] {
  let maxCount = -1;
  const candidates: number[] = [];
  for (const p of state.players) {
    if (p.index === ownerId || !p.alive) continue;
    if (p.hand.length > maxCount) {
      maxCount = p.hand.length;
      candidates.length = 0;
      candidates.push(p.index);
    } else if (p.hand.length === maxCount) {
      candidates.push(p.index);
    }
  }
  return candidates;
}

/** 将手牌摸至四张:补到 4 张,已不少于 4 则不摸 */
async function drawToFour(state: GameState, player: number): Promise<void> {
  const target = state.players[player];
  if (!target?.alive) return;
  const need = 4 - target.hand.length;
  if (need > 0) {
    await applyAtom(state, { type: '摸牌', player, count: need });
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description:
      '转换技。阳:出牌阶段限一次,交给手牌数最多的其他角色一张牌并对其造成1点伤害,若其因此死亡,可令一名角色摸至四张。阴:其他角色对你造成伤害后,观看其手牌并交给其一张牌,当前回合结束阶段若其未失去此牌,你将手牌摸至四张',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:阴确认 / 阴给牌 / 阳致死确认 / 阳致死目标 ──
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
      if (rt === YIN_CONFIRM_RT || rt === YANG_DEATH_CONFIRM_RT) {
        return null; // confirm:接受 choice/confirmed
      }
      if (rt === YIN_GIVE_RT) {
        const ids = params.cardIds as string[] | undefined;
        if (!Array.isArray(ids) || ids.length === 0) return '需要选择一张牌';
        const self = st.players[ownerId];
        if (!ids.every((id) => self.hand.includes(id))) return '牌不在手牌中';
        return null;
      }
      if (rt === YANG_DEATH_TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t !== 'number') return '需要指定一名角色';
        if (!st.players[t]?.alive) return '目标不合法';
        return null;
      }
      return '当前不是审时回应';
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === YIN_CONFIRM_RT) {
        st.localVars[YIN_CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === YIN_GIVE_RT) {
        const ids = params.cardIds as string[] | undefined;
        if (Array.isArray(ids)) st.localVars[YIN_GIVE_KEY] = ids;
      } else if (rt === YANG_DEATH_CONFIRM_RT) {
        st.localVars[YANG_DEATH_CONFIRMED_KEY] =
          params.choice === true || params.confirmed === true;
      } else if (rt === YANG_DEATH_TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') st.localVars[YANG_DEATH_TARGET_KEY] = t;
      }
    },
  );

  // ── 阳:主动 use ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>) => {
      const self = st.players[ownerId];
      if (!self) return 'player not found';
      if (!self.alive) return '你已死亡';
      if (st.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
      if (st.phase !== '出牌') return '只能在出牌阶段使用';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId, SKILL_ID)) return '本回合已使用过审时';
      if (getState(st, ownerId) !== '阳') return '当前为阴状态,无法发动阳';
      if (self.hand.length === 0) return '需要有手牌才能发动审时';
      const target = params.target;
      if (typeof target !== 'number') return '需要指定目标';
      if (target === ownerId) return '不能对自己发动审时';
      if (!st.players[target]?.alive) return '目标不合法';
      // 目标必须是手牌数最多的其他存活角色
      const candidates = maxHandOthers(st, ownerId);
      if (candidates.length === 0) return '没有可选目标';
      if (!candidates.includes(target)) return '目标必须是手牌数最多的其他角色';
      const cardId = params.cardId;
      if (typeof cardId !== 'string') return '需要选择一张牌';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = params.target as number;
      const cardId = params.cardId as string;

      // 限一次 + 翻转为阴(同步写 vars,防 dispatch 重入)
      await markOncePerTurn(st, from, SKILL_ID);
      st.players[from].vars[STATE_KEY] = '阴';
      await syncStateView(st, from);

      await pushFrame(st, `${SKILL_ID}(阳)`, from, { target, cardId });

      // 交给目标一张牌
      if (st.players[from].hand.includes(cardId) && st.players[target]?.alive) {
        await applyAtom(st, { type: '给予', cardId, from, to: target });
      }

      // 对目标造成 1 点伤害(来源为发动者,经完整伤害流程,可被防具等减伤)
      if (st.players[target]?.alive) {
        await runDamageFlow(st, from, target, 1);
      }

      // 若其因此死亡,可令一名角色摸至四张
      if (!st.players[target]?.alive) {
        delete st.localVars[YANG_DEATH_CONFIRMED_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: YANG_DEATH_CONFIRM_RT,
          target: from,
          prompt: {
            type: 'confirm',
            title: '审时:目标因此死亡,是否令一名角色将手牌摸至四张?',
            confirmLabel: '发动',
            cancelLabel: '不发动',
          },
          defaultChoice: false,
          timeout: 20,
        });
        if (st.localVars[YANG_DEATH_CONFIRMED_KEY]) {
          delete st.localVars[YANG_DEATH_TARGET_KEY];
          await applyAtom(st, {
            type: '请求回应',
            requestType: YANG_DEATH_TARGET_RT,
            target: from,
            prompt: {
              type: 'choosePlayer',
              title: '审时:选择一名角色(将手牌摸至四张)',
              min: 1,
              max: 1,
              candidates: st.players.filter((p) => p.alive).map((p) => p.index),
              filter: (_view: GameView, t: number) => !!st.players[t]?.alive,
            },
            timeout: 20,
          });
          const chosen = st.localVars[YANG_DEATH_TARGET_KEY] as number | undefined;
          delete st.localVars[YANG_DEATH_TARGET_KEY];
          if (typeof chosen === 'number' && st.players[chosen]?.alive) {
            await drawToFour(st, chosen);
          }
        }
        delete st.localVars[YANG_DEATH_CONFIRMED_KEY];
      }

      await popFrame(st);
    },
  );

  // ── 阴:被动 after-hook on '受到伤害后' ──
  registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const source = atom.source;
    if (source === ownerId) return; // 仅"其他角色";无来源(source<0)→ players[source] 为空 → 下条拦
    if (getState(ctx.state, ownerId) !== '阴') return; // 仅阴状态
    if (!ctx.state.players[ownerId]?.alive) return;
    const sourcePlayer = ctx.state.players[source];
    if (!sourcePlayer?.alive) return;
    const self = ctx.state.players[ownerId];
    // 阴必须交给其一张牌:无手牌则无法结算,不触发(亦不翻转)
    if (!self || self.hand.length === 0) return;

    // 询问是否发动
    delete ctx.state.localVars[YIN_CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: YIN_CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '审时(阴):是否观看其手牌并交给其一张牌?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars[YIN_CONFIRMED_KEY]) return; // 不发动 → 不翻转
    delete ctx.state.localVars[YIN_CONFIRMED_KEY];

    // 选一张手牌交给其(owner 选自己的一张手牌;"观看其手牌"为信息优势,牌由 owner 给出)
    delete ctx.state.localVars[YIN_GIVE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: YIN_GIVE_RT,
      target: ownerId,
      prompt: {
        type: 'useCard',
        title: `审时(阴):选择一张手牌交给 ${sourcePlayer.name}`,
        cardFilter: { filter: () => true, min: 1, max: 1 },
      },
      timeout: 30,
    });
    const giveCards = ctx.state.localVars[YIN_GIVE_KEY] as string[] | undefined;
    delete ctx.state.localVars[YIN_GIVE_KEY];
    // 超时未给牌 → 技能未完整结算,不翻转、不追踪
    if (!Array.isArray(giveCards) || giveCards.length === 0) return;
    const giveCardId = giveCards[0];
    if (!self.hand.includes(giveCardId) || !ctx.state.players[source]?.alive) return;

    // 交给其一张牌
    await applyAtom(ctx.state, {
      type: '给予',
      cardId: giveCardId,
      from: ownerId,
      to: source,
    });

    // 完整结算:翻转为阳 + 记录追踪(回合结束阶段检查其是否仍持有此牌)
    ctx.state.players[ownerId].vars[STATE_KEY] = '阳';
    await syncStateView(ctx.state, ownerId);
    if (ctx.state.players[source]?.hand.includes(giveCardId)) {
      const track =
        (ctx.state.players[ownerId].vars[YIN_TRACK_KEY] as YinTrack | undefined) ?? [];
      track.push({ source, cardId: giveCardId });
      ctx.state.players[ownerId].vars[YIN_TRACK_KEY] = track;
    }
  });

  // ── 当前回合结束阶段:检查阴追踪,若其未失去此牌,owner 摸至四张 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    if (ctx.atom.type !== '阶段开始') return;
    if (ctx.atom.phase !== '回合结束') return;
    const ownerState = ctx.state.players[ownerId];
    const track = ownerState?.vars[YIN_TRACK_KEY] as YinTrack | undefined;
    if (!Array.isArray(track) || track.length === 0) return;
    // 清空追踪(无论是否触发摸牌,本回合结算完毕)
    ownerState.vars[YIN_TRACK_KEY] = [];
    if (!ownerState?.alive) return;
    for (const entry of track) {
      // 若其未失去此牌(仍在手牌),owner 摸至四张
      if (ctx.state.players[entry.source]?.hand.includes(entry.cardId)) {
        await drawToFour(ctx.state, ownerId);
        break; // 每回合只摸至四张一次
      }
    }
  });

  // ── 回合开始:重新同步转换态到 view(回合结束会整体清空 turnUsage) ──
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx) => {
    if (ctx.atom.type !== '回合开始') return;
    if (ctx.atom.player !== ownerId) return;
    await syncStateView(ctx.state, ownerId);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: SKILL_ID,
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '审时(阳):交给手牌数最多的其他角色一张牌,对其造成1点伤害',
      cardFilter: { filter: () => true, min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view: GameView, t: number) => {
          const me = view.currentPlayerIndex;
          if (t === me) return false;
          const tp = view.players.find((p) => p.index === t);
          if (!tp || tp.alive === false) return false;
          // 手牌数最多的其他存活角色(UI 提示,后端 validate 独立校验)
          let maxCount = -1;
          for (const p of view.players) {
            if (p.index === me || !p.alive) continue;
            const hc = p.handCount ?? 0;
            if (hc > maxCount) maxCount = hc;
          }
          return (tp.handCount ?? 0) === maxCount;
        },
      },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 仅阳状态可发动(读 turnUsage;回合开始已重新同步)
      if (p.turnUsage?.[STATE_VIEW_KEY] === '阴') return false;
      // 需有手牌
      if ((p.handCount ?? 0) === 0) return false;
      // 需存在其他存活角色
      return ctx.view.players.some(
        (other) => other.index !== ctx.perspectiveIdx && other.alive,
      );
    },
  });

  api.defineAction('respond', {
    label: SKILL_ID,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '审时',
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
