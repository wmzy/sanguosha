// 界奸雄(界曹操·被动技):当你受到伤害后,你可以摸一张牌,并获得造成此伤害的牌。
//   (官方逐字,OL 官网 hero/311 + docs/research/武将技能/魏国/界曹操.md——两项效果,非二选一。)
//   无来源伤害(闪电等)无牌可获得:仍可发动,但只摸一张牌(官网 FAQ 2016-11-01)。
//   与标版区别:标版仅获得造成伤害的牌,无摸牌段。
//
// 时序关键(选项②):伤害牌在造成伤害时位于 frame.cards(处理区),父 execute
// (杀/万箭齐发/南蛮入侵/决斗)收尾会 applyAtom(移动牌, 处理区→弃牌堆)将其入弃牌堆。
// 若奸雄在造成伤害 after hook 直接拿走(处理区→手牌),父收尾的 移动牌 `to:弃牌堆`
// 仍会无条件 push 该 cardId → 牌同时出现在手牌与弃牌堆(状态损坏)。
// 故采用"延迟拿取":造成伤害后记录 wantCard=cardId,挂 移动牌 after hook,
// 在该伤害牌被移入弃牌堆的瞬间再 移动牌(弃牌堆→手牌)。此时父收尾已完成、无重复。
//
// 摸一张牌无此问题,在受伤害 hook 内直接 摸牌 count=1(先摸后延迟获得,结果与官方语序一致)。
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';

const CHOOSE_RT = '界奸雄/choose';
const WANTCARD_KEY = '奸雄/wantCard';
const CHOICE_KEY = '奸雄/choice';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界奸雄',
    description: '当你受到伤害后,你可以摸一张牌,并获得造成此伤害的牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:玩家在「奸雄/choose」询问下的选择(choice=true/false)
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== CHOOSE_RT) return '当前不是奸雄选择';
      return null;
    },
    async (s, params) => {
      s.localVars[CHOICE_KEY] = params.choice === true;
    },
  );

  // 造成伤害 after:曹操受伤后询问是否发动(两项:摸一张 + 获得伤害牌)
  registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;

    const damageCardId = atom.cardId;
    const hasCard = typeof damageCardId === 'string' && !!ctx.state.cardMap[damageCardId];
    // 转化影子卡(武圣红牌当杀等):影子卡入弃牌堆时引擎用原卡(shadowOf)替换并删除影子,
    // 须记录原卡 id 才能在弃牌堆中找到并拿取(同标奸雄/界双雄)
    const effectiveId: string = hasCard
      ? (ctx.state.cardMap[damageCardId].shadowOf ?? damageCardId)
      : (damageCardId as string);

    delete ctx.state.localVars[CHOICE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CHOOSE_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: hasCard
          ? '界奸雄:是否发动?(摸一张牌并获得造成此伤害的牌)'
          : '界奸雄:是否发动?(无伤害牌可获得,仅摸一张牌)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });

    const choice = ctx.state.localVars[CHOICE_KEY] === true;
    if (!choice) {
      delete ctx.state.localVars[CHOICE_KEY];
      return;
    }

    // 两项效果都执行:先摸一张,获得走延迟拿取(见下方 移动牌 after hook)。
    // 无来源伤害(闪电等):无牌可获得,仅摸一张(官网 FAQ)。
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    if (hasCard) {
      ctx.state.localVars[WANTCARD_KEY] = effectiveId;
    }
    delete ctx.state.localVars[CHOICE_KEY];
  });

  // 移动牌 after:延迟拿取伤害牌——当 wantCard 指定的牌被移入弃牌堆时,转为曹操手牌
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const wantCard = ctx.state.localVars[WANTCARD_KEY];
    if (typeof wantCard !== 'string') return;
    const atom = ctx.atom;
    if (atom.to?.zone !== '弃牌堆') return;
    // 该伤害牌(或其原卡)刚被父结算移入弃牌堆——转给曹操。
    // 用 discardPile.includes 判定而非 atom.cardId===wantCard:转化影子卡入弃牌堆时
    // 引擎用原卡替换,atom.cardId(影子 id)≠ wantCard(原卡 id),按 cardId 匹配会漏掉。
    // 若原卡已被其他技能拿走(不在弃牌堆)→ 跳过,不强行获取避免状态损坏。
    if (!ctx.state.zones.discardPile.includes(wantCard)) return;
    if (!ctx.state.cardMap[wantCard]) return;
    delete ctx.state.localVars[WANTCARD_KEY];
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: wantCard,
      from: { zone: '弃牌堆' },
      to: { zone: '手牌', player: ownerId },
    });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界奸雄',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动奸雄?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
