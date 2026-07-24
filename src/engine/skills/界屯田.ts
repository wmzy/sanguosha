// 界屯田(界邓艾·被动技):当你于回合外失去牌后,或于回合内弃置【杀】后,
//   你可以判定,若不为♥,将判定牌置于武将牌上称为"田";
//   每有一张田,你与其他角色的距离 -1。
//
// 与标版屯田唯一差异:触发条件。
//   标版邓艾:仅"回合外失去牌"触发
//   界邓艾:额外在"回合内弃置杀"时触发(仅弃置杀,其他牌型不触发)
//
// 模式 A(被动触发):after hook 挂在「获得」「移动牌」「弃置」(覆盖失去牌的主要路径)。
//   回合外失去牌 → 判定 → 非红桃 → 加"田"标记 + 更新距离修正。
//   回合内弃置杀 → 同上。
//
// 田的存储:每张田 = 一个 mark,id 形如 `屯田/田:N`,payload.cardId 携带判定牌 id。
//   count = player.marks.filter(m => m.id.startsWith('屯田/田:')).length
//
// 距离修正:每张田使 距离/进攻修正 +1(更新 vars,后端 effectiveDistance 据此生效)。
//
// 关键点:
//   - "回合外"判定:currentPlayerIndex !== ownerId(非自己回合)
//   - "回合内弃置杀"判定:currentPlayerIndex === ownerId 且 弃置 atom.cardIds 含 杀
//   - 失去牌 = 卡牌从自己 hand/equipment/pendingTricks 转移到其他位置
//   - 一次失去事件触发一次判定(不按卡牌数量重复)
//   - 判定结果在「判定」after hook 中捕获花色(判定牌在 frameCards 末尾,
//     在判定 atom 自身 afterHooks 把它移入弃牌堆之前)
//   - 非红桃时:把判定牌从 frame.cards 拿出(直接 mutate——无 atom 支持"置于武将牌上"),
//     再加田标记。判定 atom 后续 afterHooks splice 末尾时,frame 已空,no-op。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { runJudgeFlow } from '../judge-flow';
import { registerAction, registerAfterHook } from '../skill';

const CONFIRM_RT = '屯田/confirm';
const CONFIRMED_KEY = '屯田/confirmed';
const JUDGE_SUIT_KEY = '屯田/judgeSuit';
const JUDGE_CARD_KEY = '屯田/judgeCardId';
const TIAN_PREFIX = '屯田/田:';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界屯田',
    description:
      '回合外失去牌或回合内弃置杀时判定,非红桃则置于武将牌上为田,每张田与其他角色距离 -1',
  };
}

/** 数当前玩家的田数量 */
function tianCount(state: GameState, player: number): number {
  return state.players[player].marks.filter((m) => m.id.startsWith(TIAN_PREFIX)).length;
}

