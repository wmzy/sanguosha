// 铁骑(马超·被动技):当你使用【杀】指定一名角色为目标后,你可以进行一次判定,
// 若结果为红色,该角色不能使用【闪】抵消此【杀】。
//
// 实现(三段式,禁闪横切机制):
//   1. 指定目标 after hook(source===ownerId, card 是杀):
//        询问"是否发动铁骑" → 若发动 → applyAtom(判定)。
//   2. 判定 after hook(judgeType==='铁骑', player===ownerId):
//        读判定牌(结算帧最后一张),红色 → 给目标加标签 '铁骑/禁闪'。
//   3. 询问闪 before hook(source===ownerId 且 target 有 '铁骑/禁闪' 标签):
//        去标签 + cancel(跳过询问闪 → 处理区无闪 → 杀.execute 造成伤害,强制命中)。
//
// 标签生命周期:在阶段1(指定目标)产出,阶段2(询问闪)消费并清除——天然按单次杀结算。
// 杀技能零感知铁骑:它只看处理区有没有闪牌;取消询问闪等价于目标不出闪。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { runJudgeFlow } from '../judge-flow';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';

const TAG = '铁骑/禁闪';
const CONFIRM = '铁骑/confirmed';
const TARGET_VAR = '铁骑/target';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '铁骑',
    description: '使用杀指定目标后可判定,红色则目标不能出闪抵消',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:被询问"是否发动铁骑"时回应,设 localVars 标记结果
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state, _params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不是请求回应';
      if (atom.requestType !== '铁骑/confirm') return '当前不是铁骑确认';
      return null;
    },
    async (state, params) => {
      state.localVars[CONFIRM] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 指定目标 after:自己出杀指定目标 → 询问是否发动 → 判定 ──
  registerAfterHook(state, skill.id, ownerId, '指定目标', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    if (atom.target === undefined) return;
    const target = atom.target;
    // 仅对杀触发(cardId 缺省时容错放过——避免误拦无牌事件)
    if (atom.cardId !== undefined) {
      const card = ctx.state.cardMap[atom.cardId];
      if (card?.name !== '杀') return;
    }
    const targetPlayer = ctx.state.players[target];
    if (!targetPlayer?.alive) return;
    if (ctx.state.zones.deck.length === 0) return; // 无牌可判

    // 询问是否发动铁骑("你可以进行一次判定"——可选)
    delete ctx.state.localVars[CONFIRM];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '铁骑/confirm',
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动铁骑判定?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars[CONFIRM]) return;

    // 记录当前目标,供 判定 after hook 读取
    ctx.state.localVars[TARGET_VAR] = target;
    await runJudgeFlow(ctx.state, ownerId, '铁骑');
  });

  // ── 判定 after:judgeType==='铁骑' → 读花色,红色 → 给目标加禁闪标签 ──
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx) => {
    const atom = ctx.atom;
    if (atom.judgeType !== '铁骑') return;
    if (atom.player !== ownerId) return;
    const target = ctx.state.localVars[TARGET_VAR] as number | undefined;
    delete ctx.state.localVars[TARGET_VAR];
    if (target === undefined) return;
    const targetPlayer = ctx.state.players[target];
    if (!targetPlayer?.alive) return;

    // 读判定牌(判定 atom 的内置 afterHooks 会把它移入弃牌堆,技能 hook 先于其执行)
    const cards = frameCards(ctx.state);
    if (cards.length === 0) return;
    const judgeCardId = cards[cards.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;
    if (judgeCard.color === '红') {
      await applyAtom(ctx.state, { type: '加标签', player: target, tag: TAG });
    }
  });

  // ── 询问闪 before:目标有禁闪标签 → 去标签 + cancel(强制命中) ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      const target = atom.target;
      if (target === undefined) return;
      const player = ctx.state.players[target];
      if (!player?.tags.includes(TAG)) return;
      // 清标签(仅本次杀有效)+ cancel 询问闪 → 处理区无闪 → 造成伤害
      await applyAtom(ctx.state, { type: '去标签', player: target, tag: TAG });
      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '铁骑',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动铁骑判定？',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}
