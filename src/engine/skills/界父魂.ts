// 界父魂(界关兴张苞·转化技 + 被动触发):
//   你可将两张牌当【杀】使用或打出。
//   你使用的转化【杀】目标角色只能使用颜色相同的手牌响应;
//   你于出牌阶段使用【杀】造成伤害后,你本回合获得"武圣""咆哮"。
//
// OL 界限突破官方(hero/690)逐字。
//
// 与标版父魂(关兴张苞)差异:
//   1. 牌范围:界版"两张牌"(含装备区),标版"两张手牌"
//   2. 界版新增:转化杀的目标只能用同色手牌响应(颜色限制)
//   3. 触发条件:界版"使用【杀】造成伤害"(任何杀),标版"以此法造成伤害"(仅转化杀)
//
// 实现:
//   A. 转化 action(2 牌 → 杀):preceding=[界父魂.transform] + 主 action=杀.use
//      类似丈八蛇矛多卡转化,但允许装备区牌(参考界武圣卸装备模式)。
//      影子 id = ${id1}#${id2}#界父魂(后缀 = 技能 id,客户端按同一约定构造),多卡转化 shadowOf=undefined,颜色取综合。
//
//   B. 颜色限制:转化杀的目标只能用同色手牌响应
//      before-hook on 询问闪:检测当前结算帧的 杀 是 ownerId 的转化杀
//      (frame.params.cardId 含 '#' 即为影子卡)且颜色非无色 → 设 localVars['闪/色限制']
//      after-hook on 询问闪:清 localVars['闪/色限制'](无论 resolve 路径)
//      闪.ts 通用色限制检查读取此 localVars(其他技能亦可复用)
//
//   C. 获得武圣咆哮(被动,本回合):
//      after-hook on 造成伤害:source=ownerId + amount>0 + 自己回合出牌阶段
//        → state.turn.vars['父魂/granted'] = ownerId
//        + applyAtom(回合用量) 投影到 view.players[ownerId].turnUsage
//      咆哮效果:无限出杀提供者读 turn.vars,granted 时返回 true → slashMax=∞
//      武圣效果:transform action(1 红色手牌 → 杀),activeWhen 读 turnUsage
//      回合结束 atom 自动清空 turn.vars → grant 自然失效
//
// 契约:
//   - turn.vars['父魂/granted']:生产=造成伤害 after hook,消费=无限出杀提供者+武圣 transform
//   - localVars['闪/色限制']:生产=询问闪 before hook,消费=闪.respond validate,清=询问闪 after hook
import type {
  Card,
  GameView,
  GameState,
  Skill,
  FrontendAPI,
  HookResult,
} from '../types';
import { registerAfterHook, registerBeforeHook, declareAlternativeResponse } from '../core/skill';
import { topFrame } from '../core/frame';
import { registerSlashUnlimitedProvider, projectSlashUnlimited } from '../rules/slash-quota';
import { viewCanAttack } from '../rules/viewDistance';
import { defaultPlayActive, viewCanSlash } from '../rules/action-active';
import { slashUnlimitedKey } from '../rules/vars-keys';
import {
  registerTransformAction,
  mountTransformAction,
  engineCanPlayNow,
  isAskedKillSlot,
  viewAskedKill,
  type TransformActionOptions,
} from '../util/skillRuntime';

const GRANT_VAR = '父魂/granted';
const COLOR_LIMIT_VAR = '闪/色限制';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '父魂',
    description:
      '转化技:两张牌当杀;转化杀目标只能用同色手牌响应;出牌阶段杀造成伤害后本回合获得武圣咆哮',
  };
}

// ─── A. 父魂 转化 action:2 张牌(手牌或装备区)→ 杀 ─────────────
// 五件套由 skillRuntime 转化技工厂统一实现(cardCount=2 + includeEquipment 维度):
// 影子 id = ${id1}#${id2}#界父魂(后缀 = 技能 id,与客户端构造约定一致),多卡转化
// shadowOf=undefined,颜色取综合;装备区牌先「卸下」再「当作」,rollback 还原槽位与距离 vars。

const TRANSFORM_OPTIONS: TransformActionOptions = {
  outputName: '杀',
  cardCount: 2,
  // 使用(自己回合出牌阶段)或打出(被询问杀:决斗/南蛮)均可
  context: 'playOrRespondKill',
  includeEquipment: true,
  needCardsError: '需要选择 2 张牌',
  invalidError: '父魂转化条件不满足',
  mount: {
    label: '父魂',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择 2 张牌当杀使用',
      cardFilter: { filter: () => true, min: 2, max: 2 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view: GameView, t: number) =>
          viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
      },
    },
    activeWhen: (ctx) => {
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p?.alive) return false;
      // 手牌 + 装备区合计 ≥ 2
      const equipCount = Object.values(p.equipment ?? {}).filter(Boolean).length;
      const total = (p.handCount ?? 0) + equipCount;
      if (total < 2) return false;
      // 出杀路径(自己回合 + 出牌阶段 + 还能出杀)
      const ownTurnCanSlash =
        defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx);
      // 回应路径(被询问杀:南蛮入侵/决斗):与武圣/龙胆同构
      return ownTurnCanSlash || viewAskedKill(ctx);
    },
  },
};

// ─── B'. granted 武圣 转化:1 张红色手牌 → 杀(granted 时生效) ─────────────
// 影子 id = ${原id}#界父魂:后缀统一为技能 id(界父魂)——客户端按 `${cardId}#${skillId}`
// 构造主 action 的 cardId,与两条转化路径(两张牌 / granted 单张牌)都对齐;
// 两种路径的 id 因牌数不同不会冲突。
// validate 自定义:granted 前置拒绝与通用拒绝文案不同,逐字保留。

