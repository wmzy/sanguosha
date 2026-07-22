// 天香(小乔·被动触发):当你受到伤害时，你可以弃置一张红桃手牌，防止此伤害并
// 选择一名其他角色，你选择令其：
//   1. 受到伤害来源的1点伤害并摸X张牌（X为其已损失体力值且至多为5）
//   2. 失去1点体力并获得你弃置的牌。
//
// 时机:造成伤害 before hook(伤害结算前)。target=自己 + amount>0 时触发。
// 流程(确认发动后):
//   1. 弃一张红桃手牌(红颜锁定技下黑桃也视为红桃)
//   2. 选一名其他角色
//   3. 询问选择一项(confirm):① 该角色受来源1点伤害+摸X ② 该角色失去1点体力+获弃牌
//   4. 执行所选选项,然后 cancel 原伤害 atom(小乔不再受伤 —— "防止此伤害")
//
// 选项细节:
//   ① 造成伤害{target=所选角色, source=原伤害来源, amount=1};
//      然后 摸X张牌(X = maxHealth - health,至多 5;伤害结算后计算)
//   ② 失去体力{target=所选角色, amount=1}(非伤害,不触发反馈/奸雄);
//      然后 移动牌(弃牌堆→该角色手牌),获得本次弃置的红桃牌
//
// 关键点:
//   - "防止此伤害" = cancel 原伤害,小乔不受伤
//   - 目标不能是小乔自己(官方:"选择一名其他角色")
//   - 选项①的"伤害来源" = 原伤害的来源(保留奖励归属)
//   - 标版仅支持红桃**手牌**(与界版"手牌或装备区"不同)
//   - 红颜联动:小乔拥有「红颜」技能时,黑桃手牌也作为合法弃牌
import type {
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
const OPTION_RT = '天香/option';
const CONFIRMED_KEY = '天香/confirmed';
const CARD_KEY = '天香/cardId';
const TARGET_KEY = '天香/target';
const OPTION_KEY = '天香/option'; // 'damage' | 'lose'

/** 判定一张手牌对天香是否合法:红桃;若拥有红颜,黑桃也视为红桃。 */
function isTianxiangCard(state: GameState, ownerId: number, cardId: string): boolean {
  const card = state.cardMap[cardId];
  if (!card) return false;
  if (card.suit === '♥') return true;
  if (card.suit === '♠' && state.players[ownerId]?.skills.includes('红颜')) return true;
  return false;
}

function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as unknown as Record<string, unknown>).requestType as string | undefined;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '天香',
    description:
      '受到伤害时,弃一张红桃手牌防止之,令一名其他角色二选一:①受来源1伤害并摸X(X为已损失体力至多5);②失去1体力并获得弃置的牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:回应天香的各询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const rt = currentRequestType(st, ownerId);
      if (rt !== CONFIRM_RT && rt !== CHOOSE_RT && rt !== OPTION_RT) {
        return '当前不是天香询问';
      }
      if (rt === CONFIRM_RT || rt === OPTION_RT) return null; // confirm 类:任意 choice 均可

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
      const rt = currentRequestType(st, ownerId);
      const confirmed = params.choice === true || params.confirmed === true;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = confirmed;
      } else if (rt === CHOOSE_RT) {
        st.localVars[CARD_KEY] = params.cardId ?? null;
        st.localVars[TARGET_KEY] = params.target ?? null;
      } else if (rt === OPTION_RT) {
        // confirm prompt:确认=①damage,取消/超时=②lose
        st.localVars[OPTION_KEY] = confirmed ? 'damage' : 'lose';
      }
    },
  );

  // ── 造成伤害 before:小乔受伤前询问是否发动 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
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
          title: '天香:弃一张红桃手牌,选择一名其他角色',
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

      // 3) 询问选择一项(confirm):确认=①damage,取消=②lose
      delete ctx.state.localVars[OPTION_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPTION_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `天香:令 ${targetPlayer.name} ①受来源1点伤害并摸X张牌?(确认=①,取消=②失去1体力并获得弃牌)`,
          confirmLabel: '①受伤害+摸牌',
          cancelLabel: '②失去体力+获牌',
        },
        defaultChoice: false,
        timeout: 15,
      });
      const chosenOption = ctx.state.localVars[OPTION_KEY] as string | null;
      delete ctx.state.localVars[OPTION_KEY];
      const isDamage = chosenOption === 'damage';

      // 4) 弃置红桃手牌
      await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [cardId] });

      // 5) 执行所选选项
      if (isDamage) {
        // 选项①:该角色受到伤害来源的1点伤害(保留原来源)
        const source = atom.source ?? ownerId;
        await applyAtom(ctx.state, {
          type: '造成伤害',
          target: newTarget,
          amount: 1,
          source,
          damageType: '普通',
        });
        // 摸 X 张牌(X = 已损失体力值,至多 5;伤害结算后)
        if (targetPlayer.alive) {
          const lostHealth = targetPlayer.maxHealth - targetPlayer.health;
          const x = Math.min(lostHealth, 5);
          if (x > 0) {
            await applyAtom(ctx.state, { type: '摸牌', player: newTarget, count: x });
          }
        }
      } else {
        // 选项②:该角色失去1点体力 + 获得弃置的牌
        await applyAtom(ctx.state, { type: '失去体力', target: newTarget, amount: 1 });
        // 获得本次弃置的红桃牌(此刻在弃牌堆中)
        if (targetPlayer.alive && ctx.state.zones.discardPile.includes(cardId)) {
          await applyAtom(ctx.state, {
            type: '移动牌',
            cardId,
            from: { zone: '弃牌堆' },
            to: { zone: '手牌', player: newTarget },
          });
        }
      }

      // 6) cancel 原伤害(防止此伤害)
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
