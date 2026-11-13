// 界武圣(界关羽·转化技):将一张红色牌(手牌或装备区)当【杀】使用或打出。
//
// 模型(组合 action):前端两步 UI(点武圣给红牌加"杀"显示 → 点出杀选目标),
// 提交时一个 ClientMessage:preceding=[武圣.transform] + 主 action=杀.use。
// 后端 dispatch 先执行 武圣.transform(创建影子杀),再 杀.use validate 看到"杀"通过。
// 杀技能零感知武圣——它看到的永远是 cardMap 里的一张"杀"。
//
// 界限突破:红色牌包括装备区(原版仅手牌)。装备区红色牌转化时先卸下到手牌再「当作」
// (工厂 includeEquipment 维度;rollback 还原槽位与武器距离 vars)。
// 五件套由 skillRuntime 工厂统一实现;影子卡 id 后缀 = 注册传入的 skillId('界武圣'),
// 与客户端 `${牌id}#${skillId}` 构造约定一致(见 CLAUDE.md)。
import type { Card, GameView, GameState, Skill, FrontendAPI } from '../types';
import { declareAlternativeResponse } from '../core/skill';
import { viewCanAttack } from '../rules/viewDistance';
import { defaultPlayActive, viewCanSlash } from '../rules/action-active';
import { registerAttackRangeExemptor } from '../rules/distance';
import {
  registerTransformAction,
  mountTransformAction,
  viewAskedKill,
  type TransformActionOptions,
} from '../util/skillRuntime';

const OPTIONS: TransformActionOptions = {
  outputName: '杀',
  // 时机:出杀路径(自己回合出牌阶段)或回应路径(被询问杀:南蛮入侵/决斗/激将/挑衅)
  context: 'playOrRespondKill',
  // 界关羽武圣:红色牌包括手牌和装备区
  includeEquipment: true,
  cardPredicate: (state, _ownerId, cardIds) => state.cardMap[cardIds[0]]?.color === '红',
  invalidError: '现在不能使用武圣',
  mount: {
    label: '界武圣',
    style: 'passive',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张红色牌当杀使用',
      cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
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
      if (!p?.alive) return false;
      const hasRedInHand = p.hand?.some((c) => c.color === '红') ?? false;
      // 界关羽武圣:装备区红色牌也可转化
      const hasRedEquip = Object.values(p.equipment ?? {}).some((id) => {
        const card = id ? ctx.view.cardMap[id] : undefined;
        return card?.color === '红';
      });
      if (!hasRedInHand && !hasRedEquip) return false;
      // 出杀路径(自己回合 + 出牌阶段 + 还能出杀)或回应路径(被询问杀)
      return (
        (defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx)) ||
        viewAskedKill(ctx)
      );
    },
  },
};

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界武圣',
    description: '你可以将一张红色牌(手牌或装备区)当【杀】使用或打出',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把红色牌(手牌或装备区)转化为影子"杀"(新建 Card 实体,shadowOf 指向原卡)。
  // 作为 preceding 在 杀.use(出牌阶段)/ 杀.respond(被询问杀)之前执行。
  const unloadTransform = registerTransformAction(state, skill.id, ownerId, OPTIONS);

  // 声明替代回应:被询问杀(南蛮入侵/决斗 等)时,可用武圣把红色牌(手牌或装备区)当杀打出。
  // 与标版武圣/龙胆/倾国同构:声明后 询问杀 的可用性检测不再 skip,建立回应窗口。
  const unloadAlt = declareAlternativeResponse(state, ownerId, '询问杀');

  // ─── 距离豁免器:界武圣转化的方片杀无距离限制 ─────────────────────
  //   官方"你使用的方片【杀】无距离限制"(被动增益,任何方片杀生效,
  //   含物理方片杀与武圣/丈八转化出的方片杀)。
  //   通过 distance provider 实现,避免污染 杀.ts。
  const unloadRangeExemptor = registerAttackRangeExemptor(
    state,
    ownerId,
    (_st, _from, _to, cardId) => {
      if (!cardId) return false;
      const card = _st.cardMap[cardId];
      return card?.suit === '♦';
    },
  );

  return () => {
    unloadAlt();
    unloadRangeExemptor();
    unloadTransform();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:武圣是转化技,defineAction 声明红牌+目标。
  // 前端 UI 流程:选红牌 → 选目标 → 点武圣按钮 → 提交 preceding=[武圣.transform] + 主 action=杀.use。
  mountTransformAction(api, skill.id, OPTIONS);
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
