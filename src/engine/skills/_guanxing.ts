// src/engine/skills/_guanxing.ts — 观星族(观星/界观星)共享实现工厂。
//
// 两版主流程同构(askConfirm → 观察顶 X 张 → 请求回应 arrange → 校验 top/bottom
// 划分 → 构建新牌堆 → 整理牌堆),真实差异仅两处,经 GuanxingOptions 注入:
//   1. calcX:观察张数 X(标 = min(全场角色数含阵亡, 5);界 = 存活角色数 < 4 ? 3 : 5);
//   2. retriggerAtEndPhase(界版附加段):准备阶段所有观察牌皆置底 → 结束阶段
//      可再次发动一次(localVars `${skillId}/全置底` 一次性标志,消费后清除,不再级联)。
//
// 触发时机:「阶段开始」after-hook —— 准备 阶段为主入口;界版另含 回合结束
// (= 结束阶段)分支消费全置底标志。标/界版共用本文件后,界观星不再独立维护主流程。
//
// 牌堆方向约定(与 摸牌 atom 一致,本族唯一一份文档):摸牌 取 deck.slice(-count),
// 故 deck[0]=牌堆底(最后摸),deck[len-1]=牌堆顶(最先摸)。
// newDeck 构造:[...bottom, ...middle, ...top.reverse()]
//   - bottom 放最底;middle 是观察范围之外的牌(原 deck 去掉顶 X 张);
//   - top 倒序后追加到末尾,使 top[0] 落到 deck[len-1]=最先摸。
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import {
  askConfirm,
  currentRequestType,
  defineConfirmAction,
  requireRequestType,
} from '../util/skillRuntime';

/** 观星族(主动技)差异参数 */
export interface GuanxingOptions {
  /** Skill.name(标 '观星' / 界 '界观星') */
  name: string;
  description: string;
  /** 技能 id:requestType/localVars 键前缀 + 错误文案前缀(标 '观星' / 界 '界观星') */
  skillId: string;
  /** 观察张数 X 计算(标 = min(全场角色数含阵亡, 5);界 = 存活角色数 < 4 ? 3 : 5) */
  calcX: (state: GameState) => number;
  /** arrange 弹窗标题(逐字保留各版现状:标版全角冒号 '观星：排列牌堆顶牌' / 界版半角 '界观星:排列牌堆顶牌') */
  arrangeTitle: string;
  /** 界版附加段:准备阶段全置底 → 结束阶段再次发动一次(标版无,缺省关闭) */
  retriggerAtEndPhase?: boolean;
}

/** 观星族共享实现:标版观星与界观星的 respond/主流程/触发时机 逐字一致;
 *  仅 calcX 与界版「全置底再触发」附加段经参数注入。 */
