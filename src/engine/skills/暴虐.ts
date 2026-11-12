// 暴虐(董卓·主公技):其他群雄角色每造成一次伤害后,可进行一次判定,若为黑桃,回复1点体力。
//
// 模式 A(被动触发):两个 after hook。
//   1. 造成伤害 after:其他群雄角色(source≠董卓 + faction=群)造成伤害 → 询问董卓是否判定
//   2. 判定牌生效后:暴虐判定(judgeType='暴虐')→ 黑桃 → 回复1点体力
//
// 标/界共享:respond 注册、「造成伤害后」守卫+确认询问均由本文件导出,界暴虐.ts 导入
//   复用;两版真实差异只有 ①询问 requestType 前缀(暴虐/confirm ↔ 界暴虐/confirm)
//   ②伤害量谓词(标版 amount>0,界版 amount===1)③询问标题④黑桃结算(界版额外获得判定牌)。
//
// 关键点:
//   - 仅主公董卓可用(identity==='主公');非主公时 hook 注册但不触发
//   - "其他群雄角色":source≠自己 + source.faction==='群'
//   - 系统伤害(source<0,如闪电)不触发
//   - 黑桃 = ♠
//   - 判定牌在 frame.cards 末尾(判定牌生效后时仍在结算帧牌区顶,runJudgeFlow 收尾后才入弃牌堆)
import type { AtomAfterContext, AtomOfName, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply'
import { runJudgeFlow, currentJudgeCardId } from '../flows/judge';
import { registerAction, registerAfterHook } from '../core/skill';

const CONFIRM_RT = '暴虐/confirm';
const CONFIRMED_KEY = '暴虐/confirmed';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '暴虐',
    description: '主公技:其他群雄角色造成伤害后,可判定,黑桃则回复1点体力',
  };
}

// ── 标/界暴虐共享(界暴虐.ts 导入复用) ─────────────────────────

/** respond 动作:董卓回应是否发动暴虐判定(confirmRt 区分标/界询问来源) */
export function registerTyrannyConfirmRespond(
  state: GameState,
  skillId: string,
  ownerId: number,
  confirmRt: string,
): void {
  registerAction(
    state,
    skillId,
    ownerId,
    'respond',
    (s: GameState, _params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== confirmRt) return '当前不是暴虐确认';
      return null;
    },
    async (s: GameState, params: Record<string, Json>) => {
      s.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );
}

/**
 * 「造成伤害后」通用前半:主公/存活守卫 → 伤害量谓词(标版 amount>0,界版 amount===1,
 * 调用方求值传入)→ 其他群雄 source 守卫 → 确认询问。返回玩家是否确认进行判定;
 * 询问标题由 titleFor 收 source 名构造。
 */
export async function askTyrannyJudgeAfterDamage(
  ctx: AtomAfterContext<AtomOfName<'造成伤害后'>>,
  ownerId: number,
  confirmRt: string,
  titleFor: (sourceName: string) => string,
  amountMatches: boolean,
): Promise<boolean> {
  // 仅主公董卓可用
  const self = ctx.state.players[ownerId];
  if (!self?.alive) return false;
  if (self.identity !== '主公') return false;

  if (!amountMatches) return false;

  const sourceIdx = ctx.atom.source;
  if (typeof sourceIdx !== 'number') return false;
  if (sourceIdx === ownerId) return false; // 自己造成的伤害不触发
  if (sourceIdx < 0) return false; // 系统伤害(闪电等)不触发

  const source = ctx.state.players[sourceIdx];
  if (!source?.alive) return false;
  if (source.faction !== '群') return false; // 仅群雄角色

  // 询问是否判定
  delete ctx.state.localVars[CONFIRMED_KEY];
  await applyAtom(ctx.state, {
    type: '请求回应',
    requestType: confirmRt,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: titleFor(source.name),
      confirmLabel: '判定',
      cancelLabel: '不判定',
    },
    defaultChoice: false,
    timeout: 10,
  });

  return ctx.state.localVars[CONFIRMED_KEY] === true;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:董卓回应是否发动暴虐判定 ──
  registerTyrannyConfirmRespond(state, skill.id, ownerId, CONFIRM_RT);

  // ── 造成伤害 after:其他群雄角色造成伤害 → 询问董卓是否判定 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害后', async (ctx) => {
    // 造成伤害后:仅当实际造成伤害时触发(amount>0)。
    // 时机5 atom 在扣减体力块之外,amount 被减伤技能修正为 0(非 cancel)时仍会发出,
    // 需显式过滤,否则会在 0 伤害事件误触发(同狂骨/烈刃)。
    const confirmed = await askTyrannyJudgeAfterDamage(
      ctx,
      ownerId,
      CONFIRM_RT,
      (sourceName) => `暴虐:${sourceName} 造成伤害,是否进行判定?(黑桃回复1点体力)`,
      (ctx.atom.amount ?? 0) > 0,
    );
    if (!confirmed) return;

    // 进行判定
    await runJudgeFlow(ctx.state, ownerId, '暴虐');
  });

  // ── 判定牌生效后:暴虐判定 → 黑桃 → 回复1点体力 ──
  registerAfterHook(state, skill.id, ownerId, '判定牌生效后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.judgeType !== '暴虐') return;
    if (atom.player !== ownerId) return;

    // 读判定牌(判定牌生效后,仍在结算帧牌区顶,runJudgeFlow 收尾才入弃牌堆)
    const judgeCardId = currentJudgeCardId(ctx.state);
    if (!judgeCardId) return;
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    // 非黑桃不回复
    if (judgeCard.suit !== '♠') return;

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '暴虐',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动暴虐?(判定,黑桃回复1点体力)',
      confirmLabel: '判定',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
