// 八卦阵(防具):当你需要出闪时,可以判定,若为红色则视为出闪。
// 实现:在 询问闪 before hook 中
//   1. 先 请求回应 询问是否发动(requestType=八卦阵/confirm)
//   2. 玩家选发动 → applyAtom(判定) → 判定牌进弃牌堆,读花色
//   3. 红色 → 往处理区放入一张虚拟闪牌,再 cancel 主 询问闪 atom
//      (判定红色即视为出闪,不再询问目标出闪)。杀.execute 检测处理区有闪 →
//      走"被抵消"分支 → 武器技(贯石斧/青龙腰月刀)正常触发。
//   4. 黑色 / 玩家选不发动 / 超时 → 不干预,直接进入正常询问闪
// 杀不需要知道八卦阵——只看处理区有没有闪牌。
// cancel 询问闪不会跳过杀.execute 的后续逻辑:杀.execute 在 applyAtom(询问闪)
// 返回后自己检查处理区,与询问闪是否被 cancel 无关。武器技挂在独立的"被抵消"
// atom after(非询问闪 after),故不受询问闪 cancel 影响。
//
// 本文件同时导出 createBaguaDodgeSkill 工厂(八卦阵族"询问闪判定视为出闪"共享实现),
// 八阵(卧龙诸葛)复用之,仅注入文案前缀/生效守卫(无防具)等差异参数(镜像 鬼道/界鬼道)。
import type { Card, FrontendAPI, GameState, HookResult, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { runJudgeFlow } from '../flows/judge';
import { registerBeforeHook } from '../core/skill';
import { askConfirm, defineConfirmAction, registerConfirmRespond } from '../util/skillRuntime';

/** 八卦阵族(询问闪判定视为出闪)差异参数 */
export interface BaguaDodgeOptions {
  /** Skill.name(玩家可见技能名) */
  name: string;
  description: string;
  /** requestType/localVars 键/虚拟闪 id/判定 标签前缀(防具版 '八卦阵' / 卧龙诸葛 '八阵') */
  prefix: string;
  /** 询问是否发动的 confirm 标题(八阵带 '(判定,红色视为出闪)' 后缀) */
  confirmTitle: string;
  /** 锁定技标记(八阵为锁定技;防具版省略) */
  isLocked?: boolean;
  /** 生效守卫(八卦阵:装备槽防具仍是本卡;八阵:无防具)。返回 false 时不干预。 */
  guard: (state: GameState, ownerId: number) => boolean;
}

/** 八卦阵族共享实现:八卦阵(防具技)与八阵(锁定技)仅生效条件与文案不同,流程完全一致。 */
export function createBaguaDodgeSkill(opts: BaguaDodgeOptions) {
  const CONFIRM_RT = `${opts.prefix}/confirm`;
  const CONFIRMED_KEY = `${opts.prefix}/confirmed`;

  return {
    createSkill(id: string, ownerId: number): Skill {
      const skill: Skill = { id, ownerId, name: opts.name, description: opts.description };
      if (opts.isLocked) skill.isLocked = true;
      return skill;
    },

    onInit(skill: Skill, state: GameState): (() => void) | void {
      const ownerId = skill.ownerId;
      // respond:被询问"是否发动"时回应,设 localVars 标记结果
      registerConfirmRespond(state, skill.id, ownerId, CONFIRM_RT, CONFIRMED_KEY, {
        mismatchError: `当前不是${opts.prefix}确认`,
      });

      registerBeforeHook(
        state,
        skill.id,
        ownerId,
        '询问闪',
        async (ctx): Promise<HookResult | void> => {
          if ((ctx.atom).target !== ownerId) return;
          // 生效条件守卫(八卦阵:防具槽仍是本卡;八阵:无防具)
          if (!opts.guard(ctx.state, ownerId)) return;
          if (ctx.state.zones.deck.length === 0) return;

          // 询问是否发动
          const confirmed = await askConfirm(ctx.state, CONFIRM_RT, ownerId, {
            confirmedKey: CONFIRMED_KEY,
            title: opts.confirmTitle,
            confirmLabel: '发动',
            cancelLabel: '不发动',
            defaultChoice: false,
            timeout: 10,
          });
          if (!confirmed) return;

          // 判定:用返回值读最终判定牌(勿读弃牌堆顶——判定牌可能被 天妒/屯田 等
          // 「判定牌生效后」hook 收走而未入弃牌堆,读堆顶会拿到无关旧牌的花色)
          const judgeCardId = await runJudgeFlow(ctx.state, ownerId, opts.prefix);
          if (!judgeCardId) return;
          const judgeCard = ctx.state.cardMap[judgeCardId];
          if (!judgeCard) return;

          // 红色:往处理区放虚拟闪牌(通过移动牌 atom 产生 ViewEvent,保持 processedView 同步)
          // 然后 cancel 主 询问闪 atom —— 判定红色即视为出闪,不再询问目标出闪。
          // 杀.execute 检测处理区有闪 → 走"被抵消"分支 → 武器技正常触发。
          // 武器技挂在"被抵消" atom after(非询问闪 after),不受询问闪 cancel 影响。
          // ephemeral:虚拟闪被 promptCancel 移入弃牌堆时销毁而非入堆(防凭空牌污染牌库)。
          if (judgeCard.suit === '♥' || judgeCard.suit === '♦') {
            const dodgeId = `${opts.prefix}:${ownerId}:${judgeCardId}`;
            const virtualDodge: Card = {
              id: dodgeId,
              name: '闪',
              suit: judgeCard.suit,
              color: judgeCard.color,
              rank: judgeCard.rank,
              type: '基本牌',
              ephemeral: true,
            };
            ctx.state.cardMap[dodgeId] = virtualDodge;
            await applyAtom(ctx.state, {
              type: '移动牌',
              cardId: dodgeId,
              from: { zone: '处理区' },
              to: { zone: '处理区' },
            });
            return { kind: 'cancel' };
          }
        },
      );
      return () => {};
    },

    onMount(_skill: Skill, api: FrontendAPI): void {
      defineConfirmAction(api, 'respond', {
        label: opts.name,
        title: `是否发动${opts.name}？`,
        style: 'default',
      });
    },
  };
}

const OPTIONS: BaguaDodgeOptions = {
  name: '八卦阵',
  description: '防具技:当你需要出闪时,可以判定,若为红色则视为出闪',
  prefix: '八卦阵',
  confirmTitle: '是否发动八卦阵?',
  guard: (state, ownerId) => {
    // 动态校验防具仍在装备区(陷阱8:获得/顺手牵羊等路径只移除装备槽、
    // 不触发移除技能,陈旧 hook 可能残留)。触发前校验防具仍是八卦阵。
    const armorId = state.players[ownerId]?.equipment?.['防具'];
    return !!armorId && state.cardMap[armorId]?.name === '八卦阵';
  },
};

export const { createSkill, onInit, onMount } = createBaguaDodgeSkill(OPTIONS);
