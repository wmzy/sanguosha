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
//     用 targetFilter max=0(仍走 useCardAndTarget 进入多卡转化模式)。
//
// 原牌归宿:2 张原卡从手牌移除、合并成影子卡;影子卡离开结算区进弃牌堆时,
// 因 shadowOf 为空(多卡转化无一一对应原卡),引擎不自动还原——原卡停留在
// cardMap 但已不在任何手牌区(与丈八蛇矛一致)。rollback 删影子(工厂统一实现;
// 手牌原卡还原由 dispatch 快照整体还原,core/rollback.ts)。
// 乱击出的万箭齐发可被无懈可击抵消——由 万箭齐发.use 自身的 询问无懈可击 流程保证。
// 五件套由 skillRuntime 工厂统一实现(cardCount=2 维度)。
import type { Card, FrontendAPI, GameState, Skill } from '../types';
import { defaultPlayActive } from '../rules/action-active';
import {
  registerTransformAction,
  mountTransformAction,
  type TransformActionOptions,
} from '../util/skillRuntime';

const OPTIONS: TransformActionOptions = {
  outputName: '万箭齐发',
  // 两张手牌 → 影子 id = `${id1}#${id2}#乱击`(后缀 = 技能 id,工厂统一构造)
  cardCount: 2,
  needCardsError: '需要选择 2 张手牌',
  // 乱击核心条件:两张牌花色相同(同花色,suit 严格相等)
  cardPredicate: (state, _ownerId, cardIds) => {
    const [c1, c2] = cardIds.map((id) => state.cardMap[id]);
    return !!c1 && !!c2 && c1.suit !== '' && c1.suit === c2.suit;
  },
  invalidError: '乱击需要两张同花色的手牌',
  mount: {
    label: '乱击',
    style: 'danger',
    prompt: {
      // useCardAndTarget 才会进入前端 transformMode(多卡转化);万箭齐发是 AOE
      // 无需选目标,targetFilter max=0 表示不强制选目标(直接提交)。
      type: 'useCardAndTarget',
      title: '选择 2 张同花色的手牌当万箭齐发使用',
      cardFilter: {
        filter: () => true,
        min: 2,
        max: 2,
        comboFilter: (cards: Card[]) => cards[0]?.suit === cards[1]?.suit,
      },
      targetFilter: { min: 0, max: 0 },
    },
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
  },
};

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '乱击',
    description: '你可以将两张同花色的手牌当【万箭齐发】使用',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把 2 张同花色手牌转化为影子"万箭齐发"(新建 Card 实体,shadowOf 留空)。
  // 作为 preceding 在 万箭齐发.use 之前执行。万箭齐发.validate 读 cardMap[影子id] 看到"万箭齐发"。
  registerTransformAction(state, skill.id, ownerId, OPTIONS);
  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:乱击是多卡转化技。transform 把选中两张同花色手牌包装成 CardWrapper。
  // 前端通过 prompt.cardFilter.min/max (2..2) 识别多卡选牌,
  // 进入多选转化模式,提交 preceding params.cardIds=[id1,id2]。
  // 同花色配对校验由后端 validate 兜底;单卡 filter 无法表达「两张牌之间」的约束,
  // 故用 comboFilter 声明——无头枚举/浏览器据此过滤组合,否则会枚举/提交出引擎必拒的动作
  // (AI 反复挑中同一非法组合 → 空转)。activeWhen 保证仅当存在同花色对时才显示按钮。
  mountTransformAction(api, skill.id, OPTIONS);
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
