// 天香(小乔·被动触发):当你受到伤害时，你可以弃置一张红桃手牌，防止此伤害并
// 选择一名其他角色，你选择令其：
//   1. 受到伤害来源的1点伤害并摸X张牌（X为其已损失体力值且至多为5）
//   2. 失去1点体力并获得你弃置的牌。
//
// 本文件同时承载标版/界版的共享实现(registerTianxiangWiring + TianxiangVariant):
// 界天香.ts import 并以界版差异配置调用。真实差异仅三点——界版候选区=手牌+装备区红桃牌、
// 选项①固定 1 点伤害(标版转移原伤害值)、respond 校验含 owner 存活检查;其余
// (respond validate/execute、六步 before-hook 流程)逐行同构。
//
// 时机:造成伤害 before hook(伤害结算前)。target=自己 + amount>0 时触发。
// 流程(确认发动后):
//   1. 弃一张红桃手牌(红颜/界红颜锁定技下黑桃也视为红桃)
//   2. 选一名其他角色
//   3. 询问选择一项(confirm):① 该角色受来源1点伤害+摸X ② 该角色失去1点体力+获弃牌
//   4. 执行所选选项,然后 cancel 原伤害 atom(小乔不再受伤 —— "防止此伤害")
//
// 选项细节:
//   ① 造成伤害{target=所选角色, source=原伤害来源, 伤害值=variant.optionDamageAmount};
//      然后 摸X张牌(X = maxHealth - health,至多 5;伤害结算后计算)
//   ② 失去体力{target=所选角色, amount: 1}(非伤害,不触发反馈/奸雄);
//      然后 移动牌(弃牌堆→该角色手牌),获得本次弃置的红桃牌
//
// 关键点:
//   - "防止此伤害" = cancel 原伤害,小乔不受伤
//   - 目标不能是小乔自己(官方:"选择一名其他角色")
//   - 选项①的"伤害来源" = 原伤害的来源(保留奖励归属)
//   - 标版仅支持红桃**手牌**(与界版"手牌或装备区"不同)
//   - 红颜联动:拥有「红颜」或「界红颜」时,黑桃手牌也作为合法弃牌(两版同判,见 isRedSuitFor)
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  PlayerState,
  Skill,
} from '../types';
import { getHealthValue } from '../types';
import { applyAtom } from '../core/apply';
import { runDamageFlow } from '../flows/damage';
import { registerAction, registerBeforeHook } from '../core/skill';
import { currentRequestType } from '../util/skillRuntime';

/** 玩家是否拥有红颜系锁定技(红颜/界红颜):黑桃视为红桃。 */
function hasHongyanVariant(state: GameState, ownerId: number): boolean {
  const skills = state.players[ownerId]?.skills ?? [];
  return skills.includes('红颜') || skills.includes('界红颜');
}

/** 共享红桃判定:红桃恒真;黑桃在拥有 红颜/界红颜 时视为红桃。 */
function isRedSuitFor(state: GameState, ownerId: number, suit: string): boolean {
  if (suit === '♥') return true;
  return suit === '♠' && hasHongyanVariant(state, ownerId);
}

/** 判定一张牌对天香是否合法:红桃;若拥有红颜/界红颜,黑桃也视为红桃。 */
function isTianxiangCard(state: GameState, ownerId: number, cardId: string): boolean {
  const card = state.cardMap[cardId];
  return !!card && isRedSuitFor(state, ownerId, card.suit);
}

/** 天香标版/界版差异配置(共享实现见 registerTianxiangWiring)。 */
export interface TianxiangVariant {
  /** 技能名,兼作 requestType/localVars 键前缀与选项询问标题前缀 */
  readonly name: string;
  /** respond validate:当前询问不属于本技能 */
  readonly notAskError: string;
  /** choose 询问缺 cardId */
  readonly askCardError: string;
  /** owner 存活校验文案(界版;undefined = 不校验) */
  readonly ownerAliveError?: string;
  /** 牌不在候选区(手牌/手牌或装备区) */
  readonly cardNotOwnedError: string;
  /** 非红桃牌 */
  readonly cardNotRedError: string;
  /** choose 询问缺 target */
  readonly askTargetError: string;
  /** target 是自己 */
  readonly selfTargetError: string;
  /** 发动确认询问(confirm)标题 */
  readonly confirmTitle: string;
  /** 弃牌+选目标询问(useCardAndTarget)标题 */
  readonly chooseTitle: string;
  /** 候选红桃牌收集(标版仅手牌;界版手牌+装备区) */
  readonly candidateCardIds: (self: PlayerState) => string[];
  /** 持牌判定(respond validate 与发动前守卫共用) */
  readonly ownsCard: (self: PlayerState, cardId: string) => boolean;
  /** choose 的 cardFilter 是否显式携带 candidates(界版含装备区,投影层需权威列表) */
  readonly explicitCandidates: boolean;
  /** 选项①伤害值:标版转移原伤害值;界版固定 1 */
  readonly optionDamageAmount: (amount: number) => number;
}

