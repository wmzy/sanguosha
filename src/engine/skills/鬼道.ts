// 鬼道(张角·被动触发):当一名角色的判定牌生效前,你可以用一张黑色牌替换之。
//
// 与鬼才(司马懿)同构:注册为判定改判钩子(registerJudgeModifier),由 判定牌生效前
// atom 的 afterApply 阶段(runJudgeModifiers)触发——在判定牌翻开(判定.apply 完成)后、
// 判定效果(闪电/乐不思蜀/雷击等消费方在 判定牌生效后 读判定牌)前询问张角是否替换。
//
// 与鬼才的差异:**仅限黑色牌**(♠或♣,即 color==='黑')替换;鬼才为任意手牌。
//
// 替换机制(同鬼才):走 flows/judge.ts 的 replaceJudgeCard —— 原判定牌(帧顶)经「移动牌」
//   入弃牌堆、黑色手牌经「移动牌」压入帧顶成为新判定牌。必须经 atom 而非直接 mutate:
//   替换牌离手(handCount)与原判定牌入弃牌堆(discardPileCount)都是公开信息,漏投影会让
//   客户端视图与权威 buildView 永久漂移。消费方(闪电/雷击)之后读到的是替换后的牌。
//
// 顺序保证:改判在 afterApply 阶段、消费方在 runAfterHooks 阶段,前者严格先于后者。
//   故张角任意座次都能生效。鬼道与鬼才同场时,runJudgeModifiers 按判定目标逆时针依次
//   询问。雷击(张角自身技能)在 `await applyAtom(判定)` 之后从弃牌堆顶读最终判定牌,
//   改判已在 afterApply 完成,故"打闪→雷击→鬼道改判为黑桃"链成立。
//
// 本文件同时导出 createJudgeReplaceSkill 工厂(判定替换技族共享实现),界鬼道 复用之,
// 仅注入文案前缀/提示后缀/黑桃2~9 摸牌等差异参数。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { frameCards } from '../core/frame';
import { registerAction, registerJudgeModifier } from '../core/skill';
import { replaceJudgeCard } from '../flows/judge';
import { requireRequestType } from '../util/skillRuntime';

/** 判定替换技(鬼道族)差异参数 */
export interface JudgeReplaceOptions {
  /** Skill.name(玩家可见技能名;标/界官方均为 '鬼道') */
  name: string;
  description: string;
  /** respond 询问的 requestType(技能名/xxx 命名空间,标/界键隔离) */
  replaceRequestType: string;
  /** 记录所选替换牌的 localVars 键 */
  replaceCardKey: string;
  /** 询问/报错文案的技能名前缀(标 '鬼道' / 界 '界鬼道') */
  promptName: string;
  /** 替换牌颜色过滤(标/界均为黑色 ♠或♣;工厂据此派生手牌过滤与 cardFilter) */
  colorFilter: (card: Card) => boolean;
  /** 询问/选择标题的补充说明(界版 '(黑桃2~9摸一张)');标版省略 */
  hint?: string;
  /** 替换成功后的追加效果(界版:替换牌为黑桃2~9 → 摸一张牌) */
  onReplaced?: (state: GameState, ownerId: number, replaceCardId: string) => Promise<void>;
}

