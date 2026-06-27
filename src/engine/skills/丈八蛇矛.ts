// src/engine/skills/丈八蛇矛.ts
// 丈八蛇矛(武器,攻击范围 3):你可以将 2 张手牌当【杀】使用或打出(转化技)。
//
// 模型(组合 action,与武圣同形):前端两步 UI(点丈八蛇矛选 2 张手牌加"杀"显示
// → 点出杀选目标),提交时一个 ClientMessage:preceding=[丈八蛇矛.transform]
// + 主 action=杀.use。
// 后端 dispatch 先执行 丈八蛇矛.transform(用两张手牌创建一张影子杀),
// 再 杀.use validate 看到"杀"通过。杀技能零感知丈八蛇矛——
// 它看到的永远是 cardMap 里的一张"杀"。
//
// 与武圣的关键差异:武圣是 1 张原卡 → 1 张 shadow(原卡仍在 cardMap,
// shadowOf 指向原卡,影子离开结算区时引擎按 shadowOf 还原)。丈八蛇矛是
// 2 张原卡 → 1 张 shadow(原卡从 cardMap **移除**,从手牌移除;
// shadowOf 置空,因为不存在一一对应的"原卡")。因此 rollback 路径
// 必须在 execute 前后保留原卡 id,自己完成"删影子/还原卡"配对,引擎
// shadowOf 还原机制不适用。
//
// 前端多卡转化:TransformMode.minCards/maxCards 声明选牌数(2..2),
// handleTransformPlay 提交 preceding params.cardIds=[id1,id2] + 主 action
// cardId = ${id1}#${id2}#丈八蛇矛。
import type { Card, CardWrapper, GameView, GameState, Json, Skill, FrontendAPI } from '../types';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill'
import { applyAtom } from '../create-engine';
import { viewCanAttack } from '../viewDistance';
import { defaultPlayActive, viewCanSlash } from '../action-active';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '丈八蛇矛',
    description: '可将两张手牌当杀使用',
  };
}

/** 影子卡 id:${id1}#${id2}#丈八蛇矛 —— 拼接两张原卡 id 避免与单卡 shadow 冲突 */
function shadowIdOf(id1: string, id2: string): string {
  return `${id1}#${id2}#丈八蛇矛`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把 2 张手牌转化为影子"杀"(新建 Card 实体,shadowOf 留空)。
  // 作为 preceding 在 杀.use 之前执行。杀.validate 读 cardMap[影子id] 看到"杀"。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
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
      // 武器校核:必须装备丈八蛇矛(动态检查,允许同帧内换下后不再触发)
      const weaponId = self.equipment['武器'];
      const weaponCard = weaponId ? state.cardMap[weaponId] : undefined;
      const hasZhangba = weaponCard?.name === '丈八蛇矛';
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && cardsExist && hasZhangba;
      return ok ? null : '丈八蛇矛转化条件不满足';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const [id1, id2] = params.cardIds as string[];
      // 通过 atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(state, { type: '武圣包装', player: ownerId, cardId: id1, secondCardId: id2 });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子 + 还原卡)
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
  // 前端:丈八蛇矛是多卡转化技。transform 把选中两张卡包装成 CardWrapper。
  // 前端通过 prompt.cardFilter.min/max (2..2) 识别多卡选牌,
  // 进入多选转化模式,提交 preceding params.cardIds=[id1,id2]。
  api.defineAction('transform', {
    label: '丈八蛇矛',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择 2 张手牌当杀使用',
      cardFilter: { filter: () => true, min: 2, max: 2 },
      targetFilter: {
        min: 1, max: 1,
        // 攻击范围检查(转化出的杀同样需距离):filter 仅为前端 UI 提示
        filter: (view: GameView, t: number) => viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
      },
    },
    // transform 接收第一张选中卡,返回 CardWrapper(供前端显示"杀")。
    // 多卡选牌 id 由前端在 handleTransformPlay 中拼成 ${id1}#${id2}#丈八蛇矛。
    transform: (card: Card) => ({ name: '杀', sourceCardId: card.id, fromSkill: skill.id } as CardWrapper),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      const weaponId = p.equipment['武器'];
      const weapon = weaponId ? ctx.view.cardMap[weaponId] : undefined;
      if (weapon?.name !== '丈八蛇矛') return false;
      return p.handCount >= 2 && viewCanSlash(ctx.view, ctx.perspectiveIdx);
    },
  });
  return;
}

