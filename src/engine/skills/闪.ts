// 闪(基本牌):当你成为【杀】的目标时,可以打出【闪】抵消伤害。
//
// 闪的入口:
//   1. respond action:打出闪牌进处理区 + 设置已抵消标记（闪的效果 = 抵消目标杀）
//   2. 全局「生效前」after-hook(card-effects/闪.ts):在杀的结算中询问目标是否使用闪
//
// 闪的抵消效果 = 设置标记。runSettlementPhase 检测标记后发出被抵消 atom 并跳过伤害。
// 无双/肉林在「询问闪」after-hook 中清除标记并追加第二次询问。
//
// 颜色限制(通用机制):state.localVars['闪/色限制'] 由其他技能(如界父魂转化杀)
// 在 询问闪 before-hook 设置。设置时目标只能打出同色的闪。未设置则无限制(默认)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import type { Color } from '../../shared/types';
import { applyAtom, topFrame } from '../create-engine';
import { registerAction } from '../skill';
import { setCancelled } from '../card-effect/registry';

const COLOR_LIMIT_VAR = '闪/色限制';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '闪', description: '需要打出闪时,打出一张闪' };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond action:打出闪牌进处理区 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state: GameState, params: Record<string, Json>) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if ((slot.atom as { target: number }).target !== ownerId) return '不是问你的';
      if (slot.atom.type !== '询问闪') return '当前不是出闪的窗口';
      const cardId = params.cardId as string | undefined;
      if (cardId) {
        const self = state.players[ownerId];
        if (!self.hand.includes(cardId)) return '牌不在手牌中';
        const card = state.cardMap[cardId];
        if (card?.name !== '闪') return '只能打出闪';
        const limit = state.localVars[COLOR_LIMIT_VAR] as Color | undefined;
        if (limit && card.color !== limit) return `只能打出${limit}色的闪`;
      }
      return null;
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string | undefined;
      if (!cardId) return; // 不出闪
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '手牌', player: ownerId },
        to: { zone: '处理区' },
      });
      // 设置已抵消标记：闪的效果 = 抵消目标杀
      // 从结算帧栈顶部找到杀帧,设置标记
      const frame = topFrame(state);
      if (frame) {
        const killCardId = frame.params.cardId as string | undefined;
        if (killCardId && state.cardMap[killCardId]?.name === '杀') {
          setCancelled(state, killCardId, ownerId);
        }
      }
    },
  );

  // 闪的「生效前」after-hook 已移至 card-effects/闪.ts 的 registerDodgeHook(),
  // 全局注册(ownerId=-1),适用于所有玩家——闪是基本牌面能力,不限闪技能持有者。

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '出闪',
    style: 'default',
    prompt: {
      type: 'useCard',
      title: '打出闪',
      cardFilter: { filter: (c) => c.name === '闪', min: 1, max: 1 },
    },
  });
}
