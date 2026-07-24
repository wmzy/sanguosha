// 八阵(卧龙诸葛·锁定技):当你没有装备防具时,始终视为你装备着【八卦阵】。
//
// 实现:复用 八卦阵.ts 的 询问闪 before-hook 逻辑(询问是否发动 → 判定 →
// 红色放虚拟闪 + cancel 主询问闪),仅在 owner 无防具时生效。
//   - 八卦阵是装备防具技(随装备加载/卸载);八阵是角色锁定技(常驻)。
//   - 一旦装备了真实防具(仁王盾/藤甲/八卦阵等),八阵失效;卸下防具后自动恢复。
//
// 无防具检查:防具 slot 名为 '防具',equipment['防具'] 为空即无防具。
import type { Card, FrontendAPI, GameState, HookResult, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { runJudgeFlow } from '../judge-flow';
import { registerAction, registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '八阵',
    description: '锁定技:没有装备防具时,视为装备着八卦阵',
    isLocked: true,
  };
}

/** owner 当前是否无防具(八阵生效条件) */
function noArmor(state: GameState, ownerId: number): boolean {
  const equip = state.players[ownerId]?.equipment;
  if (!equip) return true;
  return !equip['防具'];
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:被询问"是否发动八阵"时回应,设 localVars 标记结果
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state, _params) => {
      if (state.pendingSlots.get(ownerId)?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (
        state.pendingSlots.get(ownerId)!.atom as unknown as Record<string, unknown>
      ).requestType as string;
      if (requestType !== '八阵/confirm') return '当前不是八阵确认';
      return null;
    },
    async (state, params) => {
      state.localVars['八阵/confirmed'] = params.choice === true || params.confirmed === true;
    },
  );

  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx): Promise<HookResult | void> => {
      if ((ctx.atom).target !== ownerId) return;
      // 装备了防具 → 八阵失效,不干预
      if (!noArmor(ctx.state, ownerId)) return;
      if (ctx.state.zones.deck.length === 0) return;

      // 询问是否发动八阵
      delete ctx.state.localVars['八阵/confirmed'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: '八阵/confirm',
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动八阵(判定,红色视为出闪)?',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (!ctx.state.localVars['八阵/confirmed']) return;

      // 判定:牌堆顶→处理区→技能 after hooks 读取→afterHooks 清理(处理区→弃牌堆)
      await runJudgeFlow(ctx.state, ownerId, '八阵');

      // 判定完成后判定牌已进弃牌堆,读弃牌堆顶
      const discardPile = ctx.state.zones.discardPile;
      if (discardPile.length === 0) return;
      const judgeCardId = discardPile[discardPile.length - 1];
      const judgeCard = ctx.state.cardMap[judgeCardId];
      if (!judgeCard) return;

      // 红色:往处理区放虚拟闪牌,再 cancel 主 询问闪 atom —— 视为出闪
      if (judgeCard.suit === '♥' || judgeCard.suit === '♦') {
        const dodgeId = `八阵:${ownerId}:${judgeCardId}`;
        const virtualDodge: Card = {
          id: dodgeId,
          name: '闪',
          suit: judgeCard.suit,
          color: judgeCard.color,
          rank: judgeCard.rank,
          type: '基本牌',
        };
        ctx.state.cardMap[dodgeId] = virtualDodge;
        await applyAtom(ctx.state, {
          type: '移动牌',
          cardId: dodgeId,
          from: { zone: '处理区' },
          to: { zone: '处理区' },
        });
        return { kind: 'cancel' };
      }
    },
  );
  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '八阵',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动八阵？',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