/** 重新计算并写入距离修正 vars(每张田 = -1 距离 = 进攻修正 +1) */
function syncDistanceMod(state: GameState, player: number): void {
  const count = tianCount(state, player);
  if (count > 0) {
    state.players[player].vars['距离/进攻修正'] = count;
  } else {
    delete state.players[player].vars['距离/进攻修正'];
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:界邓艾回应是否发动屯田 ──
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
      if (atom['requestType'] !== CONFIRM_RT) return '当前不是屯田确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 判定 after hook:在 判定.afterHooks(将判定牌移入弃牌堆)之前运行 ──
  //   捕获花色,非红桃时把判定牌从 frame.cards 拿出(作为田)+ 加标记 + 更新距离修正
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '判定') return;
    if (atom.player !== ownerId) return;
    if (atom.judgeType !== '屯田') return;
    // 必须由 maybeTriggerTunTian 预设 CONFIRMED_KEY(玩家已选择发动)
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    const processing = frameCards(ctx.state);
    if (processing.length === 0) return;
    const judgeCardId = processing[processing.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    // 记录花色(供测试/调试观察)
    ctx.state.localVars[JUDGE_SUIT_KEY] = judgeCard.suit;
    ctx.state.localVars[JUDGE_CARD_KEY] = judgeCardId;

    // 红桃:不拿(让 判定.afterHooks 把判定牌正常移入弃牌堆)
    if (judgeCard.suit === '♥') return;

    // 非红桃:把判定牌从 frame.cards 拿出(防止 判定.afterHooks 移入弃牌堆)
    const frame = ctx.state.settlementStack[ctx.state.settlementStack.length - 1];
    if (frame) {
      frame.cards = frame.cards.filter((id) => id !== judgeCardId);
    } else {
      ctx.state.zones.processing = ctx.state.zones.processing.filter(
        (id) => id !== judgeCardId,
      );
    }

    // 加田标记(唯一 id,seq 单调递增避免冲突)
    const tianId = `${TIAN_PREFIX}${ctx.state.seq}`;
    await applyAtom(ctx.state, {
      type: '加标记',
      player: ownerId,
      mark: {
        id: tianId,
        scope: ownerId,
        payload: { cardId: judgeCardId },
      },
    });

    // 更新距离修正(每张田 -1 距离 = 进攻修正 +1)
    syncDistanceMod(ctx.state, ownerId);
  });

  // ── 核心触发逻辑(无回合判定,由调用方决定是否调用)──
  async function performTunTian(ctx: AtomAfterContext, lossAtomType: string): Promise<void> {
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    // 牌堆空:无法判定,跳过
    if (ctx.state.zones.deck.length === 0) return;

    // 询问是否发动
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `是否发动屯田?(因${lossAtomType}失去牌,判定可能获得田)`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    // 判定(判定 after hook 会读取 CONFIRMED_KEY 并完成拿牌/加田)
    delete ctx.state.localVars[JUDGE_SUIT_KEY];
    delete ctx.state.localVars[JUDGE_CARD_KEY];
    await runJudgeFlow(ctx.state, ownerId, '屯田');
    delete ctx.state.localVars[JUDGE_SUIT_KEY];
    delete ctx.state.localVars[JUDGE_CARD_KEY];
  }

  /** 回合外触发(标版行为):currentPlayerIndex !== ownerId */
  async function maybeTriggerTunTian(ctx: AtomAfterContext, lossAtomType: string): Promise<void> {
    if (ctx.state.currentPlayerIndex === ownerId) return;
    await performTunTian(ctx, lossAtomType);
  }

  // ── 获得 after:有人从界邓艾处获得牌(被顺/被借/反馈等)──
  registerAfterHook(state, skill.id, ownerId, '获得', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '获得') return;
    if (atom.from !== ownerId) return; // 来自界邓艾的牌才算"失去"
    if (atom.player === ownerId) return; // 自己获得自己不算失去
    await maybeTriggerTunTian(ctx, '获得');
  });

  // ── 移动牌 after:界邓艾的牌被移走(过河拆桥/拼点/打出等)──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '移动牌') return;
    // from 是界邓艾的手牌区
    if (atom.from.zone !== '手牌') return;
    if (atom.from.player !== ownerId) return;
    // 移到自己手牌不算失去(理论上 from===to 同一玩家不可能)
    if (atom.to.zone === '手牌' && atom.to.player === ownerId) return;
    await maybeTriggerTunTian(ctx, '移动牌');
  });

  // ── 弃置 after:界邓艾被弃牌 ──
  //   界版变化:回合内弃置杀时也触发(标版仅回合外)
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '弃置') return;
    if (atom.player !== ownerId) return;

    const isMyTurn = ctx.state.currentPlayerIndex === ownerId;
    if (isMyTurn) {
      // 界版:回合内仅当弃置的牌含【杀】时触发
      const cardIds = atom.cardIds ?? [];
      const hasSha = cardIds.some((id) => ctx.state.cardMap[id]?.name === '杀');
      if (!hasSha) return;
      await performTunTian(ctx, '回合内弃置杀');
    } else {
      // 标版:回合外任何弃置都触发
      await maybeTriggerTunTian(ctx, '弃置');
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界屯田',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动屯田?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
