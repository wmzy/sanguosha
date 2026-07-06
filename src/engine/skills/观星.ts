// 观星(诸葛亮·主动技):准备阶段开始时,你可以观看牌堆顶的 X 张牌
// (X 为全场角色数且至多为 5),改变其中任意数量牌的顺序置于牌堆顶,
// 其余的牌置于牌堆底。
//
// 触发时机:阶段开始(准备) after-hook(参考洛神)。
// 流程:
//   1. X = min(全场角色数 state.players.length, 5)
//   2. 取牌堆顶 X 张(deck 末尾为顶,与 摸牌 atom 一致)
//   3. 询问是否发动(请求回应 观星/confirm)
//   4. 发动 → 询问排列(请求回应 观星/arrange),玩家回应 { top:[...], bottom:[...] }
//      - top:留在牌堆顶的牌(玩家指定顺序,top[0]=最先摸到的牌=牌堆顶)
//      - bottom:置于牌堆底的牌
//   5. 构建新牌堆 newDeck,applyAtom(整理牌堆)
//
// 牌堆方向约定(与 摸牌 atom 一致):摸牌 取 deck.slice(-count),
// 故 deck[0]=牌堆底(最后摸),deck[len-1]=牌堆顶(最先摸)。
// newDeck 构造:[...bottom, ...middle, ...top.reverse()]
//   - bottom 放最底;middle 是观察范围之外的牌(原 deck 去掉顶 X 张);
//   - top 倒序后追加到末尾,使 top[0] 落到 deck[len-1]=最先摸。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '观星',
    description: '准备阶段开始时,观看牌堆顶X张牌(X为全场角色数至多5),调整顺序,余者置牌堆底',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理 观星/confirm 与 观星/arrange 两种询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state, params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot || slot.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (slot.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '观星/confirm' && requestType !== '观星/arrange') {
        return '当前不是观星询问';
      }
      if (requestType === '观星/arrange') {
        // arrange 必须提供 top/bottom 划分
        if (!Array.isArray(params.top) || !Array.isArray(params.bottom)) {
          return '观星:需要 top/bottom 划分';
        }
      }
      return null;
    },
    async (state, params) => {
      const slot = state.pendingSlots.get(ownerId);
      const requestType = (slot?.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType === '观星/confirm') {
        state.localVars['观星/confirmed'] = params.choice === true || params.confirmed === true;
      } else if (requestType === '观星/arrange') {
        state.localVars['观星/arrangement'] = {
          top: (params.top as string[]) ?? [],
          bottom: (params.bottom as string[]) ?? [],
        };
      }
    },
  );

  // 阶段开始(准备) after-hook:观星主流程
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type: string; player: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '准备') return;
    if (!ctx.state.players[ownerId]?.alive) return;

    const deck = ctx.state.zones.deck;
    if (deck.length === 0) return; // 牌堆空:无法观星

    // X = 全场角色数(含已阵亡,非存活角色数),至多 5
    const x = Math.min(ctx.state.players.length, 5);
    const drawCount = Math.min(x, deck.length);
    if (drawCount === 0) return;

    // 询问是否发动
    delete ctx.state.localVars['观星/confirmed'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '观星/confirm',
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动观星?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars['观星/confirmed']) return;

    // 观察牌堆顶 drawCount 张(deck 末尾为顶)
    const observed = deck.slice(-drawCount);

    // 询问排列
    delete ctx.state.localVars['观星/arrangement'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '观星/arrange',
      target: ownerId,
      prompt: {
        type: 'distribute',
        title: '观星：排列牌堆顶牌',
        description: '选择留在牌堆顶的牌(顺序即摸牌顺序)与置于牌堆底的牌',
        mode: 'select',
        cardIds: observed,
        minTotal: 0,
        maxTotal: drawCount,
      },
      defaultChoice: false,
      timeout: 30,
    });

    const arrangement = ctx.state.localVars['观星/arrangement'] as
      | { top: string[]; bottom: string[] }
      | undefined;
    delete ctx.state.localVars['观星/arrangement'];
    delete ctx.state.localVars['观星/confirmed'];

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
      return;
    }

    // 构建新牌堆:bottom 置底 → middle(未观察)→ top 倒序置顶(使 top[0] 最先摸)
    const middle = deck.slice(0, deck.length - drawCount);
    const newDeck = [...bottom, ...middle, ...[...top].reverse()];

    await applyAtom(ctx.state, { type: '整理牌堆', cards: newDeck });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '观星',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动观星?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount };
