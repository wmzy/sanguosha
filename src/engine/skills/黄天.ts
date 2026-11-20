// 黄天(张角·主公技):其他群势力角色可以在其出牌阶段将一张【闪】或【闪电】交给你。
//   每名角色每回合限一次。
//
// 模式 B 变体(主公技):在张角(ownerId)实例上注册,但 use action 注册在
//   每个群势力盟友座次上(非张角本人),盟友在自己出牌阶段主动交牌。
//   参考护驾(为魏势力盟友注册 respond action)的同构模式。
//
// 流程:
//   1. 群势力盟友在自己回合出牌阶段 dispatch 黄天.use(选一张闪/闪电)
//   2. validate:盟友回合+出牌阶段+无pending+存活+张角为主公+张角存活+牌为闪/闪电且在手+本回合未用
//   3. execute:移动牌(盟友手牌→张角手牌)+ 标记本回合已用
//
// 主公判定:ownerId === 0(参考激将/若愚的主公判定约定)。
// 限一次:player.vars['黄天/usedThisTurn'](后缀约定,回合结束 atom 自动清空)。
//
// 本文件同时导出 createHuangtianSkill 工厂(黄天族共享实现),界黄天 复用之,
// 仅注入 技能id/描述/文案/可交牌谓词 差异参数(标=闪/闪电;界=闪或黑桃手牌)。
import type { Card, FrontendAPI, GameState, Json, Skill, SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../rules/once-per-turn';
import { registerAction } from '../core/skill';
import { engineCanPlayNow } from '../util/skillRuntime';

/** 黄天族(主公技)差异参数 */
export interface HuangtianOptions {
  /** 技能 id:限一次 vars 键与错误文案前缀(标 '黄天' / 界 '界黄天') */
  skillId: string;
  /** Skill.name 与按钮文案(标 '黄天';界版 '黄天' 为 OL 官方技能名,区别于技能 id。默认 = skillId) */
  displayName?: string;
  /** createSkill 描述 */
  description: string;
  /** 「非主公不可用」错误文案(标 '黄天为主公技,张角非主公' / 界 '界黄天为主公技,界张角非主公') */
  lordOnlyError: string;
  /** 可交牌描述(错误文案/弹窗标题共用:标 '【闪】或【闪电】' / 界 '【闪】或黑桃手牌') */
  cardDesc: string;
  /** 一张牌是否可交(标:闪/闪电;界:闪或黑桃手牌)。引擎侧按 cardMap 查,前端侧用于
   *  cardFilter 与手牌渲染过滤,同一谓词双端同源。 */
  isGiveableCard: (card: Card | undefined) => boolean;
}

/** 黄天族共享实现:标版黄天与界黄天的 注册循环/validate/execute/onMount 逐字一致,
 *  仅 可交牌谓词 与 名称/文案 差异经参数注入。 */
export function createHuangtianSkill(opts: HuangtianOptions) {
  const skillId = opts.skillId;
  const displayName = opts.displayName ?? skillId;

  /** 判断一张牌是否为本技能可交的牌(引擎侧按 cardMap 查) */
  function isGiveableCard(state: GameState, cardId: string): boolean {
    const card = state.cardMap[cardId];
    return !!card && opts.isGiveableCard(card);
  }

  return {
    createSkill(id: string, ownerId: number): Skill {
      return {
        id,
        ownerId,
        name: displayName,
        description: opts.description,
      };
    },

    onInit(skill: Skill, state: GameState): (() => void) | undefined {
      const ownerId = skill.ownerId;

      // ── 为每个群势力盟友(非张角)注册 use action ──
      for (const p of state.players) {
        const allyIdx = p.index;
        if (allyIdx === ownerId) continue;
        if (p.faction !== '群') continue;

        registerAction(
          state,
          skill.id,
          allyIdx,
          'use',
          (st: GameState, params: Record<string, Json>): string | null => {
            // 主公技:仅张角为主公(ownerId===0)时可用
            if (ownerId !== 0) return opts.lordOnlyError;
            const lord = st.players[ownerId];
            if (!lord?.alive) return '主公不存在或已死亡';

            const self = st.players[allyIdx];
            if (!self?.alive) return '已死亡';
            // 自己回合 + 出牌阶段 + 无阻塞 pending(存活已由上方早退校验)→ engineCanPlayNow
            if (!engineCanPlayNow(st, allyIdx)) return `现在不能使用${skillId}`;

            // 每回合限一次
            if (usedThisTurn(st, allyIdx, skillId)) return `本回合已使用过${skillId}`;

            // 牌校验:可交的牌,且在手牌中
            const cardId = params.cardId as string | undefined;
            if (typeof cardId !== 'string') return '请选择一张牌';
            if (!self.hand.includes(cardId)) return '牌不在手牌中';
            if (!isGiveableCard(st, cardId)) return `${skillId}只能交出${opts.cardDesc}`;
            return null;
          },
          async (st: GameState, params: Record<string, Json>): Promise<void> => {
            const cardId = params.cardId as string;
            // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
            await markOncePerTurn(st, allyIdx, skillId);
            // 移动牌:盟友手牌 → 张角手牌
            await applyAtom(st, {
              type: '移动牌',
              cardId,
              from: { zone: '手牌', player: allyIdx },
              to: { zone: '手牌', player: ownerId },
            });
          },
        );
      }

      return () => {};
    },

    onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
      const ownerId = skill.ownerId;
      // 盟友的主动交牌 action。势力(群)与主公检查由后端 validate 处理
      // (GameView 不暴露 faction,activeWhen 仅做能力范围内的 UI 过滤)。
      api.defineAction('use', {
        label: displayName,
        style: 'primary',
        prompt: {
          type: 'useCard',
          title: `${skillId}:交出一张${opts.cardDesc}给主公`,
          cardFilter: {
            filter: (c) => opts.isGiveableCard(c),
            min: 1,
            max: 1,
          },
        },
        activeWhen: (ctx) =>
          // 主公本人不应发动黄天(黄天是其他群势力角色交给主公的技能)
          ctx.perspectiveIdx !== ownerId &&
          activeUnlessUsedThisTurn(skillId)(ctx) &&
          // 手中有可交的牌时才渲染
          ctx.view.players[ctx.perspectiveIdx]?.hand?.some((c) => opts.isGiveableCard(c)) === true,
      });
    },
  };
}

const OPTIONS: HuangtianOptions = {
  skillId: '黄天',
  description: '主公技:其他群势力角色可在出牌阶段将一张【闪】或【闪电】交给你',
  lordOnlyError: '黄天为主公技,张角非主公',
  cardDesc: '【闪】或【闪电】',
  isGiveableCard: (c) => c?.name === '闪' || c?.name === '闪电',
};

export const { createSkill, onInit, onMount } = createHuangtianSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
