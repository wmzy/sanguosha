// 乱击(袁绍·群雄·转化技):你可以将两张同花色的手牌当【万箭齐发】使用。
//
// 模型(组合 action,镜像丈八蛇矛——2 张手牌 → 1 张影子锦囊):
//   前端两步 UI(点乱击选 2 张同花色手牌加"万箭齐发"显示 → 点万箭齐发出牌),
//   提交时一个 ClientMessage:preceding=[乱击.transform cardIds=[id1,id2]]
//   + 主 action=万箭齐发.use(cardId = `${id1}#${id2}#乱击`,影子卡)。
// 后端 dispatch 先执行 乱击.transform(用两张同花色手牌创建一张影子"万箭齐发"),
// 再 万箭齐发.use validate 读 cardMap[影子id] 看到"万箭齐发"通过。万箭齐发技能零感知
// 乱击——它看到的永远是 cardMap 里的一张"万箭齐发"。
//
// 与丈八蛇矛的差异:
//   - outputName='万箭齐发'(非杀)。
//   - 选择条件:两张牌花色相同(同花色,suit 严格相等),而非任意两张。
//   - 无装备要求(武将主动技,而非武器技)。
//   - 主 action 万箭齐发.use 不需要目标(自动作用于所有其他角色),故前端 prompt
//     用 useCard(无 targetFilter),而非 useCardAndTarget。
//
// 原牌归宿:2 张原卡从手牌移除、合并成影子卡;影子卡离开结算区进弃牌堆时,
// 因 shadowOf 为空(多卡转化无一一对应原卡),引擎不自动还原——原卡停留在
// cardMap 但已不在任何手牌区(与丈八蛇矛一致)。rollback 路径自行完成删影子/还原配对。
// 乱击出的万箭齐发可被无懈可击抵消——由 万箭齐发.use 自身的 询问无懈可击 流程保证。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { registerAction, hasBlockingPending } from '../skill';
import { applyAtom } from '../create-engine';
import { defaultPlayActive } from '../action-active';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '乱击',
    description: '你可以将两张同花色的手牌当【万箭齐发】使用',
  };
}

/** 影子卡 id:${id1}#${id2}#乱击 —— 拼接两张原卡 id 避免与单卡 shadow 冲突 */
function shadowIdOf(id1: string, id2: string): string {
  return `${id1}#${id2}#乱击`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把 2 张同花色手牌转化为影子"万箭齐发"(新建 Card 实体,shadowOf 留空)。
  // 作为 preceding 在 万箭齐发.use 之前执行。万箭齐发.validate 读 cardMap[影子id] 看到"万箭齐发"。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无阻塞 pending + 存活
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      const cardIds = params.cardIds;
      if (!Array.isArray(cardIds) || cardIds.length !== 2) return '需要选择 2 张手牌';
      const [id1, id2] = cardIds as string[];
      if (typeof id1 !== 'string' || typeof id2 !== 'string') return 'cardIds 必须为字符串';
      if (id1 === id2) return '不能选择同一张牌';
      const cardInHand = !!self && self.hand.includes(id1) && self.hand.includes(id2);
      const c1 = state.cardMap[id1];
      const c2 = state.cardMap[id2];
      const cardsExist = !!c1 && !!c2;
      // 乱击核心条件:两张牌花色相同(同花色)
      const sameSuit = !!c1 && !!c2 && c1.suit !== '' && c1.suit === c2.suit;
      const ok =
        myTurn && inActPhase && free && selfAlive && cardInHand && cardsExist && sameSuit;
      return ok ? null : '乱击需要两张同花色的手牌';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardIds = params.cardIds as string[];
      const [id1, id2] = cardIds;
      const shadowId = shadowIdOf(id1, id2);
      // 通过「当作」atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds,
        shadowId,
        outputName: '万箭齐发',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子 + 还原两张原卡到手牌)
    (state: GameState, params: Record<string, Json>) => {
      const cardIds = params.cardIds;
      const [id1, id2] = Array.isArray(cardIds) ? (cardIds as string[]) : [];
      const sId = id1 && id2 ? shadowIdOf(id1, id2) : undefined;
      if (sId) {
        delete state.cardMap[sId];
        const self = state.players[ownerId];
        const idx = self.hand.indexOf(sId);
        if (idx >= 0) self.hand.splice(idx, 1);
        self.hand.push(id1, id2);
      }
    },
  );
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:乱击是多卡转化技。transform 把选中两张同花色手牌包装成 CardWrapper。
  // 前端通过 prompt.cardFilter.min/max (2..2) 识别多卡选牌,
  // 进入多选转化模式,提交 preceding params.cardIds=[id1,id2]。
  // 同花色配对校验由后端 validate 兜底;前端 filter 放宽为任意手牌(单卡无法判断配对),
  // activeWhen 保证仅当存在同花色对时才显示按钮。
  api.defineAction('transform', {
    label: '乱击',
    style: 'danger',
    prompt: {
      type: 'useCard',
      title: '选择 2 张同花色的手牌当万箭齐发使用',
      cardFilter: { filter: () => true, min: 2, max: 2 },
    },
    // transform 接收第一张选中卡,返回 CardWrapper(供前端显示"万箭齐发")。
    // 多卡选牌 id 由前端在 handleTransformPlay 中拼成 ${id1}#${id2}#乱击。
    transform: (card: Card) => ({ name: '万箭齐发', sourceCardId: card.id, fromSkill: skill.id }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p?.hand) return false;
      // 至少存在两张同花色手牌才可发动
      const suitCount: Record<string, number> = {};
      for (const c of p.hand) {
        if (!c.suit) continue;
        suitCount[c.suit] = (suitCount[c.suit] ?? 0) + 1;
        if (suitCount[c.suit] >= 2) return true;
      }
      return false;
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../skill').SkillModule;
