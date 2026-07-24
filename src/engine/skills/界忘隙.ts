// 界忘隙(界李典·被动技,OL 界限突破官方逐字):
//   "当你对其他角色造成1点伤害后,或受到其他角色的1点伤害后,
//    你可以摸两张牌并交给该角色其中一张牌。"
//
// 两种触发情形(每 1 点伤害触发一次,与遗计/反馈一致):
//   A. owner 是伤害来源(source===ownerId, target!==ownerId):"该角色" = target
//   B. owner 是伤害目标(target===ownerId, source 存在且 !==ownerId):"该角色" = source
//   自伤(source===target===ownerId)不属于"其他角色",不触发。
//   闪电等无来源伤害:source 通常为 -1(系统),state.players[-1] 不存在 → 不触发
//   (符合"其他角色"语义,该伤害并非来自一名角色)。
//
// 流程:
//   1. 询问是否发动(confirm)
//   2. 摸 2 张牌(摸牌 count=2,入 owner 手牌;牌堆不足时按可用总数摸)
//   3. 选 1 张交给"该角色"(distribute select mode,cardIds=刚摸到的 2 张)
//   4. 给予 atom(from=owner, to=该角色)
//
// 实现要点:
//   - "其中一张牌":候选仅限刚摸到的 2 张(用摸牌前后手牌差集精确识别)
//   - 只摸到 1 张时直接交出(不再询问);0 张则跳过
//   - 若"该角色"在询问/摸牌期间死亡,跳过给予阶段
//   - 每点伤害单独判定"该角色"存活状态(上一点伤害可能击杀对方)
//
// 命名:文件名/loader key/character skill name 均为 '界忘隙'(避开未来标版 '忘隙' 冲突);
//   内部 Skill.name = '忘隙'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界忘隙';
const DISPLAY_NAME = '忘隙';
const CONFIRM_RT = '忘隙/confirm';
const PICK_RT = '忘隙/pick';
const CONFIRMED_KEY = '忘隙/confirmed';
const PICK_KEY = '忘隙/pickChoice';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '对其他角色造成1点伤害后,或受到其他角色1点伤害后,摸两张牌并交给该角色其中一张',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理 忘隙/confirm 与 忘隙/pick 两种询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as unknown as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== CONFIRM_RT && rt !== PICK_RT) return '当前不是忘隙询问';

      if (rt === PICK_RT) {
        // 校验:cardIds 必须是 1 张且在候选范围(prompt.cardIds 刚摸到的 2 张)
        const pickAtom = atom as { prompt?: { cardIds?: string[] } };
        const candidates: string[] = pickAtom.prompt?.cardIds ?? [];
        const candidateSet = new Set(candidates);
        const chosen = (params.cardIds as string[] | undefined) ?? [];
        if (chosen.length !== 1) return '忘隙:必须选择 1 张牌交给该角色';
        if (!candidateSet.has(chosen[0])) return '忘隙:所选牌不在刚摸到的牌中';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as Record<string, unknown>)?.requestType as string;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === PICK_RT) {
        const ids = (params.cardIds as string[] | undefined) ?? [];
        st.localVars[PICK_KEY] = ids[0] ?? null;
      }
    },
  );

  // ── 忘隙主逻辑:摸 2 张 + 选 1 张交给 other(每点伤害一次)──
  async function forgetGapOnce(state: GameState, other: number): Promise<void> {
    if (!state.players[ownerId]?.alive) return;
    if (!state.players[other]?.alive) return;

    delete state.localVars[CONFIRMED_KEY];
    await applyAtom(state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `忘隙:是否摸两张牌并交给 P${other} 一张?`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!state.localVars[CONFIRMED_KEY]) {
      delete state.localVars[CONFIRMED_KEY];
      return;
    }
    delete state.localVars[CONFIRMED_KEY];

    const totalAvail = state.zones.deck.length + state.zones.discardPile.length;
    if (totalAvail === 0) return;

    const handBefore = new Set(state.players[ownerId].hand);
    const drawCount = Math.min(2, totalAvail);
    await applyAtom(state, { type: '摸牌', player: ownerId, count: drawCount });
    const handAfter = state.players[ownerId].hand;
    const drawn = handAfter.filter((id) => !handBefore.has(id));

    if (drawn.length === 0) return;
    if (!state.players[other]?.alive) return;

    if (drawn.length === 1) {
      await applyAtom(state, { type: '给予', cardId: drawn[0], from: ownerId, to: other });
      return;
    }

    delete state.localVars[PICK_KEY];
    await applyAtom(state, {
      type: '请求回应',
      requestType: PICK_RT,
      target: ownerId,
      prompt: {
        type: 'distribute',
        mode: 'select',
        title: `忘隙:选择 1 张牌交给 P${other}`,
        cardIds: drawn,
        minTotal: 1,
        maxTotal: 1,
      },
      defaultChoice: false,
      timeout: 15,
    });

    const chosen = state.localVars[PICK_KEY] as string | null;
    delete state.localVars[PICK_KEY];
    if (typeof chosen === 'string' && state.players[other]?.alive) {
      await applyAtom(state, { type: '给予', cardId: chosen, from: ownerId, to: other });
    }
  }

  // 造成伤害后:owner 是来源 → other = target
  registerAfterHook(state, skill.id, ownerId, '造成伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    if (atom.target === undefined || atom.target === ownerId) return;
    const amount = atom.amount ?? 0;
    if (amount <= 0) return;
    for (let i = 0; i < amount; i++) {
      if (!ctx.state.players[atom.target]?.alive) break;
      await forgetGapOnce(ctx.state, atom.target);
    }
  });

  // 受到伤害后:owner 是目标 → other = source
  registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    const source = atom.source;
    if (typeof source !== 'number' || source === ownerId || source < 0) return;
    const amount = atom.amount ?? 0;
    if (amount <= 0) return;
    for (let i = 0; i < amount; i++) {
      if (!ctx.state.players[source]?.alive) break;
      await forgetGapOnce(ctx.state, source);
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
      title: '是否发动忘隙?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
