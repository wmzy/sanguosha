// 暴虐(董卓·主公技):其他群雄角色每造成一次伤害后,可进行一次判定,若为黑桃,回复1点体力。
//
// 模式 A(被动触发):两个 after hook。
//   1. 造成伤害 after:其他群雄角色(source≠董卓 + faction=群)造成伤害 → 询问董卓是否判定
//   2. 判定 after:暴虐判定(judgeType='暴虐')→ 黑桃 → 回复1点体力
//
// 关键点:
//   - 仅主公董卓可用(identity==='主公');非主公时 hook 注册但不触发
//   - "其他群雄角色":source≠自己 + source.faction==='群'
//   - 系统伤害(source<0,如闪电)不触发
//   - 黑桃 = ♠
//   - 判定牌在 frame.cards 末尾(判定 atom 自身 afterHooks 移入弃牌堆之前读取)
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

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

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:董卓回应是否发动暴虐判定 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s: GameState, _params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== CONFIRM_RT) return '当前不是暴虐确认';
      return null;
    },
    async (s: GameState, params: Record<string, Json>) => {
      s.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 造成伤害 after:其他群雄角色造成伤害 → 询问董卓是否判定 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; source?: number };
    if (atom.type !== '造成伤害') return;

    // 仅主公董卓可用
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    if (self.identity !== '主公') return;

    const sourceIdx = atom.source;
    if (typeof sourceIdx !== 'number') return;
    if (sourceIdx === ownerId) return; // 自己造成的伤害不触发
    if (sourceIdx < 0) return; // 系统伤害(闪电等)不触发

    const source = ctx.state.players[sourceIdx];
    if (!source?.alive) return;
    if (source.faction !== '群') return; // 仅群雄角色

    // 询问是否判定
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `暴虐:${source.name} 造成伤害,是否进行判定?(黑桃回复1点体力)`,
        confirmLabel: '判定',
        cancelLabel: '不判定',
      },
      defaultChoice: false,
      timeout: 10,
    });

    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    // 进行判定
    await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '暴虐' });
  });

  // ── 判定 after:暴虐判定 → 黑桃 → 回复1点体力 ──
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; judgeType?: string; player?: number };
    if (atom.type !== '判定') return;
    if (atom.judgeType !== '暴虐') return;
    if (atom.player !== ownerId) return;

    // 读判定牌(在判定 atom.afterHooks 把它移入弃牌堆之前)
    const processing = frameCards(ctx.state);
    if (processing.length === 0) return;
    const judgeCardId = processing[processing.length - 1];
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
