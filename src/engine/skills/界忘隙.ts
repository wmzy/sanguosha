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
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
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

/**
 * 从一次造成伤害 atom 判定忘隙的"该角色"(另一方向)。
 * 返回 undefined 表示不触发(自伤 / 无来源 / "该角色"已死)。
 */
function findOther(
  state: GameState,
  ownerId: number,
  atom: { source?: number; target?: number; amount?: number },
): number | undefined {
  const amount = atom.amount ?? 0;
  if (amount <= 0) return undefined;
  const source = atom.source;
  const target = atom.target;
  // 情形 A:owner 造成伤害给其他角色
  if (source === ownerId && target !== undefined && target !== ownerId) {
    return state.players[target]?.alive ? target : undefined;
  }
  // 情形 B:owner 受到其他角色伤害(source 须为有效角色座次)
  if (
    target === ownerId &&
    source !== undefined &&
    source !== ownerId &&
    source >= 0 &&
    source < state.players.length
  ) {
    return state.players[source]?.alive ? source : undefined;
  }
  return undefined;
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

  // 造成伤害 after:每点伤害触发一次
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: number; target?: number; amount?: number };
    const amount = atom.amount ?? 0;
    if (amount <= 0) return;

    for (let i = 0; i < amount; i++) {
      if (!ctx.state.players[ownerId]?.alive) break;

      // 每点伤害单独判定"该角色"(上一点可能击杀对方)
      const other = findOther(ctx.state, ownerId, atom);
      if (other === undefined) break;

      // 询问是否发动
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
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
      if (!ctx.state.localVars[CONFIRMED_KEY]) {
        delete ctx.state.localVars[CONFIRMED_KEY];
        continue;
      }
      delete ctx.state.localVars[CONFIRMED_KEY];

      // 牌堆+弃牌堆=0 时无牌可摸,跳过
      const totalAvail =
        ctx.state.zones.deck.length + ctx.state.zones.discardPile.length;
      if (totalAvail === 0) break;

      // 摸前手牌快照(精确识别"刚摸到的 2 张")
      const handBefore = new Set(ctx.state.players[ownerId].hand);
      const drawCount = Math.min(2, totalAvail);
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: drawCount });
      const handAfter = ctx.state.players[ownerId].hand;
      const drawn = handAfter.filter((id) => !handBefore.has(id));

      // 没摸到牌(牌堆+弃牌堆不足以摸):跳过交牌
      if (drawn.length === 0) continue;

      // 若"该角色"在询问/摸牌期间死亡:跳过给予
      if (!ctx.state.players[other]?.alive) continue;

      // 只摸到 1 张:直接交出(不再询问)
      if (drawn.length === 1) {
        await applyAtom(ctx.state, {
          type: '给予',
          cardId: drawn[0],
          from: ownerId,
          to: other,
        });
        continue;
      }

      // 摸到 2 张:询问选 1 张交给"该角色"
      delete ctx.state.localVars[PICK_KEY];
      await applyAtom(ctx.state, {
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

      const chosen = ctx.state.localVars[PICK_KEY] as string | null;
      delete ctx.state.localVars[PICK_KEY];
      if (typeof chosen === 'string' && ctx.state.players[other]?.alive) {
        await applyAtom(ctx.state, {
          type: '给予',
          cardId: chosen,
          from: ownerId,
          to: other,
        });
      }
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
