// 武圣(关羽·转化技):将一张红色牌当【杀】使用或打出。
//
// 模型(组合 action):前端两步 UI(点武圣给红牌加"杀"显示 → 点出杀选目标),
// 提交时一个 ClientMessage:preceding=[武圣.transform] + 主 action=杀.use。
// 后端 dispatch 先执行 武圣.transform(创建影子杀),再 杀.use validate 看到"杀"通过。
// 杀技能零感知武圣——它看到的永远是 cardMap 里的一张"杀"。
// 五件套(shadowId/validate/execute/rollback/defineAction)由 skillRuntime 工厂统一实现。
//
// 本文件同时导出 createWushengSkill 工厂:标版/界武圣的 OPTIONS 约 70% 逐字相同
// (targetFilter/activeWhen 出杀+回应双路径),真实差异仅两点,均参数化:
//   - includeEquipment:界版红色牌含装备区(转化时先卸下再「当作」,rollback 还原
//     槽位与武器距离 vars);
//   - diamondSlashNoDistanceLimit:界版官方被动"你使用的方片【杀】无距离限制"。
// 参照 八阵.ts 复用 八卦阵.ts 工厂的做法,界武圣.ts 声明式消费本工厂。
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

/** createWushengSkill 可注入差异(标版全缺省)。 */
export interface WushengOptions {
  name: string;
  description: string;
  /** 装备区红色牌也可转化(界版;activeWhen 同步纳入装备区红牌检查)。 */
  includeEquipment?: boolean;
  /** 你使用的方片【杀】无距离限制(界版官方被动)。 */
  diamondSlashNoDistanceLimit?: boolean;
}

/**
 * 武圣族(武圣/界武圣)技能工厂:红色牌(标版仅手牌,界版含装备区)当【杀】
 * 使用或打出的完整三件套。时机:出杀路径(自己回合出牌阶段)或回应路径
 * (被询问杀:南蛮入侵/决斗/激将/挑衅),与龙胆同构。
 */
export function createWushengSkill(opts: WushengOptions) {
  const OPTIONS: TransformActionOptions = {
    outputName: '杀',
    // 时机:出杀路径(自己回合出牌阶段)或回应路径(被询问杀:南蛮入侵/决斗/激将/挑衅)
    context: 'playOrRespondKill',
    includeEquipment: opts.includeEquipment === true,
    cardPredicate: (state, _ownerId, cardIds) => state.cardMap[cardIds[0]]?.color === '红',
    invalidError: '现在不能使用武圣',
    mount: {
      label: opts.name,
      style: 'passive',
      prompt: {
        type: 'useCardAndTarget',
        title: '选择一张红色牌当杀使用',
        cardFilter: { filter: (c: Card) => c.color === '红', min: 1, max: 1 },
        targetFilter: {
          min: 1,
          max: 1,
          // 攻击范围检查(转化出的杀同样需距离):filter 仅为前端 UI 提示(出杀路径用)
          filter: (view: GameView, t: number) =>
            viewCanAttack(view.players, view.cardMap, view.currentPlayerIndex, t),
        },
      },
      activeWhen: (ctx) => {
        const p = ctx.view.players[ctx.perspectiveIdx];
        if (!p?.alive) return false;
        const hasRedInHand = p.hand?.some((c) => c.color === '红') ?? false;
        // 界关羽武圣:装备区红色牌也可转化
        const hasRedEquip = opts.includeEquipment
          ? Object.values(p.equipment ?? {}).some((id) => {
              const card = id ? ctx.view.cardMap[id] : undefined;
              return card?.color === '红';
            })
          : false;
        if (!hasRedInHand && !hasRedEquip) return false;
        // 出杀路径(自己回合 + 出牌阶段 + 还能出杀)或回应路径(被询问杀)
        return (
          (defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx)) ||
          viewAskedKill(ctx)
        );
      },
    },
  };

  function createSkill(id: string, ownerId: number): Skill {
    return { id, ownerId, name: opts.name, description: opts.description };
  }

  function onInit(skill: Skill, state: GameState): () => void {
    const ownerId = skill.ownerId;
    // transform action:把红色牌(标版手牌;界版含装备区)转化为影子"杀"
    // (新建 Card 实体,shadowOf 指向原卡)。
    // 作为 preceding 在 杀.use(出牌阶段)/ 杀.respond(被询问杀)之前执行。
    const unloadTransform = registerTransformAction(state, skill.id, ownerId, OPTIONS);
    // 声明替代回应:被询问杀(南蛮入侵/决斗 等)时,可用武圣把红色牌当杀打出。
    // 与龙胆/倾国同构:声明后 询问杀 的可用性检测不再 skip,建立回应窗口。
    const unloadAlt = declareAlternativeResponse(state, ownerId, '询问杀');
    // ─── 距离豁免器(界版):官方"你使用的方片【杀】无距离限制"(被动增益,
    //     任何方片杀生效,含物理方片杀与武圣/丈八转化出的方片杀)。
    //     通过 distance provider 实现,避免污染 杀.ts。 ─────────────────────
    const unloadRangeExemptor = opts.diamondSlashNoDistanceLimit
      ? registerAttackRangeExemptor(state, ownerId, (_st, _from, _to, cardId) => {
          if (!cardId) return false;
          const card = _st.cardMap[cardId];
          return card?.suit === '♦';
        // 第 4 参为契约测试的归属声明:此豁免只可能由界武圣实例启用
        // (diamondSlashNoDistanceLimit 仅界版传入);未来别的技能启用该标志时,
        // view-distance-sync 契约测试会因归属不匹配而失败,提醒同步登记表。
        }, '界武圣')
      : undefined;
    return () => {
      unloadAlt();
      unloadRangeExemptor?.();
      unloadTransform();
    };
  }

  function onMount(skill: Skill, api: FrontendAPI): void {
    // 前端:武圣是转化技,defineAction 声明红牌+目标。
    // 前端 UI 流程(出杀):选红牌 → 选目标 → 点武圣按钮 → 提交 preceding=[武圣.transform] + 杀.use。
    // 前端 UI 流程(打出):被询问杀时(南蛮/决斗),选红牌 → 点武圣按钮 → preceding + 杀.respond。
    mountTransformAction(api, skill.id, OPTIONS);
  }

  return { createSkill, onInit, onMount };
}

export const { createSkill, onInit, onMount } = createWushengSkill({
  name: '武圣',
  description: '你可以将一张红色牌当【杀】使用或打出',
});
