// 天香(小乔·被动触发):当你受到伤害时,你可以弃置一张红桃手牌,
// 将此伤害转移给任意一名其他角色,然后该角色摸X张牌(X为其已损失体力值)。
//
// 时机:造成伤害 before hook(伤害结算前)。target=自己 + amount>0 时触发。
// 流程(确认发动后):
//   1. 弃置一张红桃手牌(红颜锁定技下黑桃也视为红桃)
//   2. cancel 原伤害 atom(小乔不再受伤)
//   3. 对新目标 applyAtom(造成伤害),保留原 source/amount/damageType(转移伤害本身)
//      —— 新伤害走完整管线(含濒死/反馈等 after hook)
//   4. 新目标(若存活)摸 X 张牌,X = maxHealth - health(伤害结算后的已损失体力值)
//
// 关键点:
//   - 不能转移给自己(target !== ownerId)
//   - 转移的是伤害本身(不是攻击),保留原伤害来源(奖励归属不变,见 FAQ)
//   - 属性伤害转移后,连环传导由 造成伤害 的既有机能处理,本技能不特殊编码
//   - 红颜联动:小乔拥有「红颜」技能时,黑桃手牌也作为合法弃牌
import type {
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';

const CONFIRM_RT = '天香/confirm';
const CHOOSE_RT = '天香/choose';
const CONFIRMED_KEY = '天香/confirmed';
const CARD_KEY = '天香/cardId';
const TARGET_KEY = '天香/target';

/** 判定一张手牌对天香是否合法:红桃;若拥有红颜,黑桃也视为红桃。 */
function isTianxiangCard(state: GameState, ownerId: number, cardId: string): boolean {
  const card = state.cardMap[cardId];
  if (!card) return false;
  if (card.suit === '♥') return true;
  if (card.suit === '♠' && state.players[ownerId]?.skills.includes('红颜')) return true;
  return false;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '天香',
    description: '受到伤害时,弃一张红桃手牌将伤害转移给其他角色,其摸X张牌(X为已损失体力值)',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:回应天香的确认 + 选牌选目标 ──
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
      if (rt !== CONFIRM_RT && rt !== CHOOSE_RT) return '当前不是天香询问';
      if (rt === CONFIRM_RT) return null; // confirm:任意 choice 均可(含放弃)

      // choose:校验 cardId + target
      const cardId = params.cardId as string | undefined;
      const target = params.target as number | undefined;
      if (typeof cardId !== 'string') return '请选择一张红桃手牌';
      const self = st.players[ownerId];
      if (!self?.hand.includes(cardId)) return '牌不在手牌中';
      if (!isTianxiangCard(st, ownerId, cardId)) return '必须选择红桃手牌';
      if (typeof target !== 'number') return '请选择转移目标';
      if (target === ownerId) return '不能转移给自己';
      if (!st.players[target]?.alive) return '目标无效';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as Record<string, unknown>)?.requestType as string;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === CHOOSE_RT) {
        st.localVars[CARD_KEY] = (params.cardId) ?? null;
        st.localVars[TARGET_KEY] = (params.target) ?? null;
      }
    },
  );

  // ── 造成伤害 before:小乔受伤前询问是否转移 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as {
        target?: number;
        source?: number;
        amount?: number;
        cardId?: string;
        damageType?: '普通' | '火焰' | '雷电';
      };
      if (atom.target !== ownerId) return;
      const amount = atom.amount ?? 0;
      if (amount <= 0) return;

      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 发动条件:有红桃手牌(红颜下黑桃也算)+ 场上有其他存活角色
      const validCards = self.hand.filter((id) => isTianxiangCard(ctx.state, ownerId, id));
      if (validCards.length === 0) return;
      const hasOtherAlive = ctx.state.players.some((p, i) => i !== ownerId && p.alive);
      if (!hasOtherAlive) return;

      // 1) 询问是否发动
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动天香?',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (!ctx.state.localVars[CONFIRMED_KEY]) return;

      // 2) 询问弃牌 + 转移目标
      delete ctx.state.localVars[CARD_KEY];
      delete ctx.state.localVars[TARGET_KEY];
      const hasHongyan = self.skills.includes('红颜');
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CHOOSE_RT,
        target: ownerId,
        prompt: {
          type: 'useCardAndTarget',
          title: '天香:弃一张红桃手牌,将伤害转移给一名其他角色',
          cardFilter: {
            filter: (c) => c.suit === '♥' || (hasHongyan && c.suit === '♠'),
            min: 1,
            max: 1,
          },
          targetFilter: {
            min: 1,
            max: 1,
            filter: (_view, t) => t !== ownerId && ctx.state.players[t]?.alive === true,
          },
        },
        timeout: 15,
      });

      const cardId = ctx.state.localVars[CARD_KEY] as string | undefined;
      const newTarget = ctx.state.localVars[TARGET_KEY] as number | undefined;
      delete ctx.state.localVars[CONFIRMED_KEY];
      delete ctx.state.localVars[CARD_KEY];
      delete ctx.state.localVars[TARGET_KEY];
      // 未提供有效牌/目标 → 放弃发动(小乔照常受伤)
      if (typeof cardId !== 'string' || typeof newTarget !== 'number') return;
      if (newTarget === ownerId) return;
      const targetPlayer = ctx.state.players[newTarget];
      if (!targetPlayer?.alive) return;
      if (!self.hand.includes(cardId)) return;
      if (!isTianxiangCard(ctx.state, ownerId, cardId)) return;

      // 3) 弃置红桃手牌
      await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [cardId] });

      // 4) 转移伤害:对新目标造成等量同属性伤害(保留来源)
      //    原伤害 atom 将被 cancel,小乔不受伤。新伤害走完整管线(含濒死结算)。
      await applyAtom(ctx.state, {
        type: '造成伤害',
        target: newTarget,
        amount,
        source: atom.source ?? ownerId,
        cardId: atom.cardId,
        damageType: atom.damageType,
      });

      // 5) 转移目标摸 X 张牌(X = 已损失体力值,伤害结算后)
      if (targetPlayer.alive) {
        const lostHealth = targetPlayer.maxHealth - targetPlayer.health;
        if (lostHealth > 0) {
          await applyAtom(ctx.state, { type: '摸牌', player: newTarget, count: lostHealth });
        }
      }

      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '天香',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动天香?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
