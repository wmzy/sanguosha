// 鬼才(司马懿·被动触发):在任意角色的判定牌生效前,你可以打出一张手牌代替之。
//
// 触发时机:判定牌翻开(判定 atom.apply 完成)后,判定效果(闪电/兵粮寸断/乐不思蜀等
//   消费技能的 afterHook 读取判定牌)生效前。本技能挂 判定 atom 的 afterHook:
//   - 判定 atom.apply 已把判定牌推入 frameCards(top)
//   - 本 hook 先于消费技能(闪电等)的 afterHook 询问是否替换
//   - 替换:把 frameCards 顶的判定牌移入弃牌堆,把手牌作为新判定牌压入 frameCards 顶
//   - 之后消费技能的 afterHook 读 frameCards 顶 → 看到替换后的牌
//   - 判定 atom 自身的 afterHooks(在所有技能 hook 之后)把 frameCards 顶移入弃牌堆
//
// 已知限制:hook 执行顺序 = 注册顺序(runAfterHooks 仅把 TARGET_SYSTEM hook 排到末尾)。
//   故司马懿需在消费技能(闪电/兵粮寸断 等)之前实例化,即座次靠前。这是引擎缺失能力
//   (判定牌替换钩子,见 docs/design/引擎缺失能力.md),此处不修改引擎核心。
//
// 交换判定牌通过直接 mutate frameCards(与武圣影子卡同样的直接-mutate 先例:
//   无现成 atom 承载"替换判定牌"操作)。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '鬼才',
    description: '判定牌生效前,你可以打出一张手牌代替之',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── respond:司马懿选替换牌(或拒绝) ──────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as unknown as Record<string, unknown>;
      if (atom.type !== '请求回应') return '当前不需要回应';
      const reqType = atom.requestType as string;
      if (reqType !== '鬼才/replace') return '当前不是鬼才询问';
      // 若选择替换:cardId 必须在手牌中;若选择不替换:无额外要求
      if (params.choice === true || params.confirmed === true) {
        const cardId = params.cardId as string;
        if (typeof cardId !== 'string') return '请选择一张替换牌';
        if (!st.players[ownerId].hand.includes(cardId)) return '替换牌不在手牌中';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const use = params.choice === true || params.confirmed === true;
      if (!use) {
        st.localVars['鬼才/replaceCard'] = null;
        return;
      }
      st.localVars['鬼才/replaceCard'] = (params.cardId as string) ?? null;
    },
  );

  // ─── 判定 after hook:翻开判定牌后询问是否替换 ────────────────
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number };
    if (atom.type !== '判定') return;
    // 司马懿须存活且有手牌
    const me = ctx.state.players[ownerId];
    if (!me?.alive) return;
    if (me.hand.length === 0) return;

    // 当前判定牌(frameCards 顶)
    const cards = frameCards(ctx.state);
    if (cards.length === 0) return;

    // 询问是否替换
    delete ctx.state.localVars['鬼才/replaceCard'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '鬼才/replace',
      target: ownerId,
      prompt: {
        type: 'useCard',
        title: '鬼才:是否打出一张手牌代替判定牌?',
        cardFilter: { min: 1, max: 1 },
      },
      defaultChoice: false,
      timeout: 15,
    });

    const replaceCardId = ctx.state.localVars['鬼才/replaceCard'] as string | null | undefined;
    delete ctx.state.localVars['鬼才/replaceCard'];
    if (!replaceCardId) return; // 不替换

    // 二次校验:替换牌仍须在手牌中
    if (!me.hand.includes(replaceCardId)) return;

    // 交换判定牌(直接 mutate frameCards,与天妒同模式):
    //   判定 atom 的 toViewEvents 静态预算 discardPile+1(假设判定牌进弃牌堆),
    //   但其 afterHooks 用 splice 直接移动不产生 ViewEvent。若用 applyAtom(移动牌)
    //   会额外产生 ViewEvent 导致 processedView 与 buildView 不对称。
    //   故直接 mutate(不产生额外 ViewEvent),与天妒一致。
    //   已知限制:替换后 processedView 的 processing/discardPile 与 buildView 可能有偏差
    //   (判定 atom 视图模型局限),测试中关闭视图对比。
    const cur = frameCards(ctx.state);
    const lastIdx = cur.length - 1;
    if (lastIdx < 0) return;
    const originalJudgeId = cur[lastIdx];
    cur.splice(lastIdx, 1);
    ctx.state.zones.discardPile.push(originalJudgeId);
    me.hand = me.hand.filter((id) => id !== replaceCardId);
    cur.push(replaceCardId);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '鬼才',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '鬼才:选择一张手牌代替判定牌',
      cardFilter: { min: 1, max: 1 },
    },
  });
}
