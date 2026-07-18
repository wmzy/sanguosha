// 界观星(界诸葛亮·蜀·主动技,OL hero/442 逐字):
//   "准备阶段,你可以观看牌堆顶的五张牌(存活角色数小于4时改为三张),
//    然后将之以任意顺序置于牌堆顶或牌堆底。若皆置于牌堆底,
//    结束阶段你可以再次发动本技能。"
//
// 与标观星(src/engine/skills/观星.ts)区别(OL 界限突破差异):
//   1. **X 计算**:标版 X = min(全场角色数含阵亡, 5);界版 X = (存活角色数 < 4) ? 3 : 5。
//      即存活角色数 < 4 时降为 3 张(2~3 人残局仍可观 3 张),>=4 时仍为 5。
//   2. **全置底再触发**:若准备阶段所有观察牌皆置于牌堆底,结束阶段可再次发动本技能一次。
//      标版无此机制。一次性的"再次发动"机会,结束阶段消费后失效(不再级联)。
//
// 独立界版技能文件,不修改标观星。
// 触发时机:阶段开始(准备 或 回合结束)after-hook —— 单 hook 内按 phase 分支。
//   - phase='准备':主入口;若返回"全置底",设 localVars 标志供结束阶段消费。
//   - phase='回合结束'(= 结束阶段):若标志存在,再次发动(消费并清除标志)。
//
// 牌堆方向约定(与 摸牌 atom 一致):摸牌 取 deck.slice(-count),
// 故 deck[0]=牌堆底(最后摸),deck[len-1]=牌堆顶(最先摸)。
// newDeck 构造:[...bottom, ...middle, ...top.reverse()]
//   - bottom 放最底;middle 是观察范围之外的牌(原 deck 去掉顶 X 张);
//   - top 倒序后追加到末尾,使 top[0] 落到 deck[len-1]=最先摸。
import type { AtomAfterContext, FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

/** localVars 键:准备阶段全置底 → 结束阶段再次发动(一次性) */
const ALL_BOTTOM_FLAG = '界观星/全置底';
/** localVars 键:玩家确认发动 */
const CONFIRMED_VAR = '界观星/confirmed';
/** localVars 键:玩家提供的 top/bottom 划分 */
const ARRANGE_VAR = '界观星/arrangement';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界观星',
    description:
      '准备阶段,观看牌堆顶 5 张(存活角色数<4 时为 3 张),任意排序置顶/置底;若皆置底,结束阶段可再次发动',
  };
}

/**
 * 计算本次观星的观察张数 X(界版规则):
 *   - 存活角色数 < 4 → X = 3(2~3 人残局仍可观 3 张)
 *   - 存活角色数 ≥ 4 → X = 5
 */
function calcX(state: GameState): number {
  const aliveCount = state.players.filter((p) => p.alive).length;
  return aliveCount < 4 ? 3 : 5;
}

/**
 * 观星主流程:询问是否发动 → 询问排列 → 构建新牌堆 → 整理牌堆。
 * @returns 是否"皆置于牌堆底"(满足结束阶段再次发动条件);未发动/非法划分时返回 false。
 */
async function doGuanxing(state: GameState, ownerId: number): Promise<boolean> {
  const deck = state.zones.deck;
  if (deck.length === 0) return false; // 牌堆空:无法观星

  const x = calcX(state);
  const drawCount = Math.min(x, deck.length);
  if (drawCount === 0) return false;

  // 询问是否发动
  delete state.localVars[CONFIRMED_VAR];
  await applyAtom(state, {
    type: '请求回应',
    requestType: '界观星/confirm',
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '是否发动界观星?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
    defaultChoice: false,
    timeout: 15,
  });
  if (!state.localVars[CONFIRMED_VAR]) return false;

  // 观察牌堆顶 drawCount 张(deck 末尾为顶)
  const observed = deck.slice(-drawCount);

  // 询问排列
  delete state.localVars[ARRANGE_VAR];
  await applyAtom(state, {
    type: '请求回应',
    requestType: '界观星/arrange',
    target: ownerId,
    prompt: {
      type: 'distribute',
      title: '界观星:排列牌堆顶牌',
      description: '选择留在牌堆顶的牌(顺序即摸牌顺序)与置于牌堆底的牌',
      mode: 'select',
      cardIds: observed,
      minTotal: 0,
      maxTotal: drawCount,
    },
    defaultChoice: false,
    timeout: 30,
  });

  const arrangement = state.localVars[ARRANGE_VAR] as
    | { top: string[]; bottom: string[] }
    | undefined;
  delete state.localVars[ARRANGE_VAR];
  delete state.localVars[CONFIRMED_VAR];

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

  // 全置底判定:top 为空即"皆置于牌堆底"
  return top.length === 0;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理 界观星/confirm 与 界观星/arrange 两种询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state, params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (slot.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '界观星/confirm' && requestType !== '界观星/arrange') {
        return '当前不是界观星询问';
      }
      if (requestType === '界观星/arrange') {
        // arrange 必须提供 top/bottom 划分
        if (!Array.isArray(params.top) || !Array.isArray(params.bottom)) {
          return '界观星:需要 top/bottom 划分';
        }
      }
      return null;
    },
    async (state, params) => {
      const slot = state.pendingSlots.get(ownerId);
      const requestType = (slot?.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType === '界观星/confirm') {
        state.localVars[CONFIRMED_VAR] = params.choice === true || params.confirmed === true;
      } else if (requestType === '界观星/arrange') {
        state.localVars[ARRANGE_VAR] = {
          top: params.top ?? [],
          bottom: params.bottom ?? [],
        };
      }
    },
  );

  // 阶段开始 after-hook:按 phase 分支(准备=主入口,回合结束=再次发动)
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type: string; player: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (!ctx.state.players[ownerId]?.alive) return;

    if (atom.phase === '准备') {
      // 准备阶段:首次发动;若全置底,设标志供结束阶段再次发动
      delete ctx.state.localVars[ALL_BOTTOM_FLAG];
      const allBottom = await doGuanxing(ctx.state, ownerId);
      if (allBottom) {
        ctx.state.localVars[ALL_BOTTOM_FLAG] = true;
      }
    } else if (atom.phase === '回合结束') {
      // 结束阶段(=phase '回合结束'):若"全置底"标志存在 → 再次发动(消费并清除,不再级联)
      if (!ctx.state.localVars[ALL_BOTTOM_FLAG]) return;
      delete ctx.state.localVars[ALL_BOTTOM_FLAG];
      await doGuanxing(ctx.state, ownerId);
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界观星',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动界观星?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
