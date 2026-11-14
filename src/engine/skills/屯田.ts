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
//   - 判定结果在「判定牌生效后」hook 中捕获花色(判定牌在 frameCards 末尾,
//     在 runJudgeFlow 收尾把它移入弃牌堆之前)
//   - 非红桃时:经「收取判定牌」atom 把判定牌收作"田"(移出处理区、记入 marks,视图同步
//     投影),再加田标记。runJudgeFlow 收尾按 id 找不到该牌即为 no-op。
//
// 标/界共享:respond 注册、「判定牌生效后」hook、询问+判定核心、回合外失去牌 hook
//   (获得/移动牌/给予)均由本文件导出,界屯田.ts 导入复用;两版真实差异只有
//   ①询问 requestType 前缀(屯田/confirm ↔ 界屯田/confirm)②询问标题③弃置路径触发条件。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply'
import { runJudgeFlow, currentJudgeCardId } from '../flows/judge';
import { registerAfterHook } from '../core/skill';
import { DISTANCE_ATTACK_MOD_KEY } from '../rules/vars-keys';
import { askConfirm, defineConfirmAction, registerConfirmRespond } from '../util/skillRuntime';

const CONFIRM_RT = '屯田/confirm';
const CONFIRMED_KEY = '屯田/confirmed';
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
    state.players[player].vars[DISTANCE_ATTACK_MOD_KEY] = count;
  } else {
    delete state.players[player].vars[DISTANCE_ATTACK_MOD_KEY];
  }
}

// ── 标/界屯田共享(界屯田.ts 导入复用) ─────────────────────────

/** respond 动作:邓艾回应是否发动屯田(confirmRt 区分标/界询问来源) */
export function registerTunTianConfirmRespond(
  state: GameState,
  skillId: string,
  ownerId: number,
  confirmRt: string,
): void {
  // 错误文案与原手写校验逐字一致:无 slot/非 请求回应 → '当前不需要回应',
  // requestType 不匹配 → '当前不是屯田确认'(requireRequestType 默认值同源)。
  registerConfirmRespond(state, skillId, ownerId, confirmRt, CONFIRMED_KEY, {
    mismatchError: '当前不是屯田确认',
  });
}

/**
 * 「判定牌生效后」hook:在 runJudgeFlow 收尾(将判定牌移入弃牌堆)之前运行。
 * 捕获花色,非红桃时经「收取判定牌」atom 收走判定牌(作为田)+ 加标记 + 更新距离修正。
 */
