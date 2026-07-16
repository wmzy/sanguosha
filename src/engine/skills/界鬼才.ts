// 界鬼才(界司马懿·被动触发):在任意角色的判定牌生效前,你可以打出一张手牌或装备牌代替之。
//
// 与标版鬼才的差异:标版只能用手牌改判定;界版可以用手牌或装备区的牌。
//   装备牌从装备区移到判定区替换判定牌——需先卸载装备自带技能(移除技能),
//   再从装备区卸下到手牌(卸下),然后走与标版相同的直接 mutate 交换判定牌流程。
//   (与 装备通用 换装流程的 移除技能 → 卸下 序列一致。)
//
// 其余机制(registerJudgeModifier / respond action / frameCards 直接 mutate)与标版一致。
//   内部标签/localVars/requestType 键名保持原前缀 '鬼才/xxx'(不改为 '界鬼才/xxx')。
//
// 触发时机:判定牌翻开(判定 atom.apply 完成)后、判定效果(闪电/兵粮寸断/乐不思蜀等
//   消费技能的 afterHook 读取判定牌)生效前。本技能注册为判定改判钩子(registerJudgeModifier),
//   由 判定 atom 的 afterApply 阶段触发:
//   - 判定 atom.apply 已把判定牌推入 frameCards(top)
//   - afterApply 阶段:runJudgeModifiers 从判定目标起逆时针逐个询问改判能力
//   - 本钩子询问界司马懿是否替换:是 → 把 frameCards 顶的判定牌移入弃牌堆,替换牌压入帧顶
//   - 之后技能 after hooks(闪电等消费方)读 frameCards 顶 → 看到替换后的牌
//   - 判定 atom 自身的 afterHooks(在所有技能 hook 之后)把 frameCards 顶移入弃牌堆
//
// 交换判定牌通过直接 mutate frameCards(与武圣影子卡同样的直接-mutate 先例:
//   无现成 atom 承载"替换判定牌"操作)。
import type {
  AtomAfterContext,
  EquipSlot,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerJudgeModifier } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界鬼才',
    description: '判定牌生效前,你可以打出一张手牌或装备牌代替之',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // 检查 cardId 在 owner 的哪个区域:手牌 / 装备槽 / null
  function findCardLocation(st: GameState, cardId: string): 'hand' | EquipSlot | null {
    const me = st.players[ownerId];
    if (!me) return null;
    if (me.hand.includes(cardId)) return 'hand';
    for (const slot of Object.keys(me.equipment) as EquipSlot[]) {
      if (me.equipment[slot] === cardId) return slot;
    }
    return null;
  }

  // owner 是否有可用作替换的牌(手牌或装备区)
  function hasReplaceableCards(st: GameState): boolean {
    const me = st.players[ownerId];
    if (!me) return false;
    if (me.hand.length > 0) return true;
    return Object.values(me.equipment).some((id) => id !== undefined);
  }

  // ─── respond:界司马懿选替换牌(或拒绝) ──────────────────────
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
      // 若选择替换:cardId 必须在手牌或装备区中;若选择不替换:无额外要求
      if (params.choice === true || params.confirmed === true) {
        const cardId = params.cardId as string;
        if (typeof cardId !== 'string') return '请选择一张替换牌';
        if (findCardLocation(st, cardId) === null) return '替换牌不在手牌或装备区中';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const use = params.choice === true || params.confirmed === true;
      if (!use) {
        st.localVars['鬼才/replaceCard'] = null;
        return;
      }
      st.localVars['鬼才/replaceCard'] = params.cardId ?? null;
    },
  );

  // ─── 判定改判钩子:翻开判定牌后询问是否替换 ────────────────
  registerJudgeModifier(state, skill.id, ownerId, async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number };
    if (atom.type !== '判定') return;
    // 界司马懿须存活且有手牌或装备
    const me = ctx.state.players[ownerId];
    if (!me?.alive) return;
    if (!hasReplaceableCards(ctx.state)) return;

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
        title: '界鬼才:是否打出一张手牌或装备牌代替判定牌?',
        cardFilter: { min: 1, max: 1 },
      },
      defaultChoice: false,
      timeout: 15,
    });

    const replaceCardId = ctx.state.localVars['鬼才/replaceCard'] as string | null | undefined;
    delete ctx.state.localVars['鬼才/replaceCard'];
    if (!replaceCardId) return; // 不替换

    // 二次校验:替换牌仍须在手牌或装备区中
    const location = findCardLocation(ctx.state, replaceCardId);
    if (location === null) return;

    // 若替换牌来自装备区:先卸载装备自带技能(移除技能),再从装备区卸下到手牌(卸下)
    //   与 装备通用 换装流程一致:移除技能 → 卸下,确保技能实例/vars 正确清理。
    if (location !== 'hand') {
      const equipSlot = location;
      const card = ctx.state.cardMap[replaceCardId];
      // 卸载装备自带的技能实例(武器技/马匹技等)
      if (card?.name && me.skills.includes(card.name)) {
        await applyAtom(ctx.state, {
          type: '移除技能',
          player: ownerId,
          skillId: card.name,
        });
      }
      // 卸下装备:装备区→手牌(清除武器攻击范围 vars,马匹 vars 由技能 onUnload 清理)
      await applyAtom(ctx.state, {
        type: '卸下',
        player: ownerId,
        slot: equipSlot,
      });
    }

    // 交换判定牌(直接 mutate frameCards,与标版鬼才/天妒同模式):
    //   判定 atom 的 toViewEvents 静态预算 discardPile+1(假设判定牌进弃牌堆),
    //   但其 afterHooks 用 splice 直接移动不产生 ViewEvent。若用 applyAtom(移动牌)
    //   会额外产生 ViewEvent 导致 processedView 与 buildView 不对称。
    //   故直接 mutate(不产生额外 ViewEvent),与天妒一致。
    //   已知限制:替换后 processedView 的 processing/discardPile/handCount 与 buildView 可能有偏差
    //   (判定 atom 视图模型局限),测试中关闭视图对比。
    const me2 = ctx.state.players[ownerId];
    const cur = frameCards(ctx.state);
    const lastIdx = cur.length - 1;
    if (lastIdx < 0) return;
    const originalJudgeId = cur[lastIdx];
    cur.splice(lastIdx, 1);
    ctx.state.zones.discardPile.push(originalJudgeId);
    me2.hand = me2.hand.filter((id) => id !== replaceCardId);
    cur.push(replaceCardId);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '界鬼才',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '界鬼才:选择一张手牌或装备牌代替判定牌',
      cardFilter: { min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
