// 鬼才(司马懿·被动触发):在任意角色的判定牌生效前,你可以打出一张手牌代替之。
//
// 触发时机:判定牌翻开(判定 atom.apply 完成)后、判定效果(闪电/兵粮寸断/乐不思蜀等
//   消费技能在 判定牌生效后 读判定牌)生效前。本技能注册为判定改判钩子(registerJudgeModifier),
//   由 判定牌生效前 atom 的 afterApply 阶段(runJudgeModifiers)触发:
//   - 判定 atom.apply 已把判定牌推入 frameCards(top)
//   - 判定牌生效前.afterApply:runJudgeModifiers 从判定目标起逆时针逐个询问改判能力
//   - 本钩子询问司马懿是否替换:是 → 把 frameCards 顶的判定牌移入弃牌堆,手牌压入帧顶
//   - 之后 判定牌生效后 的技能 after hooks(闪电等消费方)读 frameCards 顶 → 看到替换后的牌
//   - runJudgeFlow 末尾把 frameCards 顶移入弃牌堆
//
// 顺序保证:改判在 判定牌生效前.afterApply、消费方在 判定牌生效后 after-hook,前者严格先于后者。
//   故司马懿任意座次都能生效(不再依赖“座次靠前于消费方”)。鬼才与鬼道同场时,
//   runJudgeModifiers 按判定目标逆时针依次询问,顺序符合官方规则。
//
// 交换判定牌走 flows/judge.ts 的 replaceJudgeCard:原判定牌与替换牌各经一步「移动牌」atom
//   (前者入弃牌堆、后者打出到帧顶),交换全程有视图投影。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply'
import { frameCards } from '../core/frame';
import { registerAction, registerJudgeModifier } from '../core/skill';
import { replaceJudgeCard } from '../flows/judge';
import { requireRequestType } from '../util/skillRuntime';

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
      const check = requireRequestType(st, ownerId, ['鬼才/replace'], {
        mismatchError: '当前不是鬼才询问',
      });
      if (check.error) return check.error;
      // 若选择替换:cardId 必须在手牌中;若选择不替换:无额外要求
      // 浏览器/Headless 客户端对 useCard 型 pending 只发 {cardId}(无 choice),
      // 故 cardId 出现即视为发动意图;{choice:false}/{} 仍视为不发动。
      if (params.choice === true || params.confirmed === true || typeof params.cardId === 'string') {
        const cardId = params.cardId as string;
        if (typeof cardId !== 'string') return '请选择一张替换牌';
        if (!st.players[ownerId].hand.includes(cardId)) return '替换牌不在手牌中';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const use =
        params.choice === true || params.confirmed === true || typeof params.cardId === 'string';
      if (!use) {
        st.localVars['鬼才/replaceCard'] = null;
        return;
      }
      st.localVars['鬼才/replaceCard'] = (params.cardId) ?? null;
    },
  );

  // ─── 判定改判钩子:翻开判定牌后询问是否替换 ────────────────
  registerJudgeModifier(state, skill.id, ownerId, async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '判定牌生效前') return;
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
        cardFilter: { filter: () => true, min: 1, max: 1 },
      },
      defaultChoice: false,
      timeout: 15,
    });

    const replaceCardId = ctx.state.localVars['鬼才/replaceCard'] as string | null | undefined;
    delete ctx.state.localVars['鬼才/replaceCard'];
    if (!replaceCardId) return; // 不替换

    // 二次校验:替换牌仍须在手牌中
    if (!me.hand.includes(replaceCardId)) return;

    // 交换判定牌:原判定牌 → 弃牌堆,替换牌 → 处理区(帧顶)。
    // 两步都走「移动牌」atom —— 直接 mutate frameCards 会漏掉「替换牌离手(handCount)」
    // 与「原判定牌入弃牌堆(discardPileCount)」的视图投影,客户端会一直显示司马懿手里还有那张牌。
    await replaceJudgeCard(ctx.state, ownerId, replaceCardId);
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
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
  });
}
