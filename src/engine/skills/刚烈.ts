// 刚烈(夏侯惇·被动技):当你受到伤害后,你可以进行一次判定,
// 若结果不为红桃,则伤害来源选择一项:弃置两张手牌,或受到 1 点伤害。
//
// 模式 A(被动触发):after hook 挂在「造成伤害」。
//   造成伤害(target=自己, source 存活) → 判定 → 非红桃 → 来源二选一。
//
// 关键点:
//   - 来源选择需要来源玩家 respond,而刚烈只注册在夏侯惇座次。
//     引擎 dispatch 按 (skillId, message.ownerId, actionType) 精确查 action,
//     因此把 'respond' action 注册到每个座次(以 skillId='刚烈' 隔离,不与他技冲突)。
//   - 判定结果通过「判定」after hook 在判定牌进弃牌堆前捕获花色,存 localVars。
//   - 来源手牌不足两张时只能选择受到伤害(规则 FAQ)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const CONFIRM_REQUEST = '刚烈/confirm';
const CHOOSE_REQUEST = '刚烈/choose';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '刚烈',
    description: '受到伤害后判定,非红桃则来源弃两张手牌或受 1 点伤害',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:伤害来源二选一(弃两张手牌 / 受 1 点伤害)──
  // 注册到每个座次:来源可能是任意玩家,dispatch 按 (skillId, ownerId, actionType) 查。
  // 各座次用独立闭包绑定 seatId;以 skillId='刚烈' 隔离,不与其他技能 respond 冲突。
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const seatId = p.index;
    const isOwner = seatId === ownerId;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, _params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as Record<string, unknown>;
        if (atom['type'] !== '请求回应') return '当前不需要回应';
        const requestType = atom['requestType'] as string;
        if (requestType === CHOOSE_REQUEST) return null; // 来源二选一
        if (isOwner && requestType === CONFIRM_REQUEST) return null; // 是否发动
        return '当前不是刚烈回应';
      },
      async (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        const requestType = (slot?.atom as Record<string, unknown> | undefined)?.['requestType'] as
          | string
          | undefined;
        if (requestType === CONFIRM_REQUEST) {
          st.localVars['刚烈/confirmed'] = params.choice === true;
        } else {
          // CHOOSE_REQUEST: choice=true → 弃两张手牌;choice=false/缺省 → 受 1 点伤害
          st.localVars['刚烈/choice'] = params.choice === true ? 'discard' : 'damage';
        }
      },
    );
    unloaders.push(u);
  }

  // ── 判定 after hook:捕获判定牌花色(判定牌进弃牌堆前)──
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '判定') return;
    if (atom.judgeType !== '刚烈') return;
    if (atom.player !== ownerId) return;
    const processing = frameCards(ctx.state);
    if (processing.length === 0) return;
    const judgeCardId = processing[processing.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;
    ctx.state.localVars['刚烈/judgeSuit'] = judgeCard.suit;
  });

  // ── 造成伤害 after hook:刚烈主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (atom.source === undefined || atom.source === ownerId) return;
    const sourceIdx = atom.source;
    const sourcePlayer = ctx.state.players[sourceIdx];
    if (!sourcePlayer?.alive) return; // 来源必须存活(FAQ)

    // 判定(牌堆空则跳过——无法判定则刚烈不触发)
    if (ctx.state.zones.deck.length === 0) return;

    // 询问是否发动刚烈(不是锁定技,可选择不发动)
    delete ctx.state.localVars['刚烈/confirmed'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_REQUEST,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动刚烈?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars['刚烈/confirmed']) return; // 不发动

    delete ctx.state.localVars['刚烈/judgeSuit'];
    await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '刚烈' });
    const suit = ctx.state.localVars['刚烈/judgeSuit'] as string | undefined;
    if (suit === undefined) return; // 判定未产出牌
    if (suit === '♥') return; // 红桃:无事发生

    // 非红桃:来源二选一。手牌不足两张 → 只能受到伤害(FAQ)。
    const canDiscard = ctx.state.players[sourceIdx].hand.length >= 2;
    if (canDiscard) {
      delete ctx.state.localVars['刚烈/choice'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CHOOSE_REQUEST,
        target: sourceIdx,
        prompt: {
          type: 'confirm',
          title: '刚烈:弃置两张手牌,或受到 1 点伤害?',
          confirmLabel: '弃两张手牌',
          cancelLabel: '受 1 点伤害',
        },
        defaultChoice: false,
        timeout: 30,
      });
      const choice = ctx.state.localVars['刚烈/choice'] as string | undefined;
      if (choice === 'discard') {
        const hand = [...ctx.state.players[sourceIdx].hand];
        await applyAtom(ctx.state, { type: '弃置', player: sourceIdx, cardIds: hand.slice(0, 2) });
        return;
      }
    }
    // 受到 1 点伤害(来源为夏侯惇本人)
    await applyAtom(ctx.state, {
      type: '造成伤害',
      target: sourceIdx,
      amount: 1,
      source: ownerId,
    });
  });

  return () => {
    unloaders.forEach((u) => u());
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '刚烈',
    style: 'danger',
    prompt: {
      type: 'confirm',
      title: '刚烈:弃置两张手牌,或受到 1 点伤害?',
      confirmLabel: '弃两张手牌',
      cancelLabel: '受 1 点伤害',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
