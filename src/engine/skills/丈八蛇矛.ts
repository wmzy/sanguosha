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
// shadowOf 还原机制不适用。(工厂统一 rollback 只删影子卡;手牌原卡还原由
// dispatch 快照整体还原(core/rollback.ts),语义等价。)
//
// 前端多卡转化:TransformMode.minCards/maxCards 声明选牌数(2..2),
// handleTransformPlay 提交 preceding params.cardIds=[id1,id2] + 主 action
// cardId = ${id1}#${id2}#丈八蛇矛(工厂 shadowIdOf 按同一约定拼接,后缀=技能 id)。
// 五件套由 skillRuntime 工厂统一实现(cardCount=2 维度)。
import type { GameView, GameState, Skill, FrontendAPI } from '../types';
import { declareAlternativeResponse } from '../core/skill';
import { viewCanAttack } from '../rules/viewDistance';
import { defaultPlayActive, viewCanSlash } from '../rules/action-active';
import {
  registerTransformAction,
  mountTransformAction,
  viewAskedKill,
  type TransformActionOptions,
} from '../util/skillRuntime';

const OPTIONS: TransformActionOptions = {
  outputName: '杀',
  // 两张手牌当杀:影子 id = `${id1}#${id2}#丈八蛇矛`(后缀 = 技能 id,工厂统一构造)
  cardCount: 2,
  // 使用(自己回合出牌阶段)或打出(被询问杀:决斗/南蛮/激将)均可
  context: 'playOrRespondKill',
  needCardsError: '需要选择 2 张手牌',
  // 武器校核:必须装备丈八蛇矛(动态检查,允许同帧内换下后不再触发)
  cardPredicate: (state, ownerId, _cardIds) => {
    const self = state.players[ownerId];
    const weaponId = self?.equipment['武器'];
    const weaponCard = weaponId ? state.cardMap[weaponId] : undefined;
    return weaponCard?.name === '丈八蛇矛';
  },
  invalidError: '丈八蛇矛转化条件不满足',
  mount: {
    label: '丈八蛇矛',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择 2 张手牌当杀使用',
      cardFilter: { filter: () => true, min: 2, max: 2 },
      targetFilter: {
        min: 1,
        max: 1,
        // 攻击范围检查(转化出的杀同样需距离):filter 仅为前端 UI 提示
        filter: (view: GameView, t: number) =>
          viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
      },
    },
    activeWhen: (ctx) => {
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      const weaponId = p.equipment['武器'];
      const weapon = weaponId ? ctx.view.cardMap[weaponId] : undefined;
      if (weapon?.name !== '丈八蛇矛') return false;
      if ((p.handCount ?? 0) < 2) return false;
      // 出牌路径(自己回合 + 出牌阶段 + 还能出杀)
      const ownTurnCanSlash =
        defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx);
      // 回应路径(被询问杀:南蛮入侵/决斗):与武圣同构
      return ownTurnCanSlash || viewAskedKill(ctx);
    },
  },
};

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '丈八蛇矛',
    description: '可将两张手牌当杀使用',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把 2 张手牌转化为影子"杀"(新建 Card 实体,shadowOf 留空)。
  // 作为 preceding 在 杀.use/杀.respond 之前执行。杀.validate 读 cardMap[影子id] 看到"杀"。
  registerTransformAction(state, skill.id, ownerId, OPTIONS);
  // 声明替代回应:被询问杀(南蛮入侵/决斗 等)时,可用丈八蛇矛把 2 张手牌当杀打出。
  // 与武圣同构:声明后 询问杀 的可用性检测不再 skip,建立回应窗口。
  const unloadAlt = declareAlternativeResponse(state, ownerId, '询问杀');
  return () => {
    unloadAlt();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:丈八蛇矛是多卡转化技。transform 把选中两张卡包装成 CardWrapper。
  // 前端通过 prompt.cardFilter.min/max (2..2) 识别多卡选牌,
  // 进入多选转化模式,提交 preceding params.cardIds=[id1,id2]。
  mountTransformAction(api, skill.id, OPTIONS);
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
