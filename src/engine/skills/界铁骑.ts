// 界铁骑(界马超·被动技,OL 界限突破官方逐字):
//   当你使用【杀】指定目标后,你可以令其本回合非锁定技失效,然后你判定,
//   除非其弃置一张与判定结果花色相同的牌,否则其不能抵消此【杀】。
//
// 与标铁骑 src/engine/skills/铁骑.ts 差异(官方对齐):
//   1. 新增「本回合非锁定技失效」:发动后给目标加 SUPPRESSION_TAG,
//      create-engine.runBeforeHooks/runAfterHooks 据此跳过目标的非锁定技 hook
//      (锁定技与装备技描述含「锁定技/防具:/武器:」标记,不受压制)。
//   2. 「判定后弃同花色牌免闪」:旧版直接 cancel 询问闪强制命中,且只看红/黑色;
//      官方为判定后令目标选弃一张与判定结果同花色(♠/♥/♣/♦)的牌,
//      弃了 → 可正常出闪抵消;没弃/弃不出 → cancel 询问闪强制命中。
//   3. 移除旧版「黑色判定额外摸一张牌」——官方无此增益(实现臆造)。
//
// 三段式实现(禁闪横切 + 标签压制):
//   1. 指定目标 after hook(source===ownerId, card 是杀):
//        询问「是否发动铁骑」→ 若发动 →
//          a. 给目标加标签 SUPPRESSION_TAG(本回合非锁定技失效,回合结束清)
//          b. applyAtom(判定),judgeType='铁骑'
//   2. 判定 after hook(judgeType==='铁骑', player===ownerId):
//        读判定牌花色 → 写 localVars[SUIT_VAR]=花色,供阶段3消费。
//   3. 询问闪 before hook(source===ownerId 且 localVars 有花色):
//        请求目标弃一张同花色手牌 → 弃了 → pass(询问闪正常,目标可出闪);
//        没弃/超时/无同花色牌 → cancel(强制命中)。
//
// SUPPRESSION_TAG 生命周期:发动时加,界马超回合结束 after hook 清。
//   标签由 create-engine 的 hook 过滤器读取,实现「目标非锁定技失效」。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';
import { registerSuppressionProvider } from '../skill-suppression';

