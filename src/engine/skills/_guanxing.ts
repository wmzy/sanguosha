// src/engine/skills/_guanxing.ts — 观星族(观星/界观星/界恂恂)共享实现工厂。
//
// 三版主流程同构(askConfirm → 观察顶 X 张 → 请求回应 arrange → 校验 top/bottom
// 划分 → 构建新牌堆 → 整理牌堆),真实差异经 GuanxingOptions 注入:
//   1. calcX:观察张数 X(标 = min(全场角色数含阵亡, 5);界 = 存活角色数 < 4 ? 3 : 5;
//      恂恂 = 固定 4);
//   2. retriggerAtEndPhase(界观星附加段):准备阶段所有观察牌皆置底 → 结束阶段
//      可再次发动一次(localVars `${varsPrefix}/全置底` 一次性标志,消费后清除,不再级联);
//   3. phase + requiredTop(恂恂):摸牌阶段开始时触发(after-hook 在 phase 切换后、
//      实际摸牌前执行,重排可影响本次摸牌),且须恰好 min(requiredTop, X) 张置顶
//      (respond 即拒非法划分),与观星族「任意张置顶」不同。
//
// 触发时机:「阶段开始」after-hook —— 观星族 准备 阶段 / 恂恂 摸牌 阶段为主入口;
// 界观星另含 回合结束(= 结束阶段)分支消费全置底标志。
//
// 牌堆方向约定(与 摸牌 atom 一致,本族唯一一份文档):摸牌 取 deck.slice(-count),
// 故 deck[0]=牌堆底(最后摸),deck[len-1]=牌堆顶(最先摸)。
// newDeck 构造:[...bottom, ...middle, ...top.reverse()]
//   - bottom 放最底;middle 是观察范围之外的牌(原 deck 去掉顶 X 张);
//   - top 倒序后追加到末尾,使 top[0] 落到 deck[len-1]=最先摸。
import type { GameState, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import {
  askConfirm,
  currentRequestType,
  makeConfirmMount,
  requireRequestType,
} from '../util/skillRuntime';

/** 观星族(主动技)差异参数 */
export interface GuanxingOptions {
  /** Skill.name(标 '观星' / 界 '界观星' / 恂恂 '恂恂') */
  name: string;
  description: string;
  /** requestType 键前缀(标 '观星' / 界 '界观星' / 恂恂 '界恂恂') */
  skillId: string;
  /** localVars 键与错误文案前缀;缺省 = skillId(恂恂 '恂恂' ≠ skillId '界恂恂') */
  varsPrefix?: string;
  /** 触发阶段(观星族 '准备' / 恂恂 '摸牌');缺省 '准备' */
  phase?: '准备' | '摸牌';
  /** 观察张数 X 计算(标 = min(全场角色数含阵亡, 5);界 = 存活角色数 < 4 ? 3 : 5;恂恂 = 固定 4) */
  calcX: (state: GameState) => number;
  /** arrange 弹窗标题,静态串或随观察张数 X 求值(逐字保留各版现状:标版全角冒号
   *  '观星：排列牌堆顶牌' / 界版半角 '界观星:排列牌堆顶牌' / 恂恂动态
   *  '恂恂:选择 N 张置于牌堆顶(顺序即摸牌顺序),其余置于牌堆底') */
  arrangeTitle: string | ((drawCount: number) => string);
  /** arrange 弹窗描述;null = 不带 description 字段(恂恂);缺省用观星族通用文案 */
  arrangeDescription?: string | null;
  /** confirm 询问描述,静态串或随观察张数 X 求值(恂恂 '观看牌堆顶 X 张牌,选择置顶与置底');缺省不带 */
  confirmDescription?: string | ((drawCount: number) => string);
  /** 置顶张数硬约束(恂恂 2):top 须恰好 min(requiredTop, X) 张且与 bottom 构成观察范围的
   *  无重复完整划分,respond 即拒;缺省任意 0..X 张置顶,非法划分仅主流程兜底拒绝 */
  requiredTop?: number;
  /** 界版附加段:准备阶段全置底 → 结束阶段再次发动一次(标版无,缺省关闭) */
  retriggerAtEndPhase?: boolean;
}

/** 观星族共享实现:观星/界观星/界恂恂 的 respond/主流程/触发时机同构;
 *  差异(calcX、触发阶段、置顶张数约束、界面文案、界版「全置底再触发」附加段)经参数注入。 */
export function createGuanxingSkill(opts: GuanxingOptions) {
  const confirmRt = `${opts.skillId}/confirm`;
  const arrangeRt = `${opts.skillId}/arrange`;
  const varsId = opts.varsPrefix ?? opts.skillId;
  const confirmedKey = `${varsId}/confirmed`;
  const arrangeKey = `${varsId}/arrangement`;
  const allBottomKey = `${varsId}/全置底`;
  const phase = opts.phase ?? '准备';

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
      description:
        typeof opts.confirmDescription === 'function'
          ? opts.confirmDescription(drawCount)
          : opts.confirmDescription,
      confirmLabel: '发动',
      cancelLabel: '不发动',
      defaultChoice: false,
      timeout: 15,
    });
    if (!confirmed) return false;

    // 置顶张数约束(恂恂):top 须恰好 min(requiredTop, X) 张;观星族任意 0..X 张
    const requiredTop =
      opts.requiredTop !== undefined ? Math.min(opts.requiredTop, drawCount) : undefined;

    // 观察牌堆顶 drawCount 张(deck 末尾为顶)
    const observed = deck.slice(-drawCount);

    // 询问排列
    delete state.localVars[arrangeKey];
    const arrangeDescription =
      opts.arrangeDescription === undefined
        ? '选择留在牌堆顶的牌(顺序即摸牌顺序)与置于牌堆底的牌'
        : opts.arrangeDescription;
    await applyAtom(state, {
      type: '请求回应',
      requestType: arrangeRt,
      target: ownerId,
      prompt: {
        type: 'distribute',
        title:
          typeof opts.arrangeTitle === 'function' ? opts.arrangeTitle(drawCount) : opts.arrangeTitle,
        ...(arrangeDescription !== null ? { description: arrangeDescription } : {}),
        mode: 'select',
        cardIds: observed,
        minTotal: requiredTop ?? 0,
        maxTotal: requiredTop ?? drawCount,
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
    // (带 requiredTop 时 respond 已拒非法划分,此处兜底同校验 top 张数)
    const observedSet = new Set(observed);
    const combined = [...top, ...bottom];
    const valid =
      (requiredTop === undefined || top.length === requiredTop) &&
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
      // requestType 读取走 currentRequestType(带 requiredTop 的划分校验另行反射
      // pendingSlots 读 prompt.cardIds,见下)。
      registerAction(
        state,
        skill.id,
        ownerId,
        'respond',
        (state, params) => {
          const check = requireRequestType(state, ownerId, [confirmRt, arrangeRt], {
            mismatchError: `当前不是${varsId}询问`,
          });
          if (check.error) return check.error;
          if (check.requestType === arrangeRt) {
            // arrange 必须提供 top/bottom 划分
            if (!Array.isArray(params.top) || !Array.isArray(params.bottom)) {
              return `${varsId}:需要 top/bottom 划分`;
            }
            // 带 requiredTop 时(恂恂)respond 即拒非法划分:完整、无重复、在观察范围内、
            // top 张数恰好。观察范围读自 arrange atom 的 prompt.cardIds(观察到的牌,
            // 非 requestType,故此处保留 pendingSlots 手写反射)。
            if (opts.requiredTop !== undefined) {
              const arrangeAtom = state.pendingSlots.get(ownerId)!.atom as {
                prompt?: { cardIds?: string[] };
              };
              const observed: string[] = arrangeAtom.prompt?.cardIds ?? [];
              const observedSet = new Set(observed);
              const top = params.top as string[];
              const bottom = params.bottom as string[];
              const combined = [...top, ...bottom];
              if (combined.length !== observed.length) return `${varsId}:必须划分全部观察的牌`;
              const requiredTop = Math.min(opts.requiredTop, observed.length);
              if (top.length !== requiredTop) return `${varsId}:须将 ${requiredTop} 张置于牌堆顶`;
              const seen = new Set<string>();
              for (const cid of combined) {
                if (!observedSet.has(cid)) return `${varsId}:牌不在观察范围内`;
                if (seen.has(cid)) return `${varsId}:存在重复的牌`;
                seen.add(cid);
              }
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

      // 阶段开始 after-hook:按 phase 分支(观星族 准备 / 恂恂 摸牌 = 主入口;
      // 界版 回合结束 = 再次发动)
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
        if (atom.phase !== phase) return;

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

    onMount: makeConfirmMount('respond', {
      label: opts.name,
      title: `是否发动${opts.name}?`,
      style: 'default',
    }),
  };
}