export function registerTianJudgeAfterHook(
  state: GameState,
  skillId: string,
  ownerId: number,
): void {
  registerAfterHook(state, skillId, ownerId, '判定牌生效后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    if (atom.judgeType !== '屯田') return;
    // 必须由 askAndJudgeTunTian 预设 CONFIRMED_KEY(玩家已选择发动)
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    const judgeCardId = currentJudgeCardId(ctx.state);
    if (!judgeCardId) return;
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    // 判定牌仅保留于私有本次判定 scope,不写 localVars。
    // 红桃:不拿(让 runJudgeFlow 收尾的 cleanupJudgeCard 把判定牌正常移入弃牌堆)
    if (judgeCard.suit === '♥') return;

    // 非红桃:把判定牌收作"田"(防止 runJudgeFlow 收尾把它移入弃牌堆)。
    // 走「收取判定牌」atom —— 直接 mutate frame.cards 漏掉视图投影,前端处理区会一直
    // 显示这张已被收走的判定牌。
    await applyAtom(ctx.state, { type: '收取判定牌', player: ownerId, cardId: judgeCardId });

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
}

/**
 * 屯田触发核心:询问发动 + 判定(判定后的拿牌/加田在「判定牌生效后」hook 内完成,
 * 此时判定牌仍在 frame.cards)。不做回合判定 —— 标版仅回合外调用,
 * 界版回合内弃置杀路径也调用。
 */
export async function askAndJudgeTunTian(
  ctx: AtomAfterContext,
  ownerId: number,
  confirmRt: string,
  title: string,
): Promise<void> {
  const self = ctx.state.players[ownerId];
  if (!self?.alive) return;
  // 牌堆空:无法判定,跳过
  if (ctx.state.zones.deck.length === 0) return;

  // 询问是否发动(askConfirm 读后不删确认键:下方判定的 after hook 仍要读它)
  const confirmed = await askConfirm(ctx.state, confirmRt, ownerId, {
    confirmedKey: CONFIRMED_KEY,
    title,
    confirmLabel: '发动',
    cancelLabel: '不发动',
    defaultChoice: false,
    timeout: 10,
  });
  if (!confirmed) return;

  // 判定(判定 after hook 会读取 CONFIRMED_KEY 并完成拿牌/加田)
  await runJudgeFlow(ctx.state, ownerId, '屯田');
}

/** 回合外触发(标版行为):必须非自己回合才询问 + 判定 */
export async function triggerTunTianOutOfTurn(
  ctx: AtomAfterContext,
  ownerId: number,
  confirmRt: string,
  title: string,
): Promise<void> {
  if (ctx.state.currentPlayerIndex === ownerId) return;
  await askAndJudgeTunTian(ctx, ownerId, confirmRt, title);
}

/**
 * 注册「回合外失去牌」三条路径的 after hook(获得/移动牌/给予)。
 * 弃置路径标/界行为不同(界版回合内弃杀也触发),由各文件自行注册。
 */
export function registerTunTianLossHooks(
  state: GameState,
  skillId: string,
  ownerId: number,
  confirmRt: string,
  titleFor: (lossAtomType: string) => string,
): void {
  // ── 获得 after:有人从邓艾处获得牌(被顺/被借/反馈等) ──
  registerAfterHook(state, skillId, ownerId, '获得', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '获得') return;
    if (atom.from !== ownerId) return; // 来自邓艾的牌才算"失去"
    if (atom.player === ownerId) return; // 自己获得自己不算失去
    await triggerTunTianOutOfTurn(ctx, ownerId, confirmRt, titleFor('获得'));
  });

  // ── 移动牌 after:邓艾的牌被移走(过河拆桥/拼点/打出等) ──
  registerAfterHook(state, skillId, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '移动牌') return;
    // from 是邓艾的手牌区
    if (atom.from.zone !== '手牌') return;
    if (atom.from.player !== ownerId) return;
    // 移到自己手牌不算失去(理论上 from===to 同一玩家不可能)
    if (atom.to.zone === '手牌' && atom.to.player === ownerId) return;
    await triggerTunTianOutOfTurn(ctx, ownerId, confirmRt, titleFor('移动牌'));
  });

  // ── 给予 after:邓艾给他人牌(求援/好施等给予路径,回合外失去牌) ──
  //   给予 atom(手牌→手牌)是「失去牌」的独立路径(连营亦挂此 hook)。
  //   与 获得/移动牌/弃置 互不重叠(给予.afterApply 只发 移动到目标区域后,不发这三者)。
  registerAfterHook(state, skillId, ownerId, '给予', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '给予') return;
    if (atom.from !== ownerId) return; // 邓艾给出的牌才算"失去"
    if (atom.to === ownerId) return; // 给自己不算失去
    await triggerTunTianOutOfTurn(ctx, ownerId, confirmRt, titleFor('给予'));
  });
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  const title = (lossAtomType: string) =>
    `是否发动屯田?(回合外因${lossAtomType}失去牌,判定可能获得田)`;

  // ── respond:邓艾回应是否发动屯田 ──
  registerTunTianConfirmRespond(state, skill.id, ownerId, CONFIRM_RT);

  // ── 判定牌生效后 hook(标/界共用) ──
  registerTianJudgeAfterHook(state, skill.id, ownerId);

  // ── 回合外失去牌路径(获得/移动牌/给予):询问发动 + 判定 ──
  //   判定后的拿牌/加田在「判定牌生效后」时机钩子内完成(此时判定牌仍在 frame.cards)
  registerTunTianLossHooks(state, skill.id, ownerId, CONFIRM_RT, title);

  // ── 弃置 after:邓艾被弃牌(借刀杀人等回合外弃置路径) ──
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '弃置') return;
    if (atom.player !== ownerId) return;
    await triggerTunTianOutOfTurn(ctx, ownerId, CONFIRM_RT, title('弃置'));
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  defineConfirmAction(api, 'respond', {
    label: '屯田',
    title: '是否发动屯田?',
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
