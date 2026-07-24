// 奸雄(曹操·被动技):当你受到伤害后,你可以获得造成此伤害的牌。
//   无来源伤害(闪电等)无牌可获得,技能不发动。
//
// 时序关键:伤害牌在造成伤害时位于 frame.cards(处理区),父 execute
// (杀/万箭齐发/南蛮入侵/决斗)收尾会 applyAtom(移动牌, 处理区→弃牌堆)将其入弃牌堆。
// 若奸雄在造成伤害 after hook 直接拿走(处理区→手牌),父收尾的 移动牌 `to:弃牌堆`
// 仍会无条件 push 该 cardId → 牌同时出现在手牌与弃牌堆(状态损坏)。
// 故采用"延迟拿取":造成伤害后记录 wantCard=cardId,挂 移动牌 after hook,
// 在该伤害牌被移入弃牌堆的瞬间再 移动牌(弃牌堆→手牌)。此时父收尾已完成、无重复。
import type { FrontendAPI, GameState, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const CHOOSE_RT = '奸雄/choose';
const WANTCARD_KEY = '奸雄/wantCard';
const CHOICE_KEY = '奸雄/choice';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '奸雄',
    description: '当你受到伤害后,你可以获得造成此伤害的牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:玩家在「奸雄/choose」询问下的选择(choice=true=获得伤害牌)
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

  // 造成伤害 after:曹操受伤后,若有伤害牌则询问是否获得
  registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;

    const damageCardId = atom.cardId;
    // 无伤害牌(闪电等无来源伤害):无可获得之物,技能不发动
    if (typeof damageCardId !== 'string' || !ctx.state.cardMap[damageCardId]) return;

    delete ctx.state.localVars[CHOICE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CHOOSE_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '奸雄:是否获得造成此伤害的牌?',
        confirmLabel: '获得',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });

    const choice = ctx.state.localVars[CHOICE_KEY] === true;
    if (choice) {
      // 获得伤害牌:延迟到该牌入弃牌堆时拿取(见下方 移动牌 after hook)
      ctx.state.localVars[WANTCARD_KEY] = damageCardId;
    }
    delete ctx.state.localVars[CHOICE_KEY];
  });

  // 移动牌 after:延迟拿取伤害牌——当 wantCard 指定的牌被移入弃牌堆时,转为曹操手牌
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const wantCard = ctx.state.localVars[WANTCARD_KEY];
    if (!wantCard) return;
    const atom = ctx.atom;
    if (atom.cardId !== wantCard) return;
    if (atom.to?.zone !== '弃牌堆') return;
    // 该伤害牌刚被父结算移入弃牌堆——转给曹操
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
    label: '奸雄',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动奸雄?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}
