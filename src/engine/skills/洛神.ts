// src/engine/skills/洛神.ts
// 洛神(甄姬·被动技):准备阶段,你可以进行一次判定,若结果为黑色,
// 你可以获得此判定牌,并重复此流程。
//
// 流程:
//   阶段开始(准备) after-hook → 询问是否发动 → 循环:
//     判定 → 判定 after-hook 读判定牌花色并存 localVars →
//     黑色:把判定牌从弃牌堆移到手牌(获得)→ 询问是否继续 → 继续:重复 / 停止:退出
//     红色:退出循环
//
// 判定牌时序:判定 atom 的 skill after-hooks 在 def.afterHooks(把判定牌移入弃牌堆)之前跑。
// 因此洛神的 判定 after-hook 读 frameCards(此时判定牌还在处理区);随后 def.afterHooks 把
// 判定牌移入弃牌堆。洛神主循环在 applyAtom(判定) 返回后,从弃牌堆顶读判定牌。
import type { FrontendAPI, Skill, GameState, Card } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '洛神',
    description: '准备阶段判定:黑色获得判定牌并重复,直到红色或停止',
  };
}

/** 判定牌是否为黑色(黑桃 ♠ 或梅花 ♣) */
function isBlack(card: Card | undefined): boolean {
  return !!card && (card.suit === '♠' || card.suit === '♣');
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:被询问"是否发动洛神/是否继续"时回应,设 localVars 标记结果
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state, _params) => {
      if (state.pendingSlots.get(ownerId)?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (
        state.pendingSlots.get(ownerId)!.atom as unknown as Record<string, unknown>
      ).requestType as string;
      if (requestType !== '洛神/confirm' && requestType !== '洛神/continue') {
        return '当前不是洛神询问';
      }
      return null;
    },
    async (state, params) => {
      // 两个询问共用 confirmed 标记:发动 confirm + 继续 continue
      state.localVars['洛神/confirmed'] = params.choice === true || params.confirmed === true;
    },
  );

  // 判定 after-hook:读判定牌花色,把结果存 localVars(供主循环消费)
  // 注意:此 hook 在 判定 def.afterHooks(判定牌→弃牌堆)之前运行,判定牌仍在 frameCards
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '判定') return;
    if (atom.player !== ownerId) return;
    if (atom.judgeType !== '洛神') return;

    const processing = frameCards(ctx.state);
    if (processing.length === 0) {
      ctx.state.localVars['洛神/lastResult'] = 'red';
      return;
    }
    const judgeCardId = processing[processing.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    ctx.state.localVars['洛神/lastJudgeCardId'] = judgeCardId;
    ctx.state.localVars['洛神/lastResult'] = isBlack(judgeCard) ? 'black' : 'red';
  });

  // 阶段开始(准备) after-hook:洛神主循环
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '准备') return;
    if (!ctx.state.players[ownerId]?.alive) return;
    if (ctx.state.zones.deck.length === 0) return; // 牌堆空:无法判定

    // 询问是否发动洛神
    delete ctx.state.localVars['洛神/confirmed'];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '洛神/confirm',
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动洛神?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    if (!ctx.state.localVars['洛神/confirmed']) return;

    // 主循环:判定 → 黑色获得 → 询问继续 → 重复
    let keepGoing = true;
    while (keepGoing) {
      if (ctx.state.zones.deck.length === 0) break;
      // 判定:判定 atom 把判定牌移入处理区,after-hook 读花色存 localVars,
      // def.afterHooks 把判定牌移入弃牌堆。
      await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '洛神' });

      const result = ctx.state.localVars['洛神/lastResult'];
      const judgeCardId = ctx.state.localVars['洛神/lastJudgeCardId'] as string | undefined;
      delete ctx.state.localVars['洛神/lastResult'];
      delete ctx.state.localVars['洛神/lastJudgeCardId'];

      if (result !== 'black' || !judgeCardId) break; // 红色或异常:退出

      // 获得判定牌:判定牌此刻已在弃牌堆顶(def.afterHooks 已运行)。
      // 用 移动牌 把判定牌从弃牌堆移到手牌。
      await applyAtom(ctx.state, {
        type: '移动牌',
        cardId: judgeCardId,
        from: { zone: '弃牌堆' },
        to: { zone: '手牌', player: ownerId },
      });

      // 询问是否继续
      delete ctx.state.localVars['洛神/confirmed'];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: '洛神/continue',
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '判定为黑色,是否继续洛神?',
          confirmLabel: '继续',
          cancelLabel: '停止',
        },
        defaultChoice: true,
        timeout: 10,
      });
      keepGoing = !!ctx.state.localVars['洛神/confirmed'];
    }
    delete ctx.state.localVars['洛神/confirmed'];
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '洛神',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动洛神?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}
