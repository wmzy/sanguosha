// 界恂恂(界李典·主动技,OL 界限突破官方逐字):
//   "摸牌阶段开始时,你可以观看牌堆顶的四张牌,
//    然后将其中两张牌置于牌堆顶,将剩余牌置于牌堆底。"
//
// 实现要点(参考观星 src/engine/skills/观星.ts):
//   - 触发时机:阶段开始(摸牌) after-hook(player===ownerId)。
//     阶段开始 atom 仅更新 state.phase;随后引擎另行执行实际摸牌(摸牌 atom)。
//     after-hook 在 phase 切换后、实际摸牌前执行,故重排可影响本次摸牌。
//   - X = 4(固定),牌堆不足时仅观看可用张数;牌堆空则跳过。
//   - 询问是否发动(confirm);发动后询问排列(distribute select mode)。
//   - 玩家回应 { top: [...], bottom: [...] } —— top/bottom 为观察范围的无重复划分;
//     top 顺序即摸牌顺序(top[0] 最先摸)。超时或非法划分时保持原序,不调整牌堆。
//   - 牌堆方向约定(与 摸牌 atom 一致):deck[0]=牌堆底(最后摸),deck[len-1]=牌堆顶(最先摸)。
//     newDeck = [...bottom, ...middle, ...top.reverse()]
//       - bottom 放最底;middle 为观察范围之外的牌(原 deck 去掉顶 X 张);
//       - top 倒序后追加到末尾,使 top[0] 落到 deck[len-1]=最先摸。
//
// 命名:文件名/loader key/character skill name 均为 '界恂恂'(避开未来标版 '恂恂' 冲突);
//   内部 Skill.name = '恂恂'(OL 官方技能名,玩家可见)。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界恂恂';
const DISPLAY_NAME = '恂恂';
const CONFIRM_RT = '恂恂/confirm';
const ARRANGE_RT = '恂恂/arrange';
const CONFIRMED_KEY = '恂恂/confirmed';
const ARRANGE_KEY = '恂恂/arrangement';

/** 观看牌堆顶的固定张数(OL 官方) */
const REVEAL_COUNT = 4;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '摸牌阶段开始时,观看牌堆顶4张牌,将其中2张置于牌堆顶,其余置于牌堆底',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理 恂恂/confirm 与 恂恂/arrange 两种询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as unknown as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== CONFIRM_RT && rt !== ARRANGE_RT) return '当前不是恂恂询问';

      if (rt === ARRANGE_RT) {
        // arrange 必须提供 top/bottom 划分,且为观察范围的无重复完整划分
        if (!Array.isArray(params.top) || !Array.isArray(params.bottom)) {
          return '恂恂:需要 top/bottom 划分';
        }
        const arrangeAtom = atom as { prompt?: { cardIds?: string[] } };
        const observed: string[] = arrangeAtom.prompt?.cardIds ?? [];
        const observedSet = new Set(observed);
        const top = params.top as string[];
        const bottom = params.bottom as string[];
        const combined = [...top, ...bottom];
        if (combined.length !== observed.length) return '恂恂:必须划分全部观察的牌';
        const seen = new Set<string>();
        for (const cid of combined) {
          if (!observedSet.has(cid)) return '恂恂:牌不在观察范围内';
          if (seen.has(cid)) return '恂恂:存在重复的牌';
          seen.add(cid);
        }
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as Record<string, unknown>)?.requestType as string;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === ARRANGE_RT) {
        st.localVars[ARRANGE_KEY] = {
          top: (params.top as string[]) ?? [],
          bottom: (params.bottom as string[]) ?? [],
        };
      }
    },
  );

  // 阶段开始(摸牌) after-hook:恂恂主流程
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type: string; player: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '摸牌') return;
    if (!ctx.state.players[ownerId]?.alive) return;

    const deck = ctx.state.zones.deck;
    if (deck.length === 0) return; // 牌堆空:无法观看

    const drawCount = Math.min(REVEAL_COUNT, deck.length);
    if (drawCount === 0) return;

    // 询问是否发动
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动恂恂?',
        description: `观看牌堆顶 ${drawCount} 张牌,选择置顶与置底`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) {
      delete ctx.state.localVars[CONFIRMED_KEY];
      return;
    }

    // 观察牌堆顶 drawCount 张(deck 末尾为顶,与 摸牌 atom 一致)
    const observed = deck.slice(-drawCount);

    // 询问排列
    delete ctx.state.localVars[ARRANGE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: ARRANGE_RT,
      target: ownerId,
      prompt: {
        type: 'distribute',
        mode: 'select',
        title: '恂恂:选择置于牌堆顶的牌(顺序即摸牌顺序),其余置于牌堆底',
        cardIds: observed,
        minTotal: 0,
        maxTotal: drawCount,
      },
      defaultChoice: false,
      timeout: 30,
    });

    const arrangement = ctx.state.localVars[ARRANGE_KEY] as
      | { top: string[]; bottom: string[] }
      | undefined;
    delete ctx.state.localVars[ARRANGE_KEY];
    delete ctx.state.localVars[CONFIRMED_KEY];

    const top = arrangement?.top ?? [];
    const bottom = arrangement?.bottom ?? [];

    // 保险:再校验一次划分合法性(同 respond validate)
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

    await applyAtom(ctx.state, {
      type: '整理牌堆',
      cards: newDeck,
      topCount: top.length,
      bottomCount: bottom.length,
    });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动恂恂?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