const GRANTED_OPTIONS: TransformActionOptions = {
  outputName: '杀',
  actionType: '武圣transform',
  context: 'playOrRespondKill',
  validate: (st, ownerId, params): string | null => {
    if (!isGranted(st, ownerId)) return '本回合未获得武圣';
    const self = st.players[ownerId];
    const cardId = params.cardId as string | undefined;
    const cardIdOk = typeof cardId === 'string';
    const card = cardIdOk ? st.cardMap[cardId] : undefined;
    const cardInHand = cardIdOk && !!self && self.hand.includes(cardId);
    const isRed = !!card && card.color === '红';
    const slot = st.pendingSlots.get(ownerId);
    const askedKill =
      !!slot &&
      (slot.atom as { target?: number }).target === ownerId &&
      isAskedKillSlot(slot);
    const contextOk = engineCanPlayNow(st, ownerId) || askedKill;
    const ok = contextOk && self?.alive === true && cardInHand && isRed;
    return ok ? null : '现在不能使用武圣';
  },
  mount: {
    label: '武圣',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张红色手牌当杀使用',
      cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view: GameView, t: number) =>
          viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
      },
    },
    activeWhen: (ctx) => {
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p?.alive) return false;
      // 仅在获得武圣时显示
      if (!p.turnUsage?.[slashUnlimitedKey('父魂')]) return false;
      const hasRed = p.hand?.some((c) => c.color === '红') ?? false;
      if (!hasRed) return false;
      // 出杀路径(自己回合 + 出牌阶段 + 还能出杀)
      const ownTurnCanSlash =
        defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx);
      // 回应路径(决斗中被询问杀):与武圣/龙胆同构
      return ownTurnCanSlash || viewAskedKill(ctx);
    },
  },
};

// ─── granted 标记读写 helper ─────────────────────────

function isGranted(state: GameState, ownerId: number): boolean {
  return state.turn.vars[GRANT_VAR] === ownerId;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── A. 父魂 转化(主动 preceding) ──
  const unregTransform = registerTransformAction(
    state,
    skill.id,
    ownerId,
    TRANSFORM_OPTIONS,
  );

  // ── B'. granted 武圣 转化(主动 preceding,granted 时生效) ──
  // 标准"武圣":将一张红色手牌当【杀】使用或打出。
  const unregWusheng = registerTransformAction(
    state,
    skill.id,
    ownerId,
    GRANTED_OPTIONS,
  );

  // ── C. granted 咆哮:无限出杀提供者读 turn.vars,granted 时 true → slashMax=∞ ──
  const unregMax = registerSlashUnlimitedProvider(state, ownerId, (s, p) =>
    isGranted(s, p),
  );

  // ── D. 造成伤害 after:owner 出牌阶段杀造成伤害 → granted 标记 ──
  const unregDmgHook = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '造成伤害后',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      if ((atom.amount ?? 0) <= 0) return;
      // 限定出牌阶段(描述明确:"你于出牌阶段使用【杀】造成伤害后")
      if (ctx.state.phase !== '出牌') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      // 限定 杀 造成(其他伤害来源不触发)
      // 造成伤害 atom 携带 cardId;杀帧 skillId==='杀' 兜底
      const cardId = atom.cardId;
      const card = cardId ? ctx.state.cardMap[cardId] : undefined;
      const isSlash = card?.name === '杀' || topFrame(ctx.state)?.skillId === '杀';
      if (!isSlash) return;
      if (isGranted(ctx.state, ownerId)) return; // 已标记,避免重复投影
      ctx.state.turn.vars[GRANT_VAR] = ownerId;
      await projectSlashUnlimited(ctx.state, ownerId, '父魂');
    },
  );

  // ── E. 询问闪 before:owner 的转化杀 → 设颜色限制 ──
  const unregBeforeDodge = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      // 仅 source 是 owner 时:owner 使用的转化杀
      if (atom.source !== ownerId) return;
      // 读 杀 帧 cardId(topFrame.params.cardId)
      const frame = topFrame(ctx.state);
      if (frame?.skillId !== '杀') return;
      const cardId = frame.params['cardId'];
      if (typeof cardId !== 'string') return;
      // 转化杀判定:影子卡 id 含 '#'(物理杀 id 不含)
      // (武圣红牌、丈八蛇矛、父魂、granted 武圣 等转化杀均适用)
      if (!cardId.includes('#')) return;
      const slashCard = ctx.state.cardMap[cardId];
      if (!slashCard) return;
      const color = slashCard.color;
      // 仅红/黑有同色要求;无色不限制
      if (color !== '红' && color !== '黑') return;
      ctx.state.localVars[COLOR_LIMIT_VAR] = color;
    },
  );

  // ── F. 询问闪 after:清颜色限制(无论 resolve 路径) ──
  const unregAfterDodge = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx) => {
      delete ctx.state.localVars[COLOR_LIMIT_VAR];
    },
  );

  // ── 声明替代回应:被询问杀(南蛮入侵/决斗 等)时,可用父魂/granted 武圣
  //    把两张牌/红色手牌当杀打出。与武圣/龙胆同构:声明后 询问杀 的可用性检测
  //    不再 skip/silent,建立回应窗口。
  const unregAlt = declareAlternativeResponse(state, ownerId, '询问杀');

  return () => {
    unregTransform();
    unregWusheng();
    unregMax();
    unregDmgHook();
    unregBeforeDodge();
    unregAfterDodge();
    unregAlt();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 父魂 转化:2 张牌(手牌或装备区)→ 杀
  mountTransformAction(api, skill.id, TRANSFORM_OPTIONS);

  // granted 武圣 转化:1 张红色手牌 → 杀(granted 时才显示)
  mountTransformAction(api, skill.id, GRANTED_OPTIONS);

  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
