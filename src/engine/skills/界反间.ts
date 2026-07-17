// 界反间(界周瑜·吴·主动技):出牌阶段限一次，你可以展示并交给一名其他角色一张手牌，
// 其选择一项:1.展示所有手牌，弃置与此牌相同花色的牌;2.失去1点体力。
//
// 官方来源:三国杀 OL 界限突破 hero/308(逐字):
//   "出牌阶段限一次，你可以展示一张手牌并交给一名其他角色，然后令其选择一项:
//    1.展示所有手牌，弃置与此牌花色相同的所有牌;2.失去1点体力。"
//
// 界版变化(相对标版 src/engine/skills/反间.ts):
//   - 去除"猜花色"机制:周瑜自选一张手牌明给目标(非随机、非暗给)。
//   - 目标在「弃同色牌 / 失去1点体力」间二选一(非猜色比对)。
//   - 选项2 是「失去1点体力」(体力流失,用 失去体力 atom),非「造成伤害」:
//     无伤害来源、不触发反馈/天怒/狂骨等「受到伤害时」类技能。
//   - 选项1:目标弃置所有与所给牌同花色的手牌(含刚收到的那张牌本身)。
//
// 内部键名保持标版前缀('反间/xxx'):界版与标版互斥不共存(界裸衣规范)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';

/** 目标二选一请求类型。 */
const CHOICE_REQUEST = '反间/choice';
/** 目标选择结果 localVars key。true = 选项1(弃同色);false/undefined = 选项2(失体力)。 */
const CHOICE_KEY = '反间/choice';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界反间',
    description:
      '出牌阶段限一次,展示并交给一名其他角色一张手牌,其选择:弃置同色牌或失去1点体力',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── use action:出牌阶段,周瑜自选一张手牌 + 指定一名其他存活角色(限一次/回合) ──
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
      if (usedThisTurn(st, ownerId, '反间')) return '本回合已使用过反间';
      if (self.hand.length === 0) return '需要有手牌才能发动反间';
      const cardId = params.cardId as string | undefined;
      if (typeof cardId !== 'string' || !self.hand.includes(cardId)) return '需要选择一张手牌';
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets) || targets.length !== 1) return '需要指定一名目标';
      const target = targets[0];
      if (target === ownerId) return '不能对自己使用反间';
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive) return '目标不合法';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = (params.targets as number[])[0];
      const cardId = params.cardId as string;
      await pushFrame(st, '界反间', from, { ...params });

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(st, from, '反间');

      // ── 周瑜自选的手牌 → 目标手牌(明给:目标可见其牌面)──
      await applyAtom(st, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: from },
        to: { zone: '手牌', player: target },
      });

      // ── 目标二选一(选项1=弃同色,选项2=失体力)──
      delete st.localVars[CHOICE_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CHOICE_REQUEST,
        target,
        prompt: {
          type: 'confirm',
          title: '反间:展示所有手牌弃置同色牌，或失去1点体力',
          confirmLabel: '展示并弃置同色牌',
          cancelLabel: '失去1点体力',
        },
        defaultChoice: false,
        timeout: 30,
      });
      const choseDiscard = st.localVars[CHOICE_KEY] === true;

      if (choseDiscard) {
        // 选项1:目标展示所有手牌,弃置所有与所给牌同花色的牌(含刚收到的那张牌本身)。
        const givenSuit = st.cardMap[cardId]?.suit;
        const tp = st.players[target];
        if (givenSuit && tp?.alive) {
          const toDiscard = tp.hand.filter((id) => st.cardMap[id]?.suit === givenSuit);
          if (toDiscard.length > 0) {
            await applyAtom(st, { type: '弃置', player: target, cardIds: toDiscard });
          }
        }
      } else {
        // 选项2(含超时默认):目标失去1点体力(体力流失,无伤害来源)。
        const tp = st.players[target];
        if (tp?.alive) {
          await applyAtom(st, { type: '失去体力', target, amount: 1 });
        }
      }

      await popFrame(st);
    },
  );

  // ── respond:目标二选一(注册到每个座次,目标可能是任意玩家)──
  // dispatch 按 (skillId, ownerId, actionType) 查;各座次用独立闭包绑定 seatId,
  // 以 skillId='界反间' 隔离,不与其他技能 respond 冲突。
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const seatId = p.index;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as Record<string, unknown>;
        if (atom['type'] !== '请求回应') return '当前不需要回应';
        if (atom['requestType'] !== CHOICE_REQUEST) return '当前不是反间二选一';
        // choice 必须是布尔(前端 confirm prompt 提交 choice:true/false)
        if (typeof params.choice !== 'boolean') return '需要选择一项';
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        st.localVars[CHOICE_KEY] = params.choice === true;
      },
    );
    unloaders.push(u);
  }

  return () => {
    unloaders.forEach((u) => u());
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '界反间',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '反间:选一张手牌展示并交给一名其他角色',
      cardFilter: { filter: () => true, min: 1, max: 1 },
      targetFilter: { min: 1, max: 1, filter: (_view, t) => t !== skill.ownerId },
    },
    activeWhen: (ctx) =>
      activeUnlessUsedThisTurn('反间')(ctx) &&
      (ctx.view.players[ctx.perspectiveIdx]?.hand?.length ?? 0) > 0,
  });

  api.defineAction('respond', {
    label: '界反间',
    style: 'danger',
    prompt: {
      type: 'confirm',
      title: '反间:展示所有手牌弃置同色牌，或失去1点体力',
      confirmLabel: '展示并弃置同色牌',
      cancelLabel: '失去1点体力',
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
