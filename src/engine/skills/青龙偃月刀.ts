// 青龙偃月刀(武器,攻击范围 3):
//   你使用的【杀】被【闪】抵消后,你可以对相同目标再使用 1 张杀。
//   可以连续追击直到命中或无杀可用。
//
// 两步流程(均通过 respond action):
//   1. 询问闪 after hook:目标出闪 → confirm 询问"是否追杀"(requestType=青龙偃月刀/confirm)
//   2. 玩家选追杀 → useCard prompt 让玩家选 1 张杀牌(requestType=青龙偃月刀/useKill)
//   3. 杀牌进处理区 → 移走旧闪 → 再次询问闪(after hook 递归回来,可继续追杀)
//
// 与贯石斧的差异:贯石斧弃 2 张牌让原杀强命(原杀还在处理区);
// 青龙偃月刀是额外使用一张新杀(新杀进处理区,旧闪移走)。
import type { AtomAfterContext, FrontendAPI, Json, Skill, GameState} from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '青龙偃月刀',
    description: '武器技:杀被闪抵消后,可对相同目标再使用一张杀',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  // 单一 respond action,按当前 pending 的 requestType 分流(confirm / useKill)
  registerAction(state, skill.id, ownerId, 'respond',
    (state, params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (slot.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== '青龙偃月刀/confirm' && requestType !== '青龙偃月刀/useKill') {
        return '当前不是青龙偃月刀询问';
      }
      // useKill 阶段:校验 cardId 是 owner 手牌中的一张杀
      if (requestType === '青龙偃月刀/useKill') {
        const cardId = params.cardId as string | undefined;
        if (!cardId) return '需要选择一张杀';
        const self = state.players[ownerId];
        if (!self) return 'player not found';
        if (!self.hand.includes(cardId)) return '牌不在手牌中';
        const card = state.cardMap[cardId];
        if (!card || card.name !== '杀') return '只能使用杀';
      }
      return null;
    },
    async (state, params) => {
      const slot = state.pendingSlots.get(ownerId);
      const requestType = (slot!.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType === '青龙偃月刀/confirm') {
        state.localVars['青龙偃月刀/confirmed'] = params.choice === true || params.confirmed === true;
      } else if (requestType === '青龙偃月刀/useKill') {
        state.localVars['青龙偃月刀/killCardId'] = params.cardId as string;
      }
    },
  );

  registerAfterHook(state, skill.id, ownerId, '询问闪', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: number; target?: number };
    if (atom.source !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    const weaponId = self.equipment['武器'];
    if (!weaponId) return;
    const weapon = ctx.state.cardMap[weaponId];
    if (!weapon || weapon.name !== '青龙偃月刀') return;

    // 检查处理区是否有闪(目标出了闪)
    const dodgeCardId = frameCards(ctx.state).find(id => {
      const c = ctx.state.cardMap[id];
      return c && c.name === '闪';
    });
    if (!dodgeCardId) return; // 没出闪,不需要追杀

    // owner 手牌中没有杀 → 无法追杀,直接放弃
    const hasKill = self.hand.some(id => ctx.state.cardMap[id]?.name === '杀');
    if (!hasKill) return;

    // 第一步:询问是否追杀
    delete ctx.state.localVars['青龙偃月刀/confirmed'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '青龙偃月刀/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '青龙偃月刀:是否追杀?', confirmLabel: '追杀', cancelLabel: '不追杀' },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars['青龙偃月刀/confirmed']) return;
    delete ctx.state.localVars['青龙偃月刀/confirmed'];

    // 第二步:让 owner 选一张杀牌
    delete ctx.state.localVars['青龙偃月刀/killCardId'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '青龙偃月刀/useKill',
      target: ownerId,
      prompt: {
        type: 'useCard',
        title: '青龙偃月刀:选择一张杀追杀',
        cardFilter: { filter: c => c.name === '杀', min: 1, max: 1 },
      },
      defaultChoice: false,
      timeout: 15,
    });
    const killCardId = ctx.state.localVars['青龙偃月刀/killCardId'] as string | undefined;
    delete ctx.state.localVars['青龙偃月刀/killCardId'];
    if (!killCardId) return; // 超时未选 → 放弃追杀

    // 追杀:杀牌从手牌移入处理区
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: killCardId,
      from: { zone: '手牌', player: ownerId },
      to: { zone: '处理区' },
    });

    // 把刚才的闪移出处理区。
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: dodgeCardId,
      from: { zone: '处理区' },
      to: { zone: '弃牌堆' },
    });

    // 再次询问闪——after hook 递归回来后,把处理区的最终状态留给杀.execute。
    // 杀.execute 检查处理区:有闪→抵消;无闪→自行造成伤害,避免双重扣血。
    await applyAtom(ctx.state, { type: '询问闪', target: atom.target!, source: ownerId });

    // 清理追杀的杀牌:杀.execute 的收尾只移走原始杀(cardId),不认识追杀的杀牌。
    // 若不移走,追杀的杀会滞留处理区导致视图不一致。
    //   - 命中时(无闪):杀.execute 自行造成伤害,此处仅清理杀牌
    //   - 被闪时(有闪):杀.execute drain 所有闪后 miss,此处仅清理杀牌
    if (frameCards(ctx.state).includes(killCardId)) {
      await applyAtom(ctx.state, {
        type: '移动牌',
        cardId: killCardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    }
  });

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '青龙偃月刀',
    style: 'danger',
    prompt: { type: 'confirm', title: '青龙偃月刀：是否追杀？', confirmLabel: '追杀', cancelLabel: '不追杀' },
  });
}
