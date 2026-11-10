// 鸿举(毌丘俭·魏·觉醒技,OL hero/413 官方逐字):
//   "准备阶段,若'荣'的数量不小于3,你用任意手牌替换等量的'荣',
//    减少1点体力上限并获得'清侧'。"
//
// 模式(觉醒技,强制):after hook 挂在「阶段开始」(phase='准备')。
//   准备阶段(player===ownerId) → 荣≥3 且未觉醒 → 强制结算:
//     1. 用任意张手牌替换等量的荣(select prompt,k∈[0,min(hand,荣count)]):
//        移去 k 张旧荣标记;选中的 k 张手牌弃置→加为新荣标记(荣总数不变)
//     2. 减1点体力上限(设上限 amount=maxHealth-1;clamp 体力)
//     3. 永久获得"清侧"(添加技能 skillId='清侧')
//   觉醒标记:player.vars['鸿举/awakened'](整局一次,不被「回合结束」自动清理)
//
// 关键点:
//   - 觉醒技:整局一次,强制发动(条件满足即触发,不可不触发);换荣的张数由玩家选
//   - 触发时机:文档「准备阶段」,挂在「阶段开始」phase='准备'
//   - "等量":选 k 张手牌替换 k 张荣(1:1);可全换(k=荣数)或部分换,也可不换(k=0)
//   - 荣实体牌存于征荣/实体荣暂存列表,不留在可重洗的弃牌堆。
//   - "清侧"技能尚未实现:添加技能 atom 会把 '清侧' 加入 skills 列表;
//     实例化由其 loader 决定(未注册则跳过,不影响觉醒其余效果)
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import type { SkillModule } from '../types';
import { RONG_CARDS_KEY, RONG_PREFIX, rongCount } from './征荣';

