// 五谷丰登(普通锦囊):出牌阶段对所有存活角色使用。
//   流程:
//     1. 从牌堆顶翻 X 张到处理区亮出(X = 存活玩家数)
//     2. 从使用者开始,按座次顺序,每名目标:
//        a) 在该目标选牌前询问一次无懈可击(无懈抵消该目标的选牌效果)
//        b) 未被抵消 → 该目标从处理区选 1 张到手牌
//     3. 剩余牌置入弃牌堆
//
// 实现要点:
//   - 亮牌用 `移动牌`(逐张 牌堆→处理区),不用 `摸牌`(会直接进手牌)
//   - 无懈询问发生在亮牌之后、选牌之前(每个目标轮到自己时才问)
//   - 选牌用 `请求回应`(prompt: pickProcessingCard),候选是处理区明牌
//   - respond action 接受 cardId,校验在处理区,移牌到手牌
//   - 超时兜底:选第一张处理区牌(不放弃选牌机会)
import type { FrontendAPI, GameState, Json, Skill, Card } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, type SkillModule, validateUseCard } from '../skill';
import { askWuxie } from '../wuxie';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '五谷丰登', description: '锦囊:从牌堆亮出N张,全体依次选1张' };
}

/** 取当前存活玩家列表,从使用者开始按座次旋转(与南蛮入侵一致) */
function alivePlayersFrom(state: GameState, from: number): number[] {
  const alive = state.players.filter(p => p.alive);
  const n = alive.length;
  if (n === 0) return [];
  const fromPos = alive.findIndex(p => p.index === from);
  if (fromPos < 0) return alive.map(p => p.index);
  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    result.push(alive[(fromPos + i) % n].index);
  }
  return result;
}

/** 选牌面板:弹 pickProcessingCard pending,超时兜底选候选列表第一张。
 *  候选列表(revealedIds)是亮出的牌,不含五谷丰登锦囊本身(它也在处理区)。 */
async function runPickProcessingCard(
  state: GameState,
  target: number,
  revealedIds: string[],
): Promise<void> {
  // 候选 = 仍在处理区的亮出牌(已被选走的剔除)
  const available = revealedIds.filter(id => state.zones.processing.includes(id));
  if (available.length === 0) return;

  const cards = available
    .map(id => {
      const c = state.cardMap[id];
      if (!c) return null;
      return { cardId: id, cardName: c.name, suit: c.suit, rank: c.rank };
    })
    .filter((c): c is { cardId: string; cardName: string; suit: Card['suit']; rank: string } => c !== null);

  await applyAtom(state, {
    type: '请求回应',
    requestType: '五谷丰登/select',
    target,
    prompt: {
      type: 'pickProcessingCard',
      title: '五谷丰登:选择 1 张牌',
      cards,
    },
    timeout: 20,
  });

  // 读取该目标的选择(超时兜底:候选列表第一张)
  const pickedId = state.localVars['五谷丰登/选择'] as string | undefined;
  delete state.localVars['五谷丰登/选择'];
  const stillAvailable = revealedIds.filter(id => state.zones.processing.includes(id));
  const cardId = pickedId && stillAvailable.includes(pickedId)
    ? pickedId
    : stillAvailable[0];
  if (cardId) {
    await applyAtom(state, {
      type: '移动牌',
      cardId,
      from: { zone: '处理区' },
      to: { zone: '手牌', player: target },
    });
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // ── use:主动打出五谷丰登 ──
  registerAction(skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      return validateUseCard(state, ownerId, params, { cardName: '五谷丰登' });
    }, async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      pushFrame(state, '五谷丰登', from, { ...params });
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });

      try {
        // 1. 先翻 X 张到处理区(X = 存活玩家数)
        const allTargets = alivePlayersFrom(state, from);
        const cardCount = allTargets.length;
        const revealedIds: string[] = [];
        for (let i = 0; i < cardCount; i++) {
          if (state.zones.deck.length === 0) break;
          const topId = state.zones.deck.shift()!;
          state.zones.processing.push(topId);
          revealedIds.push(topId);
        }

        // 2. 从使用者开始按座次,每名目标轮到时先问无懈,未抵消才选牌
        for (const targetIdx of allTargets) {
          if (!state.players[targetIdx]?.alive) continue;
          if (revealedIds.some(id => state.zones.processing.includes(id)) === false) break;

          // 该目标选牌前询问一次无懈(被抵消 → 该目标不参与选牌)
          const cancelled = await askWuxie(state, targetIdx);
          if (cancelled) continue;

          if (revealedIds.some(id => state.zones.processing.includes(id)) === false) break;
          await runPickProcessingCard(state, targetIdx, revealedIds);
        }

        // 3. 剩余亮出的牌进弃牌堆
        const leftover = [...state.zones.processing];
        for (const id of leftover) {
          await applyAtom(state, { type: '移动牌', cardId: id, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        }
        // 原锦囊卡进弃牌堆
        await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      } finally {
        if (state.zones.processing.includes(cardId)) {
          await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
        }
        delete state.localVars['五谷丰登/选择'];
        popFrame(state);
      }
    });

  // ── respond:玩家选1张牌(从处理区亮的牌中) ──
  registerAction(skill.id, ownerId, 'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是五谷丰登选牌窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType !== '五谷丰登/select') return '当前不是五谷丰登选牌窗口';
      const cardId = params.cardId as string | undefined;
      if (!cardId) return 'cardId required';
      if (!state.zones.processing.includes(cardId)) return '该牌不在可选范围';
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      state.localVars['五谷丰登/选择'] = cardId;
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('use', {
    label: '五谷丰登',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '五谷丰登',
      cardFilter: { filter: (c) => c.name === '五谷丰登', min: 1, max: 1 },
    },
  });
  api.defineAction('respond', {
    label: '五谷丰登',
    style: 'primary',
    prompt: {
      type: 'pickProcessingCard',
      title: '五谷丰登:选1张牌',
      cards: [],
    },
  });
}

const skillModule: SkillModule = { createSkill, onInit, onMount };
export default skillModule;