/** 标签:目标本回合非锁定技失效(create-engine.runBeforeHooks/runAfterHooks 读取) */
export const SUPPRESSION_TAG = '界铁骑/非锁定技失效';
const CONFIRM = '铁骑/confirmed';
const TARGET_VAR = '铁骑/target';
const SUIT_VAR = '铁骑/suit';
const DISCARD_CARD = '铁骑/discardCard';
const DISCARD_REQUEST = '铁骑/discard';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界铁骑',
    description:
      '使用杀指定目标后,可令其本回合非锁定技失效并判定;除非其弃一张与判定结果同花色的牌,否则不能抵消此杀',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 非锁定技失效 provider:目标持有 SUPPRESSION_TAG 时,其非锁定技 hook 被压制 ──
  //   通过 skill-suppression 扩展点注册,避免引擎核心硬编码技能名/标签。
  const unloadSuppression = registerSuppressionProvider(
    state,
    (st, targetOwnerId, _skillId) =>
      st.players[targetOwnerId]?.tags.includes(SUPPRESSION_TAG) === true,
  );

  // respond:同一 action 处理两种 requestType ——
  //   '铁骑/confirm':ownerId 确认是否发动
  //   '铁骑/discard':目标玩家弃同花色手牌的免闪代价
  // 为所有玩家注册:同一玩家可能在不同时机收到不同 requestType(参考界烈弓模式)。
  for (const p of state.players) {
    const pid = p.index;
    registerAction(
      state,
      skill.id,
      pid,
      'respond',
      (st: GameState, params: Record<string, unknown>): string | null => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as { type?: string; requestType?: string };
        if (atom.type !== '请求回应') return '当前不是请求回应';
        if (atom.requestType === '铁骑/confirm') {
          return null; // 确认型:无需额外校验
        }
        if (atom.requestType === DISCARD_REQUEST) {
          const cardId = params.cardId as string | undefined;
          if (typeof cardId !== 'string') return '请选择一张手牌弃置';
          if (!st.players[pid].hand.includes(cardId)) return '牌不在手牌中';
          // 花色校验:必须与判定花色相同(后端兜底)
          const suit = st.localVars[SUIT_VAR] as string | undefined;
          const card = st.cardMap[cardId];
          if (!suit || !card) return '无法校验花色';
          if (card.suit !== suit) return '花色与判定结果不符';
          return null;
        }
        return '当前不是铁骑回应';
      },
      async (st: GameState, params: Record<string, unknown>) => {
        const slot = st.pendingSlots.get(pid);
        const reqType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
        if (reqType === '铁骑/confirm') {
          st.localVars[CONFIRM] = params.choice === true || params.confirmed === true;
        } else if (reqType === DISCARD_REQUEST) {
          st.localVars[DISCARD_CARD] = params.cardId as string;
        }
      },
    );
  }

  // ── 指定目标 after:自己出杀指定目标 → 询问 → 发动:加压制标签 + 判定 ──
  registerAfterHook(state, skill.id, ownerId, '指定目标', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    if (atom.target === undefined) return;
    const target = atom.target;
    if (atom.cardId !== undefined) {
      const card = ctx.state.cardMap[atom.cardId];
      if (card?.name !== '杀') return;
    }
    const targetPlayer = ctx.state.players[target];
    if (!targetPlayer?.alive) return;
    if (ctx.state.zones.deck.length === 0) return; // 无牌可判

    // 询问是否发动铁骑("你可以..."——可选)
    delete ctx.state.localVars[CONFIRM];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '铁骑/confirm',
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动铁骑(令目标本回合非锁定技失效并判定)?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars[CONFIRM]) return;

    // a. 非锁定技失效:给目标加压制标签(回合结束清)
    if (!targetPlayer.tags.includes(SUPPRESSION_TAG)) {
      await applyAtom(ctx.state, { type: '加标签', player: target, tag: SUPPRESSION_TAG });
    }
    // b. 记录目标 + 判定
    ctx.state.localVars[TARGET_VAR] = target;
    await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '铁骑' });
  });

  // ── 判定 after:judgeType==='铁骑' → 读花色,存 localVars 供询问闪阶段消费 ──
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx) => {
    const atom = ctx.atom;
    if (atom.judgeType !== '铁骑') return;
    if (atom.player !== ownerId) return;
    const target = ctx.state.localVars[TARGET_VAR] as number | undefined;
    delete ctx.state.localVars[TARGET_VAR];
    if (target === undefined) return;
    const targetPlayer = ctx.state.players[target];
    if (!targetPlayer?.alive) return;

    // 读判定牌(判定 atom 内置 afterHooks 会把它移入弃牌堆,技能 hook 先于其执行)
    const cards = frameCards(ctx.state);
    if (cards.length === 0) return;
    const judgeCardId = cards[cards.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    // 记录花色(空花色=转化合成卡,目标无同花色牌可弃→强制命中)
    const suit = judgeCard.suit || '';
    ctx.state.localVars[SUIT_VAR] = suit;
    ctx.state.localVars[TARGET_VAR] = target;
  });

  // ── 询问闪 before:令目标弃一张同花色手牌,否则 cancel 询问闪(强制命中) ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      const target = atom.target;
      if (target === undefined) return;

      // 仅对由阶段2(判定)写入的目标 + 花色生效,且与当前询问闪目标一致
      const suit = ctx.state.localVars[SUIT_VAR] as string | undefined;
      const recordedTarget = ctx.state.localVars[TARGET_VAR] as number | undefined;
      if (suit === undefined || recordedTarget !== target) return;

      const player = ctx.state.players[target];
      if (!player?.alive) return;

      // 无手牌 / 无同花色牌 → 直接 cancel(强制命中)
      const hasMatching = player.hand.some((id) => ctx.state.cardMap[id]?.suit === suit);
      if (!hasMatching) {
        // 清费本次杀的 localVars
        delete ctx.state.localVars[SUIT_VAR];
        delete ctx.state.localVars[TARGET_VAR];
        return { kind: 'cancel' };
      }

      // 请求目标弃一张同花色手牌(SUIT_VAR 仍需保留供 respond validate 校验)
      delete ctx.state.localVars[DISCARD_CARD];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: DISCARD_REQUEST,
        target,
        prompt: {
          type: 'useCard',
          title: `界铁骑:弃置一张${suit}花色手牌,否则不能出闪抵消此杀`,
          cardFilter: { filter: (c) => c.suit === suit, min: 1, max: 1 },
        },
        timeout: 15,
      });

      // 弃牌询问结束后才清 Localvars(下次杀不再复用)
      delete ctx.state.localVars[SUIT_VAR];
      delete ctx.state.localVars[TARGET_VAR];

      const discardCardId = ctx.state.localVars[DISCARD_CARD] as string | undefined;
      delete ctx.state.localVars[DISCARD_CARD];

      if (discardCardId && player.hand.includes(discardCardId)) {
        // 弃了同花色牌 → 正常询问闪(目标仍可出闪抵消)
        await applyAtom(ctx.state, { type: '弃置', player: target, cardIds: [discardCardId] });
        return; // pass → 询问闪正常执行
      }
      // 没弃/超时 → 强制命中
      return { kind: 'cancel' };
    },
  );

  // ── 回合结束 after:界马超回合结束时清除目标的非锁定技失效标签 ──
  registerAfterHook(state, skill.id, ownerId, '回合结束', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return; // 仅自己回合结束
    for (const p of ctx.state.players) {
      if (p.tags.includes(SUPPRESSION_TAG)) {
        await applyAtom(ctx.state, { type: '去标签', player: p.index, tag: SUPPRESSION_TAG });
      }
    }
  });

  return () => {
    unloadSuppression();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  // 主回应:是否发动铁骑
  api.defineAction('respond', {
    label: '铁骑',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动铁骑判定？',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
