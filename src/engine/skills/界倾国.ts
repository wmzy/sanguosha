// 界倾国(界甄姬·转化技):你可以将一张黑色手牌当【闪】使用或打出。
//
// 官方来源(逐字):"你可以将一张黑色手牌当【闪】使用或打出。"
// 界版与标版倾国效果一致(均限"黑色手牌");独立界文件以与标版互斥不共存。
//
// 模型(组合 action,与武圣对称):前端两步 UI(点倾国给黑牌加"闪"显示 → 点出闪),
// 提交时一个 ClientMessage:preceding=[界倾国.transform] + 主 action=闪.respond。
// 后端 dispatch 先执行 界倾国.transform(创建影子闪),再 闪.respond validate 看到"闪"通过。
// 闪技能零感知倾国——它看到的永远是 cardMap 里的一张"闪"。
import type { Card, GameState, Json, Skill, FrontendAPI } from '../types';
import { registerAction } from '../skill';
import { applyAtom } from '../create-engine';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界倾国',
    description: '你可以将一张黑色手牌当【闪】使用或打出',
  };
}

/** 影子卡 id:${原id}#倾国 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#倾国`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把黑色手牌转化为影子"闪"(新建 Card 实体,shadowOf 指向原卡)。
  // 作为 preceding 在 闪.respond 之前执行。闪.validate 读 cardMap[影子id] 看到"闪"。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:存活 + 手牌 + 黑牌。
      // 不限定回合/阶段:倾国用于"需要打出闪时"(被杀目标时),不是自己回合主动出。
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const isBlack = !!card && card.color === '黑';
      const ok = selfAlive && cardInHand && isBlack;
      return ok ? null : '现在不能使用倾国';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      // 通过 atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '闪',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,手牌还原)
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      delete state.cardMap[sId];
      const self = state.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:倾国是转化技,defineAction 声明黑牌。
  // 前端 UI 流程:被询问闪时 → 选黑牌 → 点倾国按钮 → 提交 preceding=[界倾国.transform] + 主 action=闪.respond。
  api.defineAction('transform', {
    label: '界倾国',
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择一张黑色手牌当闪打出',
      cardFilter: { filter: (c: Card) => c.color === '黑', min: 1, max: 1 },
    },
    transform: (card: Card) => ({ name: '闪', sourceCardId: card.id, fromSkill: skill.id }),
    // 倾国只在被询问闪时激活(不依赖自己回合)
    activeWhen: (ctx) => {
      const slot = ctx.view.pending;
      if (!slot) return false;
      if ((slot.atom as { type: string }).type !== '询问闪') return false;
      if (slot.target !== ctx.perspectiveIdx) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 手中有黑色牌才能发动
      const hasBlack = p.hand?.some((c) => c.color === '黑') ?? false;
      return hasBlack;
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
