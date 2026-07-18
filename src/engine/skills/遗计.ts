// 遗计(郭嘉·被动技,官方 hero/101 逐字):
//   "当你受到 1 点伤害后,你可以观看牌堆顶的两张牌,
//    然后将这些牌交给任意角色。"(每 1 点伤害触发一次)
//
// 关键实现要点:
//   - **牌不入手**:与"摸两张入手机制"不同,官方要求"观看"——
//     引擎通过 peek(读牌堆顶两张)+ 逐张摸给目标的方式实现:
//     郭嘉手牌状态全程不变,牌从牌堆顶直接经"摸牌 atom"流向目标手牌。
//   - **分配粒度**:可将两张牌拆分给不同角色(每名至少 1 张),
//     也可全给同一角色(含郭嘉自己)。
//   - **顺序处理**:由于摸牌 atom 总从牌堆顶抽,必须按 top→secondFromTop
//     顺序逐张摸给目标;validate 已强制两张牌全部分配,顺序处理必精确命中。
//   - **可选**:玩家可 pass(空 allocation)放弃发动,牌留在牌堆顶。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const DISTRIBUTE_RT = '遗计/distribute';
const ALLOC_KEY = '遗计/allocation';

type Allocation = Array<{ target: number; cardIds: string[] }>;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '遗计',
    description: '受到 1 点伤害后,观看牌堆顶的两张牌,然后将这些牌交给任意角色',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理遗计分配询问。allocation 可为空(放弃发动);非空需覆盖牌堆顶两张。
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type: string; requestType?: string };
      if (atom.type !== '请求回应' || atom.requestType !== DISTRIBUTE_RT) {
        return '当前不是遗计分配';
      }
      const allocation = params.allocation as Allocation | undefined;
      if (Array.isArray(allocation) && allocation.length > 0) {
        const deck = st.zones.deck;
        const top2 = new Set([deck[deck.length - 1], deck[deck.length - 2]]);
        const seen = new Set<string>();
        for (const entry of allocation) {
          if (!st.players[entry.target]?.alive) return '目标无效';
          for (const cid of entry.cardIds) {
            if (!top2.has(cid)) return '牌不在可分配范围';
            if (seen.has(cid)) return '存在重复的牌';
            seen.add(cid);
          }
        }
        // 官方规则:发动遗计须将两张牌全部交出(可分配给自己)
        if (seen.size !== top2.size) return '必须分配全部两张牌';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      st.localVars[ALLOC_KEY] = params.allocation ?? null;
    },
  );

  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    if ((ctx.atom as { target?: number }).target !== ownerId) return;
    const amount = (ctx.atom as { amount?: number }).amount ?? 0;
    if (amount <= 0) return;

    // 每 1 点伤害触发一次遗计
    for (let i = 0; i < amount; i++) {
      if (!ctx.state.players[ownerId]?.alive) break;
      // 官方规则:观看牌堆顶 2 张牌(牌不入手)。牌堆不足 2 张则跳过。
      if (ctx.state.zones.deck.length < 2) break;

      // peek 牌堆顶 2 张(deck 末尾为顶,逆序成 [top, secondFromTop])
      const deck = ctx.state.zones.deck;
      const top2: string[] = [deck[deck.length - 1], deck[deck.length - 2]];

      // 询问分配(cardIds 让郭嘉看见牌面,但牌不入郭嘉手牌)
      delete ctx.state.localVars[ALLOC_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: DISTRIBUTE_RT,
        target: ownerId,
        prompt: {
          type: 'distribute',
          title: '遗计:观看牌堆顶两张牌并分配',
          cardIds: top2,
          minPerTarget: 1,
          maxPerTarget: 2,
        },
        timeout: 30,
      });

      const distribution = ctx.state.localVars[ALLOC_KEY] as Allocation | null;
      if (Array.isArray(distribution)) {
        // 建立 cardId → target 映射
        const cardToTarget = new Map<string, number>();
        for (const entry of distribution) {
          if (!ctx.state.players[entry.target]?.alive) continue;
          for (const cardId of entry.cardIds) {
            cardToTarget.set(cardId, entry.target);
          }
        }

        // 按牌堆顶顺序处理(top 先):摸牌 atom 总从牌堆顶抽。
        // validate 已确保两张牌全部分配,故每张 top2 都有目标,顺序摸牌必精确命中。
        // 全程不写入郭嘉手牌,实现官方"观看后分配"语义。
        for (const cardId of top2) {
          const target = cardToTarget.get(cardId);
          if (typeof target === 'number') {
            await applyAtom(ctx.state, { type: '摸牌', player: target, count: 1 });
          }
        }
      }
      delete ctx.state.localVars[ALLOC_KEY];
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '遗计',
    style: 'primary',
    prompt: {
      type: 'distribute',
      title: '遗计:观看牌堆顶两张牌并分配',
      minPerTarget: 1,
      maxPerTarget: 2,
    },
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
