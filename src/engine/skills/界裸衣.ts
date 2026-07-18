// 界裸衣(界许褚·魏·主动技,OL hero/488 官方逐字):
//   "摸牌阶段开始前,你可以亮出牌堆顶的三张牌,然后你可以跳过摸牌阶段并获得
//    其中所有基本牌、武器牌和【决斗】,且直到你的下回合开始,你为伤害来源的
//    【杀】和【决斗】对目标角色造成的伤害+1。"
//
// 与标版裸衣(src/engine/skills/裸衣.ts,不修改)机制完全不同:
//   - 标版:摸牌阶段"少摸一张牌"→ 杀/决斗伤害+1(代价=1张摸牌量)。
//   - 界版:摸牌阶段开始前"亮出3张"(亮牌即触发增伤,与是否跳过无关);
//     可选"跳过摸牌阶段"以获得其中基本/武器/决斗(其余弃置);不跳则原序放回牌堆顶。
//
// 机制:
//   - 阶段开始(摸牌) before-hook(自己回合):询问①是否发动→亮出3张到处理区+挂增伤标签
//     →询问②是否跳过摸牌阶段。跳过→基本/武器/决斗入手+其他弃置+skipPhase 取消默认摸牌;
//     不跳→3张按原序放回牌堆顶(默认摸牌照常进行,增伤标签已挂)。
//   - 造成伤害 before-hook:source=自己 + 增伤标签 + 牌为杀/决斗 → modify(amount+1)。
//   - 回合开始 after-hook:严格在 ownerId 自己的下回合开始时清标签(官方"直到你的下回合开始")。
//   - 限一次/回合:裸衣/usedThisTurn(后缀约定,回合结束 atom 自动清空)。
//   - 内部 localVars/requestType 键名沿用 '裸衣/xxx' 前缀(界版规范)。
//   - 镜像先例:再起/突袭/双雄的「阶段开始(摸牌) before-hook + 询问 + skipPhase」模式。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn } from '../once-per-turn';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';
import { skipPhase } from '../skip-phase';

const BONUS_TAG = '裸衣/bonus';
/** 询问①:是否发动界裸衣(亮牌+增伤) */
const ACTIVATE_RT = '裸衣/activate';
/** 询问②:是否跳过摸牌阶段获得匹配牌 */
const SKIP_RT = '裸衣/skip';
const ACTIVATED_KEY = '裸衣/activated';
const SKIP_KEY = '裸衣/skipChoice';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界裸衣',
    description:
      '摸牌阶段开始前,可亮出牌堆顶3张;可跳过摸牌阶段并获得其中的基本牌/武器牌/决斗,且直到你的下回合开始,杀/决斗伤害+1',
  };
}

