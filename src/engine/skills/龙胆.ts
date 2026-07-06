// 龙胆(赵云·转化技):你可以将一张【杀】当【闪】使用或打出,或将一张【闪】当【杀】使用或打出。
//
// 模型(组合 action,武圣+倾国双向):一个 'transform' action 带 `to` 参数('闪'|'杀')。
//   - 杀当闪:preceding=[龙胆.transform{to:'闪'}] + 主 action=闪.respond(被询问闪时,防御向)
//   - 闪当杀:preceding=[龙胆.transform{to:'杀'}] + 主 action=杀.use(自己回合)/杀.respond(决斗/南蛮)
// 后端 dispatch 先执行 龙胆.transform(创建影子卡),再 闪/杀 的 validate 读 cardMap[影子id] 通过。
// 闪/杀 零感知龙胆——它们看到的永远是 cardMap 里的一张"闪"/"杀"。
// transform validate 不限定回合/阶段:杀当闪是防御向(非自己回合),闪当杀的回合/次数由 杀.use/respond 校验。
import type { Card, GameView, GameState, Json, Skill, FrontendAPI } from '../types';
import { registerAction } from '../skill';
import { applyAtom } from '../create-engine';
import { viewCanSlash, defaultPlayActive } from '../action-active';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '龙胆',
    description: '你可以将一张【杀】当【闪】使用或打出,或将一张【闪】当【杀】使用或打出',
  };
}

/** 影子卡 id:${原id}#龙胆(单卡转化,同一张牌只可能转一个方向) */
function shadowIdOf(cardId: string): string {
  return `${cardId}#龙胆`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把一张手牌(杀/闪)转化为影子"闪"/"杀"。
  // params.to 决定转化方向与产出牌名。作为 preceding 在 闪.respond / 杀.use / 杀.respond 之前执行。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      const self = state.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardId = params.cardId as string;
      const to = params.to as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      if (!selfAlive) return '你已死亡';
      if (!cardIdOk || !cardInHand) return '牌不在手牌中';
      if (to === '闪') {
        if (card?.name !== '杀') return '只能将杀当闪';
      } else if (to === '杀') {
        if (card?.name !== '闪') return '只能将闪当杀';
      } else {
        return '无效的转化方向';
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const to = params.to as string;
      const shadowId = shadowIdOf(cardId);
      // 通过 atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: to,
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
  // 前端:龙胆是双向转化技,defineAction 声明杀/闪。
  // 前端 UI 流程:
  //   - 自己回合(出杀):选闪 → 点龙胆 → 提交 preceding=[龙胆.transform{to:'杀'}] + 主 action=杀.use
  //   - 被询问闪(防御):选杀 → 点龙胆 → 提交 preceding=[龙胆.transform{to:'闪'}] + 主 action=闪.respond
  api.defineAction('transform', {
    label: '龙胆',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张杀或闪转化',
      cardFilter: { filter: (c: Card) => c.name === '杀' || c.name === '闪', min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 3,
        filter: (view: GameView, t: number) => {
          // 仅 闪→杀(出杀)需要目标;杀→闪 是 respond 无目标,前端按上下文决定
          const me = view.currentPlayerIndex;
          return view.players.some(
            (p, i) => i === me,
          ) && t !== me && view.players[t]?.alive;
        },
      },
    },
    transform: (card: Card) => ({
      name: card.name === '杀' ? '闪' : '杀',
      sourceCardId: card.id,
      fromSkill: skill.id,
    }),
    activeWhen: (ctx) => {
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p?.alive) return false;
      const hasKillOrDodge = p.hand?.some((c) => c.name === '杀' || c.name === '闪') ?? false;
      if (!hasKillOrDodge) return false;
      // 两条激活路径:自己回合可出杀(闪→杀)/被询问闪(杀→闪)
      const ownTurnCanSlash = defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx);
      const slot = ctx.view.pending;
      const askedDodge =
        !!slot &&
        (slot.atom as { type?: string }).type === '询问闪' &&
        slot.target === ctx.perspectiveIdx;
      return ownTurnCanSlash || askedDodge;
    },
  });
  return;
}
