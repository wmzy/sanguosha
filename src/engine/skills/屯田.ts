// 屯田(邓艾·被动技):每次当你于回合外失去牌时,可进行一次判定,
//   将非红桃的判定牌置于你的武将牌上,称为"田";每有一张田,你与其他角色的距离 -1。
//
// 模式 A(被动触发):after hook 挂在「获得」「移动牌」「弃置」(覆盖回合外失去牌的主要路径)。
//   回合外失去牌 → 判定 → 非红桃 → 加"田"标记 + 更新距离修正。
//
// 田的存储:每张田 = 一个 mark,id 形如 `屯田/田:N`,payload.cardId 携带判定牌 id。
//   count = player.marks.filter(m => m.id.startsWith('屯田/田:')).length
//
// 距离修正:每张田使 距离/进攻修正 +1(更新 vars,后端 effectiveDistance 据此生效)。
//   view 同步:加田时通过「加标记」atom 的 distanceVars 通道同步 view.distanceVars
//   (与 装备/添加技能 的 distanceVars 通道一致),前后端一致。
//
// 关键点:
//   - "回合外"判定:currentPlayerIndex !== ownerId(非自己回合)
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
    name: '屯田',
    description: '回合外失去牌时判定,非红桃则置于武将牌上为田,每张田与其他角色距离 -1',
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

  // ── respond:邓艾回应是否发动屯田 ──
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

    // 预计算加田后的田数量(atom apply 前尚无新田,故 +1)
    const newCount = tianCount(ctx.state, ownerId) + 1;

    // 加田标记 + 同步距离修正 view(distanceVars 通道)
    const tianId = `${TIAN_PREFIX}${ctx.state.seq}`;
    await applyAtom(ctx.state, {
      type: '加标记',
      player: ownerId,
      mark: {
        id: tianId,
        scope: ownerId,
        payload: { cardId: judgeCardId },
      },
      distanceVars: { attackMod: newCount },
    });

    // 后端 vars 同步(effectiveDistance 读取)
    syncDistanceMod(ctx.state, ownerId);
  });

  // ── 通用触发:回合外失去牌时,询问发动 + 判定 ──
  //   判定后的拿牌/加田在「判定」after hook 内完成(此时判定牌仍在 frame.cards)
  async function maybeTriggerTunTian(ctx: AtomAfterContext, lossAtomType: string): Promise<void> {
    // 必须非自己回合
    if (ctx.state.currentPlayerIndex === ownerId) return;
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
        title: `是否发动屯田?(回合外因${lossAtomType}失去牌,判定可能获得田)`,
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

  // ── 获得 after:有人从邓艾处获得牌(被顺/被借/反馈等) ──
  registerAfterHook(state, skill.id, ownerId, '获得', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '获得') return;
    if (atom.from !== ownerId) return; // 来自邓艾的牌才算"失去"
    if (atom.player === ownerId) return; // 自己获得自己不算失去
    await maybeTriggerTunTian(ctx, '获得');
  });

  // ── 移动牌 after:邓艾的牌被移走(过河拆桥/拼点/打出等) ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '移动牌') return;
    // from 是邓艾的手牌区
    if (atom.from.zone !== '手牌') return;
    if (atom.from.player !== ownerId) return;
    // 移到自己手牌不算失去(理论上 from===to 同一玩家不可能)
    if (atom.to.zone === '手牌' && atom.to.player === ownerId) return;
    await maybeTriggerTunTian(ctx, '移动牌');
  });

  // ── 弃置 after:邓艾被弃牌(借刀杀人等回合外弃置路径) ──
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '弃置') return;
    if (atom.player !== ownerId) return;
    await maybeTriggerTunTian(ctx, '弃置');
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '屯田',
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