export function createGuanxingSkill(opts: GuanxingOptions) {
  const confirmRt = `${opts.skillId}/confirm`;
  const arrangeRt = `${opts.skillId}/arrange`;
  const confirmedKey = `${opts.skillId}/confirmed`;
  const arrangeKey = `${opts.skillId}/arrangement`;
  const allBottomKey = `${opts.skillId}/全置底`;

  /**
   * 观星主流程:询问是否发动 → 询问排列 → 构建新牌堆 → 整理牌堆。
   * @returns 是否「皆置于牌堆底」(界版结束阶段再次发动条件);未发动/非法划分时返回 false。
   */
  async function doGuanxing(state: GameState, ownerId: number): Promise<boolean> {
    const deck = state.zones.deck;
    if (deck.length === 0) return false; // 牌堆空:无法观星

    const drawCount = Math.min(opts.calcX(state), deck.length);
    if (drawCount === 0) return false;

    // 询问是否发动
    const confirmed = await askConfirm(state, confirmRt, ownerId, {
      confirmedKey,
      title: `是否发动${opts.name}?`,
      confirmLabel: '发动',
      cancelLabel: '不发动',
      defaultChoice: false,
      timeout: 15,
    });
    if (!confirmed) return false;

    // 观察牌堆顶 drawCount 张(deck 末尾为顶)
    const observed = deck.slice(-drawCount);

    // 询问排列
    delete state.localVars[arrangeKey];
    await applyAtom(state, {
      type: '请求回应',
      requestType: arrangeRt,
      target: ownerId,
      prompt: {
        type: 'distribute',
        title: opts.arrangeTitle,
        description: '选择留在牌堆顶的牌(顺序即摸牌顺序)与置于牌堆底的牌',
        mode: 'select',
        cardIds: observed,
        minTotal: 0,
        maxTotal: drawCount,
      },
      defaultChoice: false,
      timeout: 30,
    });

    const arrangement = state.localVars[arrangeKey] as
      | { top: string[]; bottom: string[] }
      | undefined;
    delete state.localVars[arrangeKey];
    delete state.localVars[confirmedKey];

    const top = arrangement?.top ?? [];
    const bottom = arrangement?.bottom ?? [];
    // 校验划分:top+bottom 必须恰好是 observed 的一个无重复划分
    const observedSet = new Set(observed);
    const combined = [...top, ...bottom];
    const valid =
      combined.length === observed.length &&
      new Set(combined).size === combined.length &&
      combined.every((id) => observedSet.has(id));
    if (!valid) {
      // 非法划分(超时默认空 / 玩家乱给):保持原序,不调整牌堆
      return false;
    }

    // 构建新牌堆:bottom 置底 → middle(未观察)→ top 倒序置顶(使 top[0] 最先摸)
    const middle = deck.slice(0, deck.length - drawCount);
    const newDeck = [...bottom, ...middle, ...[...top].reverse()];

    await applyAtom(state, {
      type: '整理牌堆',
      cards: newDeck,
      topCount: top.length,
      bottomCount: bottom.length,
    });

    // 全置底判定:top 为空即「皆置于牌堆底」
    return top.length === 0;
  }

  return {
    createSkill(id: string, ownerId: number): Skill {
      return {
        id,
        ownerId,
        name: opts.name,
        description: opts.description,
      };
    },

    onInit(skill: Skill, state: GameState): (() => void) | undefined {
      const ownerId = skill.ownerId;

      // respond:处理 confirm 与 arrange 两种询问。
      // 不改走 registerConfirmRespond:confirm 与 arrange 共用同一注册键
      // (skillId, ownerId, 'respond')(registerAction 单键覆盖,两个注册只能存活一个),
      // 属 skillRuntime 注释「confirm 之外还分支…仍由各技能手写分支」的形态;
      // slot 读取已收敛为 currentRequestType,不再手写 pendingSlots 反射。
      registerAction(
        state,
        skill.id,
        ownerId,
        'respond',
        (state, params) => {
          const check = requireRequestType(state, ownerId, [confirmRt, arrangeRt], {
            mismatchError: `当前不是${opts.skillId}询问`,
          });
          if (check.error) return check.error;
          if (check.requestType === arrangeRt) {
            // arrange 必须提供 top/bottom 划分
            if (!Array.isArray(params.top) || !Array.isArray(params.bottom)) {
              return `${opts.skillId}:需要 top/bottom 划分`;
            }
          }
          return null;
        },
        async (state, params) => {
          const requestType = currentRequestType(state, ownerId);
          if (requestType === confirmRt) {
            state.localVars[confirmedKey] = params.choice === true || params.confirmed === true;
          } else if (requestType === arrangeRt) {
            state.localVars[arrangeKey] = {
              top: params.top ?? [],
              bottom: params.bottom ?? [],
            };
          }
        },
      );

      // 阶段开始 after-hook:按 phase 分支(准备=主入口;界版 回合结束=再次发动)
      registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
        const atom = ctx.atom;
        if (atom.type !== '阶段开始') return;
        if (atom.player !== ownerId) return;
        if (!ctx.state.players[ownerId]?.alive) return;

        if (opts.retriggerAtEndPhase && atom.phase === '回合结束') {
          // 结束阶段(=phase '回合结束'):若「全置底」标志存在 → 再次发动(消费并清除,不再级联)
          if (!ctx.state.localVars[allBottomKey]) return;
          delete ctx.state.localVars[allBottomKey];
          await doGuanxing(ctx.state, ownerId);
          return;
        }
        if (atom.phase !== '准备') return;

        if (opts.retriggerAtEndPhase) {
          // 准备阶段:首次发动;若全置底,设标志供结束阶段再次发动
          delete ctx.state.localVars[allBottomKey];
          const allBottom = await doGuanxing(ctx.state, ownerId);
          if (allBottom) {
            ctx.state.localVars[allBottomKey] = true;
          }
        } else {
          await doGuanxing(ctx.state, ownerId);
        }
      });

      return () => {};
    },

    onMount(_skill: Skill, api: FrontendAPI): void {
      defineConfirmAction(api, 'respond', {
        label: opts.name,
        title: `是否发动${opts.name}?`,
        style: 'default',
      });
    },
  };
}
