// 界纵适(界简雍·蜀·被动技,OL hero/600 官方逐字):
//   "当你拼点赢时,你可以获得点数较小的拼点牌;
//    当你没赢时,你可以获得你的拼点牌。"
//
// 与标 简雍 纵适 描述完全一致(标版 src/engine/skills/纵适.ts 未实现),
// 故界版独立实现;触发逻辑适用于 界简雍 参与的任何拼点(含 巧说 自拼 与 他人发起的拼点)。
//
// 实现要点:
//   - after-hook 挂「拼点」atom:拼点 atom 的 apply 已把两张拼点牌从处理区移入弃牌堆,
//     此处直接从弃牌堆取。
//   - 视角判定:owner 可能是 initiator(自己发起,如巧说)或 target(他人发起,
//     如天义/驱虎/烈刃/制霸 等以 owner 为目标)。
//   - 输赢判定(从 owner 视角):owner 点数严格大于对方 = 赢;否则(输或平)没赢。
//   - 获得哪张:赢 → 对方的牌(必然点数较小);没赢 → 自己的牌。
//   - 询问 confirm:超时默认放弃(不强制获得)。
//   - 获得路径:移动牌 from 弃牌堆 → owner 手牌(与 拼点 atom 的 apply 对称:apply 把
//     处理区→弃牌堆;纵适反向 弃牌堆→手牌)。
//   - 卡牌可能在拼点 atom 后已被其他技能(如酣战·获杀)取走 → 校验 discardPile.includes
//     再发询问;若已不在弃牌堆,纵适不触发。
//
// 命名:文件名/loader key/character skill name 均为 '界纵适'(避开标版潜在冲突);
//   内部 Skill.name = '纵适'(OL 官方技能名,玩家可见)。
import type {
  Card,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界纵适';
const DISPLAY_NAME = '纵适';

/** confirm 请求类型:owner 选择是否获得拼点牌。 */
const CONFIRM_RT = `${SKILL_ID}/confirm`;
/** localVars key:存 confirm 结果(true/false)。 */
const CONFIRM_KEY = `${SKILL_ID}/confirmed`;

/** 拼点牌点数:A=1, 2-10=面值, J=11, Q=12, K=13(与 天义/驱虎/烈刃 等一致)。 */
function rankValue(rank: string): number {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  const n = parseInt(rank, 10);
  return Number.isFinite(n) ? n : 0;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '当你拼点赢时,你可以获得点数较小的拼点牌;当你没赢时,你可以获得你的拼点牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:owner 确认是否获得拼点牌 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as unknown as Record<string, unknown>;
      if (atom.type !== '请求回应') return '当前不需要回应';
      if ((atom.requestType as string) !== CONFIRM_RT) return '当前不是纵适回应';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return;
      const atom = slot.atom as unknown as Record<string, unknown>;
      if (atom.type !== '请求回应' || (atom.requestType as string) !== CONFIRM_RT) return;
      // params.choice: true=获得, false/缺省=放弃
      st.localVars[CONFIRM_KEY] = params.choice === true;
    },
  );

  // ── after-hook:拼点 atom 后,owner 可获得指定拼点牌 ──
  registerAfterHook(state, skill.id, ownerId, '拼点', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '拼点') return;

    // owner 须为拼点参与方
    const isInitiator = atom.initiator === ownerId;
    const isTarget = atom.target === ownerId;
    if (!isInitiator && !isTarget) return;

    // 任一张为空(超时未出):放弃
    if (!atom.initiatorCard || !atom.targetCard) return;

    const initiatorCard: Card | undefined = ctx.state.cardMap[atom.initiatorCard];
    const targetCard: Card | undefined = ctx.state.cardMap[atom.targetCard];
    if (!initiatorCard || !targetCard) return;

    const initiatorValue = rankValue(initiatorCard.rank);
    const targetValue = rankValue(targetCard.rank);

    // owner 视角的点数 / 牌 id
    const ownerValue = isInitiator ? initiatorValue : targetValue;
    const otherValue = isInitiator ? targetValue : initiatorValue;
    const ownerCardId = isInitiator ? atom.initiatorCard : atom.targetCard;
    const otherCardId = isInitiator ? atom.targetCard : atom.initiatorCard;

    // 赢 → 获对方的牌(点数较小);没赢(输或平)→ 获自己的牌
    const win = ownerValue > otherValue;
    const cardToGain = win ? otherCardId : ownerCardId;

    // 牌可能已被其他技能(如酣战)从弃牌堆取走 → 不触发
    if (!ctx.state.zones.discardPile.includes(cardToGain)) return;

    // 询问 owner 是否获得
    delete ctx.state.localVars[CONFIRM_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: win ? '纵适:是否获得点数较小的拼点牌?' : '纵适:是否获得你的拼点牌?',
      },
      timeout: 30,
    });

    const confirmed = ctx.state.localVars[CONFIRM_KEY] === true;
    delete ctx.state.localVars[CONFIRM_KEY];
    if (!confirmed) return;

    // 牌可能已被其他技能取走(confirm 期间)→ 再次校验
    if (!ctx.state.zones.discardPile.includes(cardToGain)) return;

    // 弃牌堆 → owner 手牌
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: cardToGain,
      from: { zone: '弃牌堆' },
      to: { zone: '手牌', player: ownerId },
    });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '纵适:是否获得拼点牌?',
    },
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
