// 界烈弓(界黄忠·被动技):当你使用【杀】指定目标后,若目标手牌数或体力值不小于你,
//   你可以令其使用【闪】时需先弃置一张手牌,否则此【杀】不可被【闪】响应。
//
// 与原版烈弓差异:原版令目标完全不能出闪(禁闪);界版令目标弃一张手牌才能出闪。
//
// 实现(与铁骑同构的横切禁闪机制):
//   1. 指定目标 after hook(source===ownerId, card 是杀):
//        若 target.health>=owner.health || target.hand.length>=owner.hand.length:
//          询问"是否发动烈弓" → 若发动 → 给目标加标签 '烈弓/弃牌闪'。
//   2. 询问闪 before hook(source===ownerId 且 target 有 '烈弓/弃牌闪' 标签):
//        去标签 + 弃牌询问:
//          · 无手牌 → cancel(等同禁闪)。
//          · 有手牌 → 请求回应(requestType='烈弓/discard',target=目标)令其弃一张手牌:
//            弃了 → pass(正常询问闪,目标可出闪);没弃/超时 → cancel(禁闪)。
//
// 标签生命周期:阶段1(指定目标)产出,阶段2(询问闪)消费并清除——天然按单次杀结算。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';

const TAG_JIE = '烈弓/弃牌闪';
const CONFIRM = '烈弓/confirmed';
const DISCARD_CARD = '烈弓/discardCard';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界烈弓',
    description: '使用杀指定目标时,若目标体力或手牌不小于你,可令其弃一张手牌才能出闪',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:为所有玩家注册(界黄忠的弃牌询问目标可以是任意玩家)。
  // 同一 action 同时处理两种 requestType:
  //   '烈弓/confirm' → 烈弓发动确认(ownerId 回应)
  //   '烈弓/discard' → 弃牌闪代价(目标玩家回应,任意一张手牌)
  for (const p of state.players) {
    const pid = p.index;
    registerAction(
      state,
      skill.id,
      pid,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as { type?: string; requestType?: string };
        if (atom.type !== '请求回应') return '当前不是请求回应';
        if (atom.requestType === '烈弓/confirm') {
          return null; // 确认型:无需额外校验
        }
        if (atom.requestType === '烈弓/discard') {
          const cardId = params.cardId as string | undefined;
          if (typeof cardId !== 'string') return '请选择一张手牌弃置';
          if (!st.players[pid].hand.includes(cardId)) return '牌不在手牌中';
          return null;
        }
        return '当前不是烈弓回应';
      },
      async (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(pid);
        const reqType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
        if (reqType === '烈弓/confirm') {
          st.localVars[CONFIRM] = params.choice === true || params.confirmed === true;
        } else if (reqType === '烈弓/discard') {
          st.localVars[DISCARD_CARD] = params.cardId;
        }
      },
    );
  }

  // ── 指定目标 after:条件满足 → 询问 → 加弃牌闪标签 ──
  registerAfterHook(state, skill.id, ownerId, '指定目标', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { source?: number; target?: number; cardId?: string };
    if (atom.source !== ownerId) return;
    if (atom.target === undefined) return;
    const target = atom.target;
    if (atom.cardId !== undefined) {
      const card = ctx.state.cardMap[atom.cardId];
      if (card?.name !== '杀') return;
    }
    const self = ctx.state.players[ownerId];
    const targetPlayer = ctx.state.players[target];
    if (!self?.alive || !targetPlayer?.alive) return;

    // 发动条件:目标体力值 ≥ 自己,或 目标手牌数 ≥ 自己
    const condMet =
      targetPlayer.health >= self.health || targetPlayer.hand.length >= self.hand.length;
    if (!condMet) return;

    // 询问是否发动烈弓(可选)
    delete ctx.state.localVars[CONFIRM];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '烈弓/confirm',
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动烈弓(令目标弃牌才能出闪)?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars[CONFIRM]) return;

    // 界黄忠加弃牌闪标签
    await applyAtom(ctx.state, {
      type: '加标签',
      player: target,
      tag: TAG_JIE,
    });
  });

  // ── 询问闪 before:目标有弃牌闪标签 → 弃牌或禁闪 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { target?: number; source?: number };
      if (atom.source !== ownerId) return;
      const target = atom.target;
      if (target === undefined) return;
      const player = ctx.state.players[target];
      if (!player) return;

      // ── 界限突破:弃牌闪标签 → 弃牌或禁闪 ──
      if (player.tags.includes(TAG_JIE)) {
        await applyAtom(ctx.state, { type: '去标签', player: target, tag: TAG_JIE });

        // 无手牌 → 禁闪(等同原版效果)
        if (player.hand.length === 0) {
          return { kind: 'cancel' };
        }

        // 有手牌 → 请求弃一张手牌(任意手牌)
        delete ctx.state.localVars[DISCARD_CARD];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: '烈弓/discard',
          target,
          prompt: {
            type: 'useCard',
            title: '烈弓:弃置一张手牌,否则不能出闪抵消此杀',
            cardFilter: { filter: () => true, min: 1, max: 1 },
          },
          timeout: 15,
        });

        const discardCardId = ctx.state.localVars[DISCARD_CARD] as string | undefined;
        delete ctx.state.localVars[DISCARD_CARD];

        if (discardCardId && player.hand.includes(discardCardId)) {
          // 弃了 → 正常询问闪(目标仍可出闪抵消)
          await applyAtom(ctx.state, {
            type: '弃置',
            player: target,
            cardIds: [discardCardId],
          });
          return; // pass → 询问闪正常执行
        }
        // 没弃/超时 → 禁闪
        return { kind: 'cancel' };
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '烈弓',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动烈弓？',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
