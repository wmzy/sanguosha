// 仁德(刘备) — 标准版/国战版:
//   出牌阶段,可以将任意数量手牌交给其他角色;以此法失去第二张牌时,回复 1 点体力。
//   无发动次数限制(可多次使用,但回血每回合仅一次)。
//
// 本文件同时导出 createRendeSkill 工厂(仁德族共享实现)与 normalizeAllocation,
// 界仁德 复用之,仅注入 单目标/每名角色限一次校验、跨第二张的询问视为使用基本牌 差异;
// vars 键('仁德/givenCount' 等)两版共用——同一角色只会拥有一版仁德。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom } from '../core/apply'
import { popFrame, pushFrame } from '../core/frame';
import { registerAction } from '../core/skill';
import { engineCanPlayNow } from '../util/skillRuntime';
import type { SkillModule } from '../types';

/** 给牌分配格式 */
export type RendeAllocation = Array<{ target: number; cardIds: string[] }>;

/** 规范化分配格式(兼容 allocation / targets 分配数组 / 简单格式);无法识别 → null。
 *  三种调用格式:
 *  1. 分配格式(distribute UI 提交): params.allocation = [{target, cardIds}](多牌多目标)
 *  2. 分配格式(旧): params.targets = [{target, cardIds}]
 *  3. 简单格式(前端 handlePlayCard): params.cardId + params.targets=[idx](单牌单目标) */
export function normalizeAllocation(params: Record<string, Json>): RendeAllocation | null {
  const allocParam = params.allocation as RendeAllocation | undefined;
  const allocTargets = params.targets as RendeAllocation | undefined;
  const simpleCardId = params.cardId as string | undefined;
  const simpleTargets = params.targets as number[] | undefined;
  if (
    Array.isArray(allocParam) &&
    allocParam.length > 0 &&
    Array.isArray(allocParam[0].cardIds)
  ) {
    return allocParam;
  }
  if (
    Array.isArray(allocTargets) &&
    allocTargets.length > 0 &&
    Array.isArray(allocTargets[0].cardIds)
  ) {
    return allocTargets;
  }
  if (simpleCardId && Array.isArray(simpleTargets) && simpleTargets.length > 0) {
    return [{ target: simpleTargets[0], cardIds: [simpleCardId] }];
  }
  return null;
}

/** 仁德族差异参数。 */
export interface RendeOptions {
  /** 技能名(Skill.name / 按钮 label / validate 错误文案:标 '仁德' / 界 '界仁德') */
  skillName: string;
  description: string;
  /** distribute 询问标题 */
  mountTitle: string;
  /** 界版附加校验(单目标 + 每名角色每回合限一次);已通过全部公共校验后调用 */
  extraValidate?: (state: GameState, ownerId: number, normalized: RendeAllocation) => boolean;
  /** 「以此法给出第二张牌」防重入键(标 '仁德/healed' / 界 '仁德/basicUsed',共享键空间) */
  crossGuardKey: string;
  /** 给牌主体(移动牌 + 更新 givenCount)后的版本差异结算:
   *  标 = 跨第二张回血;界 = 记录已给目标 + 跨第二张询问视为使用基本牌。 */
  afterGive: (
    state: GameState,
    from: number,
    targets: RendeAllocation,
    shouldCross: boolean,
  ) => Promise<void>;
  /** 界版附加注册(视为使用基本牌的 respond) */
  extraInit?: (state: GameState, skillId: string, ownerId: number) => void;
  /** 界版附加 onMount(respond 按钮) */
  extraMount?: (api: FrontendAPI) => void;
}

