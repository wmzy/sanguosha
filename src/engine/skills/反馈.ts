// 反馈(司马懿·被动技):当你受到伤害后,你可以获得伤害来源的一张牌。
import type { AtomAfterContext, FrontendAPI, Json, Skill, GameState} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '反馈',
    description: '受到伤害后,你可以获得伤害来源的一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // respond:被询问"是否发动反馈"时回应,设 localVars 标记结果
  registerAction(state, skill.id, ownerId, 'respond',
    (state, params) => {
      if (state.pendingSlots.get(ownerId)?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (state.pendingSlots.get(ownerId)!.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '反馈/confirm') return '当前不是反馈确认';
      return null;
    },
    async (state, params) => {
      state.localVars['反馈/confirmed'] = params.choice === true || params.confirmed === true;
    },
  );

  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; source?: number; amount?: number };
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (atom.source === undefined) return;
    const sourcePlayer = ctx.state.players[atom.source];
    if (!sourcePlayer?.alive) return;
    const hasCards = sourcePlayer.hand.length > 0 || Object.keys(sourcePlayer.equipment).length > 0;
    if (!hasCards) return;

    // 询问是否发动
    delete ctx.state.localVars['反馈/confirmed'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '反馈/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '是否发动反馈?', confirmLabel: '发动', cancelLabel: '不发动' },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars['反馈/confirmed']) return;

    // 获得来源的一张牌(优先手牌第一张,其次装备)
    const source = ctx.state.players[atom.source];
    if (!source) return;
    let cardId: string | undefined;
    if (source.hand.length > 0) {
      cardId = source.hand[0];
      await applyAtom(ctx.state, { type: '获得', player: ownerId, cardId, from: atom.source });
    } else {
      const equipSlot = Object.keys(source.equipment)[0] as keyof typeof source.equipment;
      if (equipSlot) {
        cardId = source.equipment[equipSlot];
        if (cardId) {
          await applyAtom(ctx.state, { type: '获得', player: ownerId, cardId, from: atom.source });
        }
      }
    }
  });
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '反馈',
    style: 'default',
    prompt: { type: 'confirm', title: '是否发动反馈？', confirmLabel: '发动', cancelLabel: '不发动' },
  });
}

