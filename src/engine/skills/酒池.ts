// 酒池(董卓·转化技):你可以将一张黑桃手牌当【酒】使用。
//
// 模型(组合 action,镜像武圣):前端选一张黑桃手牌 → 点酒池 → 提交
// preceding=[酒池.transform] + 主 action=酒.use。
// 后端 dispatch 先执行 酒池.transform(创建影子酒),再 酒.use validate 看到"酒"通过。
// 酒技能零感知酒池——它看到的永远是 cardMap 里的一张"酒"。
//
// 描述:"你可以将一张黑桃手牌当【酒】使用。" 黑桃 = ♠(仅黑桃,非黑色)。
// 无次数限制。
import type { Card, GameState, Json, Skill, FrontendAPI } from '../types';
import { hasBlockingPending, declareAlternativeResponse } from '../core/skill';
import { defaultPlayActive } from '../rules/action-active';
import {
  mountTransformAction,
  registerTransformAction,
  type TransformActionOptions,
} from '../util/skillRuntime';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '酒池',
    description: '你可以将一张黑桃手牌当【酒】使用',
  };
}

/** transform 五件套工厂配置(黑桃手牌 → 影子酒)。 */
const TRANSFORM_OPTIONS: TransformActionOptions = {
  outputName: '酒',
  validate: (state: GameState, ownerId: number, params: Record<string, Json>) => {
    // 通用合法条件:自己回合 + 无 pending + 存活 + 手牌 + 黑桃
    const myTurn = state.currentPlayerIndex === ownerId;
    const free = !hasBlockingPending(state);
    const self = state.players[ownerId];
    const selfAlive = self.alive === true;
    const cardId = params.cardId as string;
    const cardIdOk = typeof cardId === 'string';
    const card = cardIdOk ? state.cardMap[cardId] : undefined;
    const cardInHand = cardIdOk && self.hand.includes(cardId);
    const isSpade = !!card && card.suit === '♠';
    // 濒死求桃窗口:已声明 declareAlternativeResponse('请求回应','桃/求桃'),
    // 转化出的影子【酒】可经 酒.respond 当桃自救——此时非自己回合且有阻塞 pending,须放行。
    // 仅限自己濒死:求桃循环会对每个存活玩家发 桃/求桃(target=被问询者),他人濒死
    // 轮到董卓时 slot.target 同样等于 ownerId;不加 health<=0 门控,组合消息
    // (酒池.transform + 酒.respond)即可用黑桃牌救他人,违反「酒仅自救」。
    // runDyingFlow 的 while 循环保证濒死者整个问询期间 health<=0。
    const slot = state.pendingSlots.get(ownerId);
    const atomType = (slot?.atom as { type?: string })?.type;
    const reqType = (slot?.atom as { requestType?: string })?.requestType;
    const atomTarget = (slot?.atom as { target?: number })?.target;
    const askedPeach =
      !!slot &&
      atomTarget === ownerId &&
      atomType === '请求回应' &&
      reqType === '桃/求桃' &&
      self.health <= 0;
    const ok = (myTurn && free && selfAlive) || (selfAlive && askedPeach);
    return cardInHand && isSpade && ok ? null : '现在不能使用酒池';
  },
  mount: {
    label: '酒池',
    style: 'passive',
    prompt: {
      type: 'useCard',
      title: '选择一张黑桃手牌当酒使用',
      cardFilter: { filter: (c: Card) => c.suit === '♠', min: 1, max: 1 },
    },
    activeWhen: (ctx) => {
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      const hasSpade = p.hand?.some((c: Card) => c.suit === '♠') ?? false;
      if (!hasSpade) return false;
      // 出牌路径(自己回合 + 出牌阶段)
      if (defaultPlayActive(ctx)) return true;
      // 濒死自救路径(被询问 桃/求桃):与武圣 askedKill 同构。
      // 仅限自己濒死(酒仅自救):他人濒死轮到董卓被问桃时,pending.target 同样命中
      // 自己,须再校验视角玩家 health<=0 才亮出转化入口。
      const slot = ctx.view.pending;
      const reqType = (slot?.atom as { requestType?: string })?.requestType;
      return (
        !!slot &&
        (slot as { target?: number }).target === ctx.perspectiveIdx &&
        reqType === '桃/求桃' &&
        p.health <= 0
      );
    },
  },
};

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // transform action:把黑桃手牌转化为影子"酒"(新建 Card 实体,shadowOf 指向原卡)。
  // 作为 preceding 在 酒.use 之前执行。酒.validate 读 cardMap[影子id] 看到"酒"。
  // 五件套(影子 id 后缀=技能 id '酒池'、当作、rollback、defineAction)由工厂统一实现。
  registerTransformAction(state, skill.id, ownerId, TRANSFORM_OPTIONS);
  const unloadDecl = declareAlternativeResponse(state, ownerId, '请求回应', '桃/求桃');
  return () => { unloadDecl(); };
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  // 前端:酒池是转化技,defineAction 声明黑桃手牌。
  // 前端 UI 流程:选黑桃手牌 → 点酒池 → 提交 preceding=[酒池.transform] + 主 action=酒.use。
  // 酒.use 自带 selfTarget:true(对自己使用),无需额外选目标。
  mountTransformAction(api, skill.id, TRANSFORM_OPTIONS);
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
