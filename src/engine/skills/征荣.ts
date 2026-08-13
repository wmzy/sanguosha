// 征荣(毌丘俭·魏·被动技,OL hero/413 官方逐字):
//   "当你使用【杀】或伤害锦囊牌时,你可以选择其中一个手牌数不小于你的目标角色,
//    将其一张牌置于你的武将牌上,称为'荣'。"
//
// 模式 A(被动触发):after hook 挂在「使用时」(use.md 时机2:牌已入处理区、目标已声明)。
//   使用 杀/伤害锦囊 → 取栈顶帧声明目标 → 筛"手牌数≥己且有可取牌"的目标 →
//   询问发动 → (多名合格则选目标) → 选牌面板(获得至手)→ 弃置入武将牌 → 加"荣"标记。
//
// "荣"的存储:每张荣 = 一个 mark,id 形如 `征荣/荣:N`,payload.cardId 携带原牌 id。
//   物理牌经 获得(目标→owner 手)→ 弃置(owner 手→弃牌堆)两步落入弃牌堆,
//   earmark 在 mark(与 界醇醪"醇"、屯田"田"同构);荣可见(mark 投影到 view)。
//   count = player.marks.filter(m => m.id.startsWith('征荣/荣:')).length
//
// 关键点:
//   - 触发时机:「使用时」(每张牌一次),source===ownerId
//   - "伤害锦囊牌" = 造成伤害的锦囊(南蛮入侵/万箭齐发/火攻/决斗)
//   - "手牌数不小于你" = target.hand.length >= owner.hand.length(使用时牌已出,hand 为出后)
//   - 一次使用只取一张荣(在合格目标中 choose ONE)
//   - 荣可见(mark 投影到 view,同 屯田"田")
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { topFrame } from '../core/frame';
import { registerAction, registerAfterHook } from '../core/skill';
import { runPickTargetCardPanel } from '../flows/pick-card-panel';
import type { SkillModule } from '../types';
import { PICK_RESULT_KEY } from '../rules/vars-keys';

const CONFIRM_RT = '征荣/confirm';
const PICK_TARGET_RT = '征荣/选目标';
const PICK_CARD_RT = '征荣/选牌';
const CONFIRMED_KEY = '征荣/confirmed';
const TARGET_KEY = '征荣/目标';
/** 荣标记 id 前缀(鸿举 共用)。 */
export const RONG_PREFIX = '征荣/荣:';

/** 伤害锦囊牌(造成伤害的锦囊):南蛮入侵/万箭齐发/火攻/决斗 */
const DAMAGE_TRICKS = new Set(['南蛮入侵', '万箭齐发', '火攻', '决斗']);

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '征荣',
    description: '使用杀或伤害锦囊牌时,可将一名手牌数不小于你的目标角色的一张牌置于武将牌上为"荣"',
  };
}

/** 数玩家当前的荣数量(鸿举 复用) */
export function rongCount(state: GameState, player: number): number {
  return state.players[player].marks.filter((m) => m.id.startsWith(RONG_PREFIX)).length;
}

/** 目标是否有可取的牌(手牌或装备) */
function hasTakeableCard(state: GameState, player: number): boolean {
  const p = state.players[player];
  return p.hand.length > 0 || Object.keys(p.equipment).length > 0;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:按 requestType 分支(confirm / 选目标 / 选牌)
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不需要回应';
      const rt = atom.requestType;
      if (rt === CONFIRM_RT) {
        return null; // confirm:接受 choice/confirmed 布尔
      }
      if (rt === PICK_TARGET_RT) {
        const target = params.target ?? params.choice;
        if (typeof target !== 'number') return 'target required';
        return null;
      }
      if (rt === PICK_CARD_RT) {
        // 选牌面板:校验 zone + cardId/handIndex(同反馈/过河拆桥)
        const zone = params.zone;
        if (zone === 'equipment') {
          if (typeof params.cardId !== 'string') return 'cardId required';
        } else if (zone === 'hand') {
          if (typeof params.handIndex !== 'number') return 'handIndex required';
        } else {
          return 'zone required (equipment|hand)';
        }
        return null;
      }
      return '当前不是征荣回应';
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === PICK_TARGET_RT) {
        const target = params.target ?? params.choice;
        if (typeof target === 'number') st.localVars[TARGET_KEY] = target;
      } else if (rt === PICK_CARD_RT) {
        st.localVars[PICK_RESULT_KEY] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
          handIndex: params.handIndex ?? null,
        };
      }
    },
  );

  // 使用时 after-hook:source===ownerId 且为 杀/伤害锦囊 → 询问取荣
  registerAfterHook(state, skill.id, ownerId, '使用时', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type: string; source?: number; cardId?: string };
    if (atom.type !== '使用时') return;
    if (atom.source !== ownerId) return;
    if (!atom.cardId) return;
    const card = ctx.state.cardMap[atom.cardId];
    if (!card) return;
    const isTrigger = card.name === '杀' || DAMAGE_TRICKS.has(card.name);
    if (!isTrigger) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 取栈顶帧的声明目标(resolvedTargets 可能被流离等改写,fallback 到 targets)
    const frame = topFrame(ctx.state);
    const targets =
      (frame?.params.resolvedTargets as number[] | undefined) ??
      (frame?.params.targets as number[] | undefined) ??
      [];
    const myHand = self.hand.length;

    // 筛选:存活、非己、手牌数≥己、有可取的牌
    const eligible = targets.filter(
      (t) =>
        t !== ownerId &&
        ctx.state.players[t]?.alive &&
        ctx.state.players[t].hand.length >= myHand &&
        hasTakeableCard(ctx.state, t),
    );
    if (eligible.length === 0) return;

    // 询问是否发动
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动征荣?(将一名手牌数不小于你的目标的一张牌置为荣)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    // 选择目标(若多名合格)
    let target: number;
    if (eligible.length === 1) {
      target = eligible[0];
    } else {
      delete ctx.state.localVars[TARGET_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: PICK_TARGET_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '征荣:选择一名目标角色',
          min: 1,
          max: 1,
          candidates: [...eligible],
        },
        defaultChoice: eligible[0] as unknown as Json,
        timeout: 15,
      });
      const picked = ctx.state.localVars[TARGET_KEY];
      if (typeof picked !== 'number') return;
      target = picked;
    }

    const targetPlayer = ctx.state.players[target];
    if (!targetPlayer?.alive || !hasTakeableCard(ctx.state, target)) return;

    // 选牌面板(获得模式):目标一张牌 → owner 手牌(获得 语义=毌丘俭取走,同反馈/顺手牵羊)
    const handLenBefore = ctx.state.players[ownerId].hand.length;
    await runPickTargetCardPanel(ctx.state, ownerId, target, targetPlayer, {
      mode: 'obtain',
      requestType: PICK_CARD_RT,
      title: '征荣:选择该目标的一张牌置为荣',
      includeJudge: false,
    });
    // 获得 push 到手牌末尾:新牌位于 hand[handLenBefore](无新牌则面板 no-op,跳过)
    const newCardId = ctx.state.players[ownerId].hand[handLenBefore];
    if (!newCardId) return;

    // 将该牌从手牌置入武将牌为"荣":owner 弃之(入弃牌堆 earmark)→ 加荣标记
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [newCardId] });
    await applyAtom(ctx.state, {
      type: '加标记',
      player: ownerId,
      mark: {
        id: `${RONG_PREFIX}${ctx.state.seq}`,
        scope: ownerId,
        payload: { cardId: newCardId },
      },
    });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '征荣',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动征荣？',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
