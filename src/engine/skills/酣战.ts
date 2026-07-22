// 酣战(界太史慈·吴·一般技,OL hero/463):
//   "当你拼点前,你可以令对方用随机手牌拼点。当你拼点后,你可以获得拼点牌中
//    点数最大的【杀】。"
//
// 两个独立可选效果,均作用于太史慈(酣战 owner)发起的拼点。太史慈的唯一拼点来源是
// 【天义】(标/界太史慈复用同一 天义.ts),故本技挂钩 天义 的拼点流程:
//
//   1) 拼点前·随机手拼点:before-hook 挂「请求回应」。
//      天义 询问目标出拼点牌时(requestType='天义/拼点', 且为太史慈回合)→ 询问太史慈
//      "是否令对方用随机手牌拼点?"。确认则从目标手牌随机抽一张,写入天义读取的
//      localVars['天义/targetCard'](天义 execute 随后据此把该牌移入处理区),并 cancel
//      该「请求回应」(目标不再被询问)。耦合说明:酣战与天义同属太史慈,localVars 键共享。
//
//   2) 拼点后·获最大点杀:after-hook 挂「拼点」。
//      拼点 atom 结算后(两张拼点牌已入弃牌堆),若其中含【杀】→ 询问太史慈是否获得
//      "两张拼点牌中点数最大的杀"。确认则取点数最大的那张杀,从弃牌堆移入太史慈手牌。
//
// 关键点:
//   - 两个效果相互独立,各自询问;均可放弃。
//   - 拼点发起者=太史慈:由 st.currentPlayerIndex===ownerId 且 requestType='天义/拼点' 判定。
//   - 点数:A=1,2-10=面值,J=11,Q=12,K=13。
//   - 随机手牌用 state.rngSeed 的 createRng,保证可复现。
import type {
  Card,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook, type SkillModule } from '../skill';
import { createRng } from '../../shared/rng';

const TIAN_YI_PD_RT = '天义/拼点'; // 天义询问目标出拼点牌的 requestType
const TIAN_YI_TARGET_CARD_KEY = '天义/targetCard'; // 天义 execute 读取的目标拼点牌 localVars
const FORCE_CONFIRM_RT = '酣战/随机拼点';
const FORCE_KEY = '酣战/forceConfirmed';
const GAIN_CONFIRM_RT = '酣战/获杀';
const GAIN_KEY = '酣战/gainConfirmed';

/** 拼点牌点数:A=1, 2-10=面值, J=11, Q=12, K=13 */
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
    name: '酣战',
    description:
      '拼点前可令对方用随机手牌拼点;拼点后可获得两张拼点牌中点数最大的杀',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:太史慈确认(随机拼点 / 获杀)──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== FORCE_CONFIRM_RT && rt !== GAIN_CONFIRM_RT) return '当前不是酣战询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      const ok = params.choice === true || params.confirmed === true;
      if (rt === FORCE_CONFIRM_RT) st.localVars[FORCE_KEY] = ok;
      else if (rt === GAIN_CONFIRM_RT) st.localVars[GAIN_KEY] = ok;
    },
  );

  // ── 拼点前·随机手牌拼点:before-hook 挂「请求回应」──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '请求回应',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '请求回应') return;
      if (atom.requestType !== TIAN_YI_PD_RT) return;
      // 仅太史慈(酣战 owner)的回合发起的拼点
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const target = atom.target;
      if (typeof target !== 'number') return;
      const targetPlayer = ctx.state.players[target];
      if (!targetPlayer?.alive) return;
      if (targetPlayer.hand.length === 0) return; // 目标无手牌,无法随机
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 询问太史慈是否令对方用随机手牌拼点
      delete ctx.state.localVars[FORCE_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: FORCE_CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '酣战:是否令对方用一张随机手牌拼点?',
          confirmLabel: '随机拼点',
          cancelLabel: '正常拼点',
        },
        defaultChoice: false,
        timeout: 20,
      });
      const confirmed = ctx.state.localVars[FORCE_KEY] as boolean | undefined;
      delete ctx.state.localVars[FORCE_KEY];
      if (!confirmed) return; // 不发动 → 放行正常询问目标

      // 从目标手牌随机抽一张,写入天义读取的 localVars,并 cancel 该询问
      const rng = createRng(ctx.state.rngSeed);
      const hand = ctx.state.players[target].hand;
      const idx = rng.nextInt(hand.length);
      const randomCardId = hand[idx];
      ctx.state.rngSeed = rng.getState();
      ctx.state.localVars[TIAN_YI_TARGET_CARD_KEY] = randomCardId;
      return { kind: 'cancel' };
    },
  );

  // ── 拼点后·获最大点杀:after-hook 挂「拼点」──
  registerAfterHook(state, skill.id, ownerId, '拼点', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '拼点') return;
    if (atom.initiator !== ownerId) return; // 仅太史慈发起的拼点
    const st = ctx.state;
    const self = st.players[ownerId];
    if (!self?.alive) return;

    // 候选:两张拼点牌中的杀
    const candidates: Array<{ id: string; value: number }> = [];
    for (const id of [atom.initiatorCard, atom.targetCard]) {
      if (!id) continue;
      const card: Card | undefined = st.cardMap[id];
      if (card && card.name === '杀') candidates.push({ id, value: rankValue(card.rank) });
    }
    if (candidates.length === 0) return; // 无杀 → 无可获

    // 询问是否获得
    delete st.localVars[GAIN_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: GAIN_CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '酣战:是否获得两张拼点牌中点数最大的杀?',
        confirmLabel: '获得',
        cancelLabel: '不获得',
      },
      defaultChoice: false,
      timeout: 20,
    });
    const confirmed = st.localVars[GAIN_KEY] as boolean | undefined;
    delete st.localVars[GAIN_KEY];
    if (!confirmed) return;

    // 取点数最大的杀(并列取第一张),从弃牌堆移入太史慈手牌
    candidates.sort((a, b) => b.value - a.value);
    const bestId = candidates[0].id;
    if (st.zones.discardPile.includes(bestId)) {
      await applyAtom(st, {
        type: '移动牌',
        cardId: bestId,
        from: { zone: '弃牌堆' },
        to: { zone: '手牌', player: ownerId },
      });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 被动触发(拼点前后),无主动 action
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