/** 界裸衣"可获得"判定:基本牌 / 武器牌(subtype=武器) / 决斗 */
function isTakeable(
  card: { name?: string; type?: string; subtype?: string } | undefined,
): boolean {
  if (!card) return false;
  if (card.name === '决斗') return true;
  if (card.type === '基本牌') return true;
  if (card.type === '装备牌' && card.subtype === '武器') return true;
  return false;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:处理 activate 与 skip 两类 confirm 询问 ──
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
      const rt = atom['requestType'];
      if (rt !== ACTIVATE_RT && rt !== SKIP_RT) return '当前不是界裸衣询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as Record<string, unknown> | undefined)?.['requestType'];
      const yes = params.choice === true || params.confirmed === true;
      if (rt === ACTIVATE_RT) {
        st.localVars[ACTIVATED_KEY] = yes;
      } else if (rt === SKIP_RT) {
        st.localVars[SKIP_KEY] = yes;
      }
    },
  );

  // ── 阶段开始(摸牌) before:亮牌+增伤+可选跳过摸牌获得匹配牌 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '摸牌') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (usedThisTurn(ctx.state, ownerId, '裸衣')) return; // 本回合已发动
      // 牌堆至少 3 张才能亮出;不足则放弃发动,走默认摸牌(摸牌 atom 会自动重洗)
      if (ctx.state.zones.deck.length < 3) return;

      // ── 询问①:是否发动界裸衣(亮牌+增伤,与是否跳过无关)──
      delete ctx.state.localVars[ACTIVATED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: ACTIVATE_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动界裸衣?(亮出牌堆顶3张;直到你的下回合开始,你的杀/决斗伤害+1)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (ctx.state.localVars[ACTIVATED_KEY] !== true) return; // 不发动 → 默认摸牌

      // 标记本回合已用(防 hook 重入;裸衣/usedThisTurn 回合结束自动清)
      await markOncePerTurn(ctx.state, ownerId, '裸衣');

      // ── 亮出+二段询问+清牌 整段在一个结算帧内:buildView 的 zones.processing 真相源
      //     是 settlementStack.flatMap(f=>f.cards),无帧时亮出的牌(state.zones.processing
      //     兜底)在前端 processedView 可见但 buildView 不可见 → 视图不一致。
      //     故亮出期间必须 pushFrame,使 buildView 与 processedView 都从栈顶帧读取。
      const top3 = ctx.state.zones.deck.slice(-3); // [底,中,顶],deck 末尾为顶
      let shouldSkip = false;
      await pushFrame(ctx.state, '界裸衣', ownerId, {});
      try {
        // 亮出牌堆顶3张到处理区(从顶开始倒序移入,玩家先看到顶牌)
        for (let i = top3.length - 1; i >= 0; i--) {
          await applyAtom(ctx.state, {
            type: '移动牌',
            cardId: top3[i],
            from: { zone: '牌堆' },
            to: { zone: '处理区' },
          });
        }

        // 挂增伤标签(发动即生效,与是否跳过摸牌阶段无关)
        await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: BONUS_TAG });

        // ── 询问②:是否跳过摸牌阶段并获得基本/武器/决斗 ──
        delete ctx.state.localVars[SKIP_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: SKIP_RT,
          target: ownerId,
          prompt: {
            type: 'confirm',
            title:
              '界裸衣:是否跳过摸牌阶段并获得亮出牌中的基本牌、武器牌和【决斗】?(其余亮出牌置入弃牌堆)',
            confirmLabel: '跳过并获得',
            cancelLabel: '不跳过',
          },
          defaultChoice: false,
          timeout: 15,
        });

        shouldSkip = ctx.state.localVars[SKIP_KEY] === true;
        if (shouldSkip) {
          // ── 跳过:基本/武器/决斗入手,其他入弃牌堆 ──
          for (const cardId of top3) {
            // 已不在栈顶帧(被其他效果移走)则跳过
            const inProc = ctx.state.zones.processing.includes(cardId);
            const top = ctx.state.settlementStack[ctx.state.settlementStack.length - 1];
            const inFrame = top?.cards.includes(cardId) ?? false;
            if (!inProc && !inFrame) continue;
            const card = ctx.state.cardMap[cardId];
            const take = isTakeable(card);
            await applyAtom(ctx.state, {
              type: '移动牌',
              cardId,
              from: { zone: '处理区' },
              to: take ? { zone: '手牌', player: ownerId } : { zone: '弃牌堆' },
            });
          }
        } else {
          // ── 不跳过:3张按原始顺序放回牌堆顶(顶→底还原)──
          // top3 = [底,中,顶];按原序 push 到 deck 末尾即还原:
          //   push 底 → push 中 → push 顶 → deck=[...,底,中,顶](顶仍为顶)
          for (const cardId of top3) {
            const inProc = ctx.state.zones.processing.includes(cardId);
            const top = ctx.state.settlementStack[ctx.state.settlementStack.length - 1];
            const inFrame = top?.cards.includes(cardId) ?? false;
            if (!inProc && !inFrame) continue;
            await applyAtom(ctx.state, {
              type: '移动牌',
              cardId,
              from: { zone: '处理区' },
              to: { zone: '牌堆' },
            });
          }
        }
      } finally {
        // 帧必须在 skipPhase/cancel 之前 pop:cancel 不会再走 after-hook 清栈
        await popFrame(ctx.state);
      }

      delete ctx.state.localVars[ACTIVATED_KEY];
      delete ctx.state.localVars[SKIP_KEY];

      if (shouldSkip) {
        // 跳过默认摸牌:推进到出牌阶段,并 cancel 本次 阶段开始(摸牌)
        return skipPhase(ctx.state, { player: ownerId, phase: '摸牌' });
      }
      // 不跳过:默认摸牌照常进行(不 cancel,原顶3张会被摸2张)
    },
  );

  // ── 造成伤害 before hook:杀/决斗伤害 +1 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { source?: number; amount?: number; cardId?: string };
      if (atom.source !== ownerId) return;
      if ((atom.amount ?? 0) <= 0) return;
      const self = ctx.state.players[ownerId];
      if (!self?.tags.includes(BONUS_TAG)) return;
      const cardId = atom.cardId;
      if (typeof cardId !== 'string') return;
      const card = ctx.state.cardMap[cardId];
      if (!card) return;
      if (card.name !== '杀' && card.name !== '决斗') return;
      return {
        kind: 'modify',
        atom: { ...ctx.atom, amount: (atom.amount ?? 0) + 1 } as typeof ctx.atom,
      };
    },
  );

  // ── 回合开始 after hook:owner 自己的下回合开始时清增伤标签 ──
  // 严格匹配官方"直到你的下回合开始":仅 owner 自己的回合开始时清,
  // 中间其他玩家回合内 owner 仍可对他人出杀/决斗(响应决斗等)享受增伤。
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { player?: number };
    if (atom.player !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (self?.tags.includes(BONUS_TAG)) {
      await applyAtom(ctx.state, { type: '去标签', player: ownerId, tag: BONUS_TAG });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '界裸衣',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动界裸衣?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return () => {};
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
