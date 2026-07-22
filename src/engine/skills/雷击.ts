// 雷击(张角·被动触发):当你使用或打出【闪】时,可令一名其他角色判定,
// 若结果为黑桃,你对其造成2点雷电伤害;若结果为梅花,你回复1点体力,
// 然后对其造成1点雷电伤害。每张【闪】限一次。
//
// 触发时机:「询问闪」atom 的 after hook —— 仅当张角(target=ownerId)被询问闪
//   且实际打出了闪(手牌中的闪移入处理区)。
//   - 询问闪 pending resolve 后,技能 after hook 执行(此时询问闪 slot 已清理,
//     可安全为张角创建新的 请求回应 slot,无嵌套同座次 pending 冲突)
//   - 检查 frameCards 中是否有张角打出的闪
//   - 有闪 → 询问张角选择判定目标(或放弃)→ 判定(目标)→ 读结果:
//     黑桃 → 造成2点雷电伤害;梅花 → 回复1点体力,然后造成1点雷电伤害
//
// 判定结果读取:判定 atom 的 afterHooks(含鬼道替换)与 atom 自身 afterHooks 都把
//   判定牌移入弃牌堆后,从弃牌堆顶读取最终判定牌(经鬼道替换即为替换牌,未替换即原牌)。
//   鬼道在判定 after hook 内完成替换,先于雷击读取,故"打闪→雷击→鬼道改判为黑桃"链成立。
//
// 已知限制:配合八卦阵判定出的虚拟闪不触发雷击(八卦阵在询问闪 before hook 中 cancel,
//   故询问闪 after hook 不执行)。同鬼才 hook 顺序限制,属引擎判定/取消机制固有局限。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const CHOOSE_RT = '雷击/chooseTarget';
const TARGET_KEY = '雷击/target';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '雷击',
    description: '当你使用或打出【闪】时,可令一名其他角色判定,黑桃则造成2点雷电伤害;梅花则你回复1点体力并对其造成1点雷电伤害',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── respond:张角选择雷击目标(或放弃) ──────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as unknown as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== CHOOSE_RT) return '当前不是雷击选择';
      // 选择目标时校验:存活角色(任意角色,可含自己)
      const target = params.target;
      if (typeof target === 'number') {
        const p = st.players[target];
        if (!p?.alive) return '目标不存在或已死亡';
      }
      // target 为 undefined = 放弃发动(合法)
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const target = params.target;
      st.localVars[TARGET_KEY] = typeof target === 'number' ? target : null;
    },
  );

  // ─── 询问闪 after hook:张角打出闪后触发雷击 ────────────────────
  registerAfterHook(state, skill.id, ownerId, '询问闪', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '询问闪') return;
    if (atom.target !== ownerId) return; // 仅张角被询问闪时触发

    const me = ctx.state.players[ownerId];
    if (!me?.alive) return;

    // 检查张角是否实际打出了闪(手牌→处理区)。frameCards 含本结算帧所有牌;
    // 杀牌也在其中,但只匹配 name==='闪'。
    const cards = frameCards(ctx.state);
    const playedDodge = cards.some((id) => ctx.state.cardMap[id]?.name === '闪');
    if (!playedDodge) return; // 未出闪,不触发

    // 询问张角:是否发动雷击 + 选择判定目标
    delete ctx.state.localVars[TARGET_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CHOOSE_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '雷击:选择一名角色进行判定(或放弃)',
        min: 1,
        max: 1,
        filter: (view, t) => view.players[t]?.alive === true,
      },
      timeout: 20,
    });

    const target = ctx.state.localVars[TARGET_KEY];
    delete ctx.state.localVars[TARGET_KEY];
    if (typeof target !== 'number') return; // 放弃发动

    // 二次校验:目标仍存活
    if (!ctx.state.players[target]?.alive) return;

    // 判定目标(鬼道可在判定 after hook 内替换判定牌)
    await applyAtom(ctx.state, { type: '判定', player: target, judgeType: '雷击' });

    // 读判定结果:判定 atom 的 afterHooks(含鬼道替换)与自身 afterHooks 已把
    // 最终判定牌移入弃牌堆顶。
    const dp = ctx.state.zones.discardPile;
    if (dp.length === 0) return;
    const judgeCardId = dp[dp.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    // 黑桃 → 造成2点雷电伤害(来源=张角本人)
    if (judgeCard.suit === '♠') {
      await applyAtom(ctx.state, {
        type: '造成伤害',
        target,
        amount: 2,
        source: ownerId,
        damageType: '雷电',
      });
    } else if (judgeCard.suit === '♣') {
      // 梅花 → 张角回复1点体力(满血不浪费),然后对其造成1点雷电伤害
      if (me.health < me.maxHealth) {
        await applyAtom(ctx.state, {
          type: '回复体力',
          target: ownerId,
          amount: 1,
        });
      }
      await applyAtom(ctx.state, {
        type: '造成伤害',
        target,
        amount: 1,
        source: ownerId,
        damageType: '雷电',
      });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '雷击',
    style: 'danger',
    prompt: {
      type: 'choosePlayer',
      title: '雷击:选择判定目标(或放弃)',
      min: 1,
      max: 1,
      filter: (view, t) => view.players[t]?.alive === true,
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
