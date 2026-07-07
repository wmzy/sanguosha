// 固政(张昭张纮·吴·被动技):其他角色的弃牌阶段结束时,你可以将弃牌堆中一张该角色
// 弃置的牌返回其手牌,然后获得其余弃牌。
//
// 实现机制:
//   1. 弃置 afterHook:当 state.phase==='弃牌' 时,记录该玩家本阶段弃置的牌到 localVars。
//   2. 阶段结束(弃牌) afterHook:对"其他角色"(非自己)若有弃牌记录,询问是否发动固政:
//      a. 请求回应(固政/确认):是否发动 → confirmed
//      b. 若确认且弃牌 >1 张:请求回应(固政/选牌):选一张返回该角色
//      c. 移动牌:所选牌 弃牌堆→该角色手牌;其余牌 弃牌堆→自己手牌
//   3. respond action:处理 确认/选牌 两步回应(分支按当前 pending requestType)。
//
// 关键点:
//   - 触发时机依赖 阶段结束(弃牌):__弃牌 的弃置在 请求回应 pending resolve 后、
//     阶段结束(弃牌) 触发前完成,故记录已就绪(弃置 afterHook 先于本 hook 读到数据)。
//   - ctx.atom.phase==='弃牌' 稳定(不受 state.phase 在多 hook 间被推进影响)。
//   - 每回合限一次:每个其他角色的弃牌阶段只有一个,自然满足。
//   - 仅弃牌阶段弃置的牌计入("该角色弃置的牌");非弃牌阶段的弃置(制衡/寒冰剑等)被
//     state.phase!=='弃牌' 过滤。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const CONFIRM_REQUEST = '固政/确认';
const PICK_REQUEST = '固政/选牌';
const CONFIRM_KEY = '固政/确认结果';
const PICK_KEY = '固政/所选牌';
/** localVars key 前缀:固政/弃牌/<player> = 该玩家本弃牌阶段弃置的 cardIds */
function discardKey(player: number): string {
  return `固政/弃牌/${player}`;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '固政',
    description: '其他角色弃牌阶段结束时:将其一张弃牌返回其手牌,然后获得其余弃牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 弃置 afterHook:记录弃牌阶段弃置的牌 ──
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx: AtomAfterContext) => {
    if (ctx.state.phase !== '弃牌') return;
    const atom = ctx.atom as { player: number; cardIds: string[] };
    const key = discardKey(atom.player);
    const existing = ctx.state.localVars[key] as string[] | undefined;
    ctx.state.localVars[key] = [...(existing ?? []), ...atom.cardIds];
  });

  // ── 阶段结束 afterHook:其他角色弃牌阶段结束时发动固政 ──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段结束',
    async (ctx: AtomAfterContext) => {
      const atom = ctx.atom as { player: number; phase: string };
      if (atom.phase !== '弃牌') return;
      const player = atom.player;
      // 仅对其他角色
      if (player === ownerId) return;
      const st = ctx.state;
      // 读取该玩家本阶段弃置的牌
      const cardIds = st.localVars[discardKey(player)] as string[] | undefined;
      delete st.localVars[discardKey(player)];
      if (!cardIds || cardIds.length === 0) return; // 本阶段未弃牌,不触发
      // 自己须存活
      if (!st.players[ownerId]?.alive) return;

      await pushFrame(st, '固政', ownerId, { target: player, cardIds: [...cardIds] });

      // ── 第一步:是否发动固政 ──
      delete st.localVars[CONFIRM_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CONFIRM_REQUEST,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动固政?(${st.players[player]?.name ?? ''} 弃置了 ${cardIds.length} 张牌)`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 30,
      });
      const confirmed = st.localVars[CONFIRM_KEY] === true;
      if (!confirmed) {
        await popFrame(st);
        return;
      }

      // ── 第二步:选择一张牌返回该角色 ──
      // 仅在弃牌堆中仍然存在的牌中选择(防御性:理论上不会有牌被移走)
      const available = cardIds.filter((id) => st.zones.discardPile.includes(id));
      let chosen: string;
      if (available.length <= 1) {
        // 只有一张(或已被移走):自动选定唯一一张。若无可用牌则跳过(理论上不发生)
        if (available.length === 0) {
          await popFrame(st);
          return;
        }
        chosen = available[0];
      } else {
        delete st.localVars[PICK_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: PICK_REQUEST,
          target: ownerId,
          prompt: {
            type: 'pickProcessingCard',
            title: '固政:选择一张牌返回其手牌(其余你将获得)',
            cards: available.map((id) => {
              const c = st.cardMap[id];
              return { cardId: id, cardName: c?.name ?? '?', suit: c?.suit ?? '', rank: c?.rank ?? '' };
            }),
          },
          defaultChoice: available[0],
          timeout: 30,
        });
        const picked = st.localVars[PICK_KEY] as string | undefined;
        chosen = picked && available.includes(picked) ? picked : available[0];
      }

      // ── 第三步:返回所选牌 + 获得其余 ──
      const rest = available.filter((id) => id !== chosen);
      // 所选牌 弃牌堆 → 该角色手牌
      await applyAtom(st, {
        type: '移动牌',
        cardId: chosen,
        from: { zone: '弃牌堆' },
        to: { zone: '手牌', player },
      });
      // 其余牌 弃牌堆 → 自己手牌
      for (const id of rest) {
        await applyAtom(st, {
          type: '移动牌',
          cardId: id,
          from: { zone: '弃牌堆' },
          to: { zone: '手牌', player: ownerId },
        });
      }

      await popFrame(st);
    },
  );

  // ── respond action:处理 确认 / 选牌 两步回应(按当前 pending requestType 分支)──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是固政窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType === CONFIRM_REQUEST) {
        // 确认/不确认都接受
        return null;
      }
      if (atom.requestType === PICK_REQUEST) {
        const cardId = params.cardId;
        if (typeof cardId !== 'string') return '需要选择一张牌';
        return null;
      }
      return '当前不是固政窗口';
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId)!;
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType === CONFIRM_REQUEST) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (atom.requestType === PICK_REQUEST) {
        st.localVars[PICK_KEY] = params.cardId as string;
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 固政为被动技,无主动 action 按钮需要声明
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
