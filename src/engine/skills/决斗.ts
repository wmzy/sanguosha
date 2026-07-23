// 决斗:结算核心 helper（被 离间/界利驭/界势斩/界翦灭 等视为使用决斗的技能复用）。
//
// 决斗牌本身的使用（use action + resolve）已迁移到 card-effects/决斗.ts。
// 本文件仅保留 runDuelResolution——它包含"成为目标"+"无懈"+"决斗循环"，
// 供"视为使用决斗"（无实体牌）的技能调用。正常使用决斗牌走 CardEffect.resolve（不含成为目标）。
import type { GameState } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { 询问无懈可击 } from '../无懈可击';
import { enforceDualKill } from './无双';

/**
 * 决斗结算核心(可复用):A 视为对 B 使用决斗,双方轮流出杀,输者受 1 点伤害。
 *
 * 不处理决斗牌本身的移动(进出处理区)——由调用方负责。
 * 离间(貂蝉)调用此函数时无需 cardId(视为使用,无实体牌)。
 *
 * @param state              游戏状态
 * @param from               决斗发起者(出杀顺序中后手)
 * @param target             决斗目标(出杀顺序中先手)
 * @param cardId             决斗牌 id(用于 成为目标/造成伤害 归因);离间调用时可省略
 * @param skipNullification  跳过无懈可击询问(离间:官方明确不能被无懈可击抵消)
 */
export async function runDuelResolution(
  state: GameState,
  from: number,
  target: number,
  cardId?: string,
  skipNullification: boolean = false,
): Promise<void> {
  // 成为目标:空城等"不能成为目标"技能可在此 cancel(决斗不结算)。
  const becameTarget = await applyAtom(state, {
    type: '成为目标',
    source: from,
    target,
    cardId,
  });
  if (!becameTarget) return;

  // 询问无懈可击(单目标锦囊:抵消整个锦囊)
  // 离间(貂蝉)按官方"不能被【无懈可击】抵消",跳过此步。
  if (!skipNullification) {
    const cancelled = await 询问无懈可击(state, target);
    if (cancelled) return;
  }

  // 决斗循环:目标先出杀,之后发起者出杀,轮流。
  // 上限保护:极端情况下(武圣/丈八 把任意牌当杀)可能无限循环;
  // 现实中手牌+牌堆不可能产出这么多杀,100 轮远超正常上限。
  const MAX_ROUNDS = 100;
  let turn = 0; // 0=目标, 1=发起者
  let loser: number | null = null;
  let rounds = 0;
  while (loser === null) {
    if (rounds++ >= MAX_ROUNDS) {
      loser = turn === 0 ? target : from;
      break;
    }
    const current = turn === 0 ? target : from;
    await applyAtom(state, {
      type: '询问杀',
      target: current,
      source: turn === 0 ? from : target,
    });
    // 无双(吕布锁定技):与你决斗的角色每次需连续打出两张杀。
    await enforceDualKill(state, turn === 0 ? from : target, current);
    // 检查处理区:有杀牌 = 出了杀,移走它;没有 = 没出,输
    const killCardId = frameCards(state).find((id) => {
      const c = state.cardMap[id];
      return c?.name === '杀';
    });
    if (killCardId) {
      // 出了杀:移到弃牌堆,切换轮次
      await applyAtom(state, {
        type: '移动牌',
        cardId: killCardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
      turn = turn === 0 ? 1 : 0;
    } else {
      loser = current;
    }
  }
  const winner = loser === target ? from : target;
  await applyAtom(state, {
    type: '造成伤害',
    target: loser,
    amount: 1,
    source: winner,
    cardId,
  });
}