/** 天香标版差异配置(界版见 界天香.ts)。 */
const STANDARD_VARIANT: TianxiangVariant = {
  name: '天香',
  notAskError: '当前不是天香询问',
  askCardError: '请选择一张红桃手牌',
  cardNotOwnedError: '牌不在手牌中',
  cardNotRedError: '必须选择红桃手牌',
  askTargetError: '请选择转移目标',
  selfTargetError: '不能转移给自己',
  confirmTitle: '是否发动天香?',
  chooseTitle: '天香:弃一张红桃手牌,选择一名其他角色',
  candidateCardIds: (self) => self.hand,
  ownsCard: (self, cardId) => self.hand.includes(cardId),
  explicitCandidates: false,
  optionDamageAmount: (amount) => amount,
};

/**
 * 注册天香的 respond action 与 受到伤害时 before-hook(标版/界版共用)。
 * 键(requestType/localVars)按 variant.name 前缀派生,两版实例互不串扰。
 */
export function registerTianxiangWiring(skill: Skill, state: GameState, variant: TianxiangVariant): void {
  const ownerId = skill.ownerId;
  const CONFIRM_RT = `${variant.name}/confirm`;
  const CHOOSE_RT = `${variant.name}/choose`;
  const OPTION_RT = `${variant.name}/option`;
  const CONFIRMED_KEY = `${variant.name}/confirmed`;
  const CARD_KEY = `${variant.name}/cardId`;
  const TARGET_KEY = `${variant.name}/target`;
  const OPTION_KEY = `${variant.name}/option`; // 'damage' | 'lose'

  // ── respond:回应天香的各询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const rt = currentRequestType(st, ownerId);
      if (rt !== CONFIRM_RT && rt !== CHOOSE_RT && rt !== OPTION_RT) {
        return variant.notAskError;
      }
      if (rt === CONFIRM_RT || rt === OPTION_RT) return null; // confirm 类:任意 choice 均可

      // choose:校验 cardId + target
      const cardId = params.cardId as string | undefined;
      const target = params.target as number | undefined;
      if (typeof cardId !== 'string') return variant.askCardError;
      const self = st.players[ownerId];
      if (variant.ownerAliveError !== undefined && !self?.alive) return variant.ownerAliveError;
      if (!self || !variant.ownsCard(self, cardId)) return variant.cardNotOwnedError;
      if (!isTianxiangCard(st, ownerId, cardId)) return variant.cardNotRedError;
      if (typeof target !== 'number') return variant.askTargetError;
      if (target === ownerId) return variant.selfTargetError;
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

  // ── 造成伤害 before:受伤前询问是否发动 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '受到伤害时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      const amount = atom.amount ?? 0;
      if (amount <= 0) return;

      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 发动条件:有红桃牌(红颜/界红颜下黑桃也算)+ 场上有其他存活角色
      const validCards = variant
        .candidateCardIds(self)
        .filter((id) => isTianxiangCard(ctx.state, ownerId, id));
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
          title: variant.confirmTitle,
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
      const hasHongyan = hasHongyanVariant(ctx.state, ownerId);
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CHOOSE_RT,
        target: ownerId,
        prompt: {
          type: 'useCardAndTarget',
          title: variant.chooseTitle,
          cardFilter: {
            filter: (c) => c.suit === '♥' || (hasHongyan && c.suit === '♠'),
            ...(variant.explicitCandidates ? { candidates: validCards } : {}),
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
      // 未提供有效牌/目标 → 放弃发动(照常受伤)
      if (typeof cardId !== 'string' || typeof newTarget !== 'number') return;
      if (newTarget === ownerId) return;
      const targetPlayer = ctx.state.players[newTarget];
      if (!targetPlayer?.alive) return;
      if (!variant.ownsCard(self, cardId)) return;
      if (!isTianxiangCard(ctx.state, ownerId, cardId)) return;

      // 3) 询问选择一项(confirm):确认=①damage,取消=②lose
      delete ctx.state.localVars[OPTION_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: OPTION_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `${variant.name}:令 ${targetPlayer.name} ①受来源1点伤害并摸X张牌?(确认=①,取消=②失去1体力并获得弃牌)`,
          confirmLabel: '①受伤害+摸牌',
          cancelLabel: '②失去体力+获牌',
        },
        defaultChoice: false,
        timeout: 15,
      });
      const chosenOption = ctx.state.localVars[OPTION_KEY] as string | null;
      delete ctx.state.localVars[OPTION_KEY];
      const isDamage = chosenOption === 'damage';

      // 4) 弃置红桃牌(弃置 atom 原生支持手牌/装备区跨区域弃牌)
      await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [cardId], voluntary: true });

      // 5) 执行所选选项
      if (isDamage) {
        // 选项①:该角色受到伤害来源的伤害(保留原来源/原属性;伤害值按 variant——
        // 标版转移原伤害值,界版固定 1 点)
        const source = atom.source ?? ownerId;
        await runDamageFlow(
          ctx.state,
          source,
          newTarget,
          variant.optionDamageAmount(amount),
          undefined,
          atom.damageType,
        );
        // 摸 X 张牌(X = 已损失体力值,至多 5;伤害结算后)
        if (targetPlayer.alive) {
          const lostHealth = targetPlayer.maxHealth - getHealthValue(targetPlayer);
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
}

/** onMount 共用:注册 respond 动作(标版/界版仅 label/标题文案不同)。 */
export function mountTianxiangRespondAction(api: FrontendAPI, label: string, title: string): void {
  api.defineAction('respond', {
    label,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title,
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
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
  registerTianxiangWiring(skill, state, STANDARD_VARIANT);
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  mountTianxiangRespondAction(api, '天香', '是否发动天香?');
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