/** 仁德族共享实现:给牌 use action 的校验/移动/计数逐字一致。 */
export function createRendeSkill(opts: RendeOptions) {
  function createSkill(id: string, ownerId: number): Skill {
    return {
      id,
      ownerId,
      name: opts.skillName,
      description: opts.description,
    };
  }

  function onInit(skill: Skill, state: GameState): (() => void) | void {
    const ownerId = skill.ownerId;
    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (state: GameState, params: Record<string, Json>) => {
        // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活(engineCanPlayNow 四合一)
        const self = state.players[ownerId];
        const normalized = normalizeAllocation(params);
        if (!normalized) return '需要指定牌和目标';

        const hasCards = normalized.reduce((n, t) => n + t.cardIds.length, 0) > 0;
        // 收集所有 cardId 检查重复 + 都在手牌
        const allCardIds: string[] = [];
        let noDuplicates = true;
        let allInHand = true;
        if (hasCards) {
          for (const t of normalized) {
            if (!Array.isArray(t.cardIds)) {
              allInHand = false;
              continue;
            }
            for (const cardId of t.cardIds) {
              if (allCardIds.includes(cardId)) {
                noDuplicates = false;
              }
              allCardIds.push(cardId);
              if (!self.hand.includes(cardId)) {
                allInHand = false;
              }
            }
          }
        }
        // 目标合法:不是自己 + 存活
        const targetsLegal =
          hasCards &&
          normalized.every((t) => t.target !== ownerId && state.players[t.target]?.alive === true);
        const ok =
          engineCanPlayNow(state, ownerId) &&
          hasCards &&
          noDuplicates &&
          allInHand &&
          targetsLegal &&
          (!opts.extraValidate || opts.extraValidate(state, ownerId, normalized));
        return ok ? null : `现在不能使用${opts.skillName}`;
      },
      async (state: GameState, params: Record<string, Json>) => {
        const from = ownerId;
        const self = state.players[from];
        await pushFrame(state, '仁德', from, { ...params });

        const targets = normalizeAllocation(params)!;

        // 计算本次给牌数,判断是否跨过第二张:
        // 规则「以此法给出/失去第二张牌时」——按本回合累计给出数,首次跨过 2 张时触发。
        const beforeCount =
          typeof self.vars['仁德/givenCount'] === 'number' ? self.vars['仁德/givenCount'] : 0;
        const thisCount = targets.reduce((n, t) => n + t.cardIds.length, 0);
        const afterCount = beforeCount + thisCount;
        const shouldCross = afterCount >= 2 && !self.vars[opts.crossGuardKey];
        // 移动牌(逐张 applyAtom)
        for (const t of targets) {
          for (const cardId of t.cardIds) {
            await applyAtom(state, {
              type: '移动牌',
              cardId,
              from: { zone: '手牌', player: from },
              to: { zone: '手牌', player: t.target },
            });
          }
        }
        // 更新累计计数
        self.vars['仁德/givenCount'] = afterCount;
        // 版本差异结算(标:跨第二张回血 / 界:记录已给目标 + 询问视为使用基本牌)
        await opts.afterGive(state, from, targets, shouldCross);
        await popFrame(state);
      },
    );
    opts.extraInit?.(state, skill.id, ownerId);
    return () => {};
  }

  function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
    api.defineAction('use', {
      label: opts.skillName,
      style: 'primary',
      prompt: {
        type: 'distribute',
        mode: 'allocate',
        title: opts.mountTitle,
        source: 'hand',
        minPerTarget: 1,
        maxPerTarget: 99,
        minTotal: 1,
        maxTotal: 99,
        allowSelf: false,
      },
    });
    opts.extraMount?.(api);
    return () => {};
  }

  return { createSkill, onInit, onMount };
}

const OPTIONS: RendeOptions = {
  skillName: '仁德',
  description: '出牌阶段:将任意张手牌交给其他角色;以此法失去第二张牌时回复1点体力',
  mountTitle: '仁德：选择要送出的手牌和目标角色',
  crossGuardKey: '仁德/healed',
  afterGive: async (state, from, _targets, shouldHeal) => {
    // 回血每回合仅 1 次(用 仁德/healed 标记,回合结束 atom 统一清理 /usedThisTurn、
    // /healed 不在此列)
    if (shouldHeal) {
      await applyAtom(state, { type: '回复体力', target: from, amount: 1 });
      state.players[from].vars['仁德/healed'] = true;
    }
  },
};

export const { createSkill, onInit, onMount } = createRendeSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