const AWAKENED_KEY = '鸿举/awakened';
const REPLACE_RONG_RT = '鸿举/换出荣';
const REPLACE_HAND_RT = '鸿举/换入手牌';
const REPLACE_RONG_KEY = '鸿举/换出荣结果';
const REPLACE_HAND_KEY = '鸿举/换入牌结果';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '鸿举',
    description: '觉醒技:准备阶段若荣≥3,用任意手牌替换等量的荣,减1体力上限并获得"清侧"',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:先选要换出的荣,再选等量手牌换入。
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type: string; requestType?: string };
      if (atom.type !== '请求回应' || (atom.requestType !== REPLACE_RONG_RT && atom.requestType !== REPLACE_HAND_RT)) {
        return '当前不是鸿举换荣';
      }
      const cardIds = params.cardIds as string[] | undefined;
      if (Array.isArray(cardIds)) {
        const seen = new Set<string>();
        const marks = st.players[ownerId].marks.filter((m) => m.id.startsWith(RONG_PREFIX));
        const rongIds = new Set(marks.map((m) => (m.payload as { cardId?: string } | undefined)?.cardId).filter((id): id is string => {
          return typeof id === 'string' && (
            (st.players[ownerId].vars[RONG_CARDS_KEY] as string[] | undefined)?.includes(id) === true ||
            st.zones.discardPile.includes(id)
          );
        }));
        const expected = atom.requestType === REPLACE_RONG_RT ? rongIds : new Set(st.players[ownerId].hand);
        for (const id of cardIds) {
          if (typeof id !== 'string') return 'cardId 必须为字符串';
          if (!expected.has(id)) return atom.requestType === REPLACE_RONG_RT ? '所选牌不是可替换的荣' : '牌不在手牌中';
          if (seen.has(id)) return '存在重复的牌';
          seen.add(id);
        }
        if (atom.requestType === REPLACE_RONG_RT && cardIds.length > Math.min(st.players[ownerId].hand.length, rongIds.size)) return '替换数量超过可替换荣数';
        if (atom.requestType === REPLACE_HAND_RT) {
          const chosenRong = st.localVars[REPLACE_RONG_KEY] as string[] | undefined;
          if (cardIds.length !== chosenRong?.length) return '换入手牌数量必须与换出荣相同';
        }
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const atom = st.pendingSlots.get(ownerId)?.atom as { requestType?: string } | undefined;
      if (atom?.requestType === REPLACE_RONG_RT) st.localVars[REPLACE_RONG_KEY] = params.cardIds ?? [];
      else st.localVars[REPLACE_HAND_KEY] = params.cardIds ?? [];
    },
  );

  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '准备') return;
    if (ctx.state.players[ownerId]?.vars[AWAKENED_KEY]) return; // 整局一次
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    const rc = rongCount(ctx.state, ownerId);
    if (rc < 3) return;

    // 标记已觉醒(读完条件立即设,防重入)
    ctx.state.players[ownerId].vars[AWAKENED_KEY] = true;

    // 1. 用任意张手牌替换等量的荣(可选 0..min(hand, rc))
    const oldRong = self.marks.filter((m) => m.id.startsWith(RONG_PREFIX));
    const availableRong = oldRong.map((m) => (m.payload as { cardId?: string } | undefined)?.cardId)
      .filter((id): id is string => typeof id === 'string' && (
        (self.vars[RONG_CARDS_KEY] as string[] | undefined)?.includes(id) === true ||
        ctx.state.zones.discardPile.includes(id)
      ));
    const maxReplace = Math.min(self.hand.length, availableRong.length);
    if (maxReplace > 0) {
      delete ctx.state.localVars[REPLACE_RONG_KEY];
      delete ctx.state.localVars[REPLACE_HAND_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: REPLACE_RONG_RT,
        target: ownerId,
        prompt: {
          type: 'distribute',
          mode: 'select',
          title: '鸿举:选择要换回手牌的荣(可不选)',
          cardIds: availableRong,
          minTotal: 0,
          maxTotal: maxReplace,
        },
        defaultChoice: [] as unknown as Json,
        timeout: 20,
      });
      const selectedOld = (ctx.state.localVars[REPLACE_RONG_KEY] as string[] | undefined) ?? [];
      const k = Math.min(selectedOld.length, maxReplace);
      let selectedNew: string[] = [];
      if (k > 0) {
        await applyAtom(ctx.state, {
          type: '请求回应', requestType: REPLACE_HAND_RT, target: ownerId,
          prompt: {
            type: 'distribute', mode: 'select', title: '鸿举:选择等量手牌换入荣区', source: 'hand',
            minTotal: k, maxTotal: k,
          },
          defaultChoice: self.hand.slice(0, k) as unknown as Json, timeout: 20,
        });
        selectedNew = (ctx.state.localVars[REPLACE_HAND_KEY] as string[] | undefined) ?? [];
      }

      // 移去 k 张旧荣标记,并将每张对应实体牌返还手牌。
      for (const oldCardId of selectedOld.slice(0, k)) {
        const oldMark = self.marks.find((m) => m.id.startsWith(RONG_PREFIX) && (m.payload as { cardId?: string } | undefined)?.cardId === oldCardId);
        if (!oldMark) continue;
        await applyAtom(ctx.state, { type: '去标记', player: ownerId, markId: oldMark.id });
        if (oldCardId && (self.vars[RONG_CARDS_KEY] as string[] | undefined)?.includes(oldCardId)) {
          await applyAtom(ctx.state, {
            type: '移动暂存牌', player: ownerId, varsKey: RONG_CARDS_KEY, cardId: oldCardId, to: '手牌',
          });
        } else if (oldCardId && ctx.state.zones.discardPile.includes(oldCardId)) {
          // 兼容旧荣标记:其真实牌曾被弃入弃牌堆。
          await applyAtom(ctx.state, {
            type: '移动牌', cardId: oldCardId, from: { zone: '弃牌堆' }, to: { zone: '手牌', player: ownerId },
          });
        }
      }
      // 选中的 k 张手牌移出标准牌区作为新荣,实体牌不进入弃牌堆。
      for (const cardId of selectedNew.slice(0, k)) {
        await applyAtom(ctx.state, {
          type: '移出至暂存区', source: ownerId, target: ownerId, cardIds: [cardId], varsKey: RONG_CARDS_KEY,
        });
        await applyAtom(ctx.state, {
          type: '加标记',
          player: ownerId,
          mark: {
            id: `${RONG_PREFIX}${ctx.state.seq}`,
            scope: ownerId,
            payload: { cardId },
          },
        });
      }
      delete ctx.state.localVars[REPLACE_RONG_KEY];
      delete ctx.state.localVars[REPLACE_HAND_KEY];
    }

    // 2. 减1点体力上限(设上限 clamp 体力:当前体力 ≤ 新上限则保持)
    await applyAtom(ctx.state, {
      type: '设上限',
      player: ownerId,
      amount: self.maxHealth - 1,
    });

    // 3. 永久获得"清侧"
    await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: '清侧' });
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 觉醒技,被动触发,无主动 action
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