/** 判定替换技共享实现:标版鬼道与界鬼道仅文案与界限突破追加效果不同,机制完全一致。 */
export function createJudgeReplaceSkill(opts: JudgeReplaceOptions) {
  /** 按 cardId 判定是否为可替换牌(手牌过滤与替换前二次校验共用) */
  const matchesFilter = (state: GameState, cardId: string): boolean => {
    const card = state.cardMap[cardId];
    return !!card && opts.colorFilter(card);
  };
  const askTitle = `${opts.promptName}:是否打出一张黑色牌代替判定牌?${opts.hint ?? ''}`;
  const pickTitle = `${opts.promptName}:选择一张黑色牌代替判定牌${opts.hint ?? ''}`;

  return {
    createSkill(id: string, ownerId: number): Skill {
      return { id, ownerId, name: opts.name, description: opts.description };
    },

    onInit(skill: Skill, state: GameState): (() => void) | undefined {
      const ownerId = skill.ownerId;

      // ─── respond:选替换牌(或拒绝) ──────────────────────
      registerAction(
        state,
        skill.id,
        ownerId,
        'respond',
        (st: GameState, params: Record<string, Json>): string | null => {
          const check = requireRequestType(st, ownerId, [opts.replaceRequestType], {
            mismatchError: `当前不是${opts.promptName}询问`,
          });
          if (check.error) return check.error;
          // 选择替换:cardId 必须是符合条件的黑色手牌;拒绝则无额外要求
          // 浏览器/Headless 客户端对 useCard 型 pending 只发 {cardId}(无 choice),
          // 故 cardId 出现即视为发动意图;{choice:false}/{} 仍视为不发动。
          if (
            params.choice === true ||
            params.confirmed === true ||
            typeof params.cardId === 'string'
          ) {
            const cardId = params.cardId as string | undefined;
            if (typeof cardId !== 'string') return '请选择一张替换牌';
            if (!st.players[ownerId].hand.includes(cardId)) return '替换牌不在手牌中';
            if (!matchesFilter(st, cardId)) return `${opts.promptName}只能用黑色牌替换`;
          }
          return null;
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          const use =
            params.choice === true || params.confirmed === true || typeof params.cardId === 'string';
          if (!use) {
            st.localVars[opts.replaceCardKey] = null;
            return;
          }
          st.localVars[opts.replaceCardKey] = params.cardId ?? null;
        },
      );

      // ─── 判定改判钩子:翻开判定牌后询问是否用黑色牌替换 ────────────
      registerJudgeModifier(state, skill.id, ownerId, async (ctx) => {
        const atom = ctx.atom;
        if (atom.type !== '判定牌生效前') return;

        const me = ctx.state.players[ownerId];
        if (!me?.alive) return;
        // 仅当有符合颜色过滤的手牌时才询问
        if (!me.hand.some((id) => matchesFilter(ctx.state, id))) return;

        // 当前判定牌(frameCards 顶)
        const cards = frameCards(ctx.state);
        if (cards.length === 0) return;

        // 询问是否替换
        delete ctx.state.localVars[opts.replaceCardKey];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: opts.replaceRequestType,
          target: ownerId,
          prompt: {
            type: 'useCard',
            title: askTitle,
            cardFilter: { filter: (c) => opts.colorFilter(c), min: 1, max: 1 },
          },
          defaultChoice: false,
          timeout: 15,
        });

        const replaceCardId = ctx.state.localVars[opts.replaceCardKey] as string | null | undefined;
        delete ctx.state.localVars[opts.replaceCardKey];
        if (!replaceCardId) return; // 不替换

        // 二次校验:替换牌仍须在手中且符合颜色过滤
        if (!me.hand.includes(replaceCardId)) return;
        if (!matchesFilter(ctx.state, replaceCardId)) return;

        // 交换判定牌:原判定牌 → 弃牌堆,替换牌 → 处理区(帧顶)。
        // 两步都走「移动牌」atom —— 直接 mutate frameCards 会漏掉「替换牌离手(handCount)」
        // 与「原判定牌入弃牌堆(discardPileCount)」的视图投影,客户端会一直显示替换牌仍在持有者手中。
        await replaceJudgeCard(ctx.state, ownerId, replaceCardId);

        // 界限突破扩展点:替换成功后的追加效果(界版:黑桃2~9 → 摸一张牌)
        if (opts.onReplaced) {
          await opts.onReplaced(ctx.state, ownerId, replaceCardId);
        }
      });

      return () => {};
    },

    onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
      api.defineAction('respond', {
        label: opts.name,
        style: 'primary',
        prompt: {
          type: 'useCard',
          title: pickTitle,
          cardFilter: { filter: (c) => opts.colorFilter(c), min: 1, max: 1 },
        },
      });
    },
  };
}

const OPTIONS: JudgeReplaceOptions = {
  name: '鬼道',
  description: '判定牌生效前,你可以用一张黑色牌替换之',
  replaceRequestType: '鬼道/replace',
  replaceCardKey: '鬼道/replaceCard',
  promptName: '鬼道',
  colorFilter: (c) => c.color === '黑',
};

export const { createSkill, onInit, onMount } = createJudgeReplaceSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
