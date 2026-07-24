// 界洛神(界甄姬·被动技):准备阶段,你可以进行判定,若结果为黑色,
// 你可以获得此判定牌,并重复此流程。以此法获得的牌本回合不计入手牌上限。
//
// 官方来源(逐字):"准备阶段,你可以判定,若结果为黑色,你获得此牌,
//   然后你可以重复此流程。以此法获得的牌本回合不计入手牌上限。"
//
// 界版相对标版洛神的变化:
//   - 手牌上限豁免:以此法(洛神判定获得)获得的牌,本回合不计入手牌上限。
//     实现方式:每张获得的判定牌 id 记入 turn.vars['界洛神/豁免牌'](随「回合结束」atom
//     自动随 turn.vars 清空,天然"本回合"语义);并注册 hand-limit 覆盖型提供者,
//     在弃牌阶段/弃牌超时统一读取点把仍在手牌中的豁免牌数加进手牌上限。
//
// 流程:
//   阶段开始(准备) after-hook → 询问是否发动 → 循环:
//     判定 → 判定 after-hook 读判定牌花色并存 localVars →
//     黑色:把判定牌从弃牌堆移到手牌(获得,记入豁免牌)→ 询问是否继续 → 继续:重复 / 停止:退出
//     红色:退出循环(官方仅明示黑色获得,红色不获得)
//
// 判定牌时序:判定 atom 的 skill after-hooks 在 def.afterHooks(把判定牌移入弃牌堆)之前跑。
// 因此洛神的 判定 after-hook 读 frameCards(此时判定牌还在处理区);随后 def.afterHooks 把
// 判定牌移入弃牌堆。洛神主循环在 applyAtom(判定) 返回后,从弃牌堆顶读判定牌。
import type { FrontendAPI, Skill, GameState, Card } from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { runJudgeFlow } from '../judge-flow';
import { registerAction, registerAfterHook } from '../skill';
import { registerHandLimitProvider } from '../hand-limit';

/** turn.vars key:本回合经洛神获得的判定牌 id 列表(随「回合结束」自动清空) */
const EXEMPT_VAR = '界洛神/豁免牌';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界洛神',
    description:
      '准备阶段判定:黑色获得判定牌并重复;以此法获得的牌本回合不计入手牌上限',
  };
}

/** 判定牌是否为黑色(黑桃 ♠ 或梅花 ♣) */
function isBlack(card: Card | undefined): boolean {
  return !!card && (card.suit === '♠' || card.suit === '♣');
}

/** 读本回合洛神豁免牌列表(可能为空) */
function readExemptList(state: GameState): string[] {
  const v = state.turn.vars[EXEMPT_VAR];
  return Array.isArray(v) ? (v as string[]) : [];
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

  // ── 手牌上限豁免:以此法获得的牌本回合不计入手牌上限 ──
  // 覆盖型提供者:返回 默认公式(体力+加成) + 仍在手牌中的豁免牌数。
  // 无豁免牌时返回 undefined,交回默认公式/其他提供者(取最宽松)。
  // 弃牌阶段(回合管理.ts)与弃牌超时(请求回应.ts)统一经 handLimit() 读取,自动生效。
  const unloadProvider = registerHandLimitProvider(state, ownerId, (st, player) => {
    if (player !== ownerId) return undefined;
    const exempt = readExemptList(st);
    if (exempt.length === 0) return undefined;
    const hand = st.players[player]?.hand ?? [];
    const inHand = exempt.filter((id) => hand.includes(id)).length;
    if (inHand === 0) return undefined;
    const bonus = (st.turn.vars[`手牌上限/bonus:${player}`] as number | undefined) ?? 0;
    const health = st.players[player]?.health ?? 0;
    return health + bonus + inHand;
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

    // 主循环:判定 → 黑色获得(记入豁免牌)→ 询问继续 → 重复;红色不获得直接停止
    let keepGoing = true;
    while (keepGoing) {
      if (ctx.state.zones.deck.length === 0) break;
      // 判定:判定 atom 把判定牌移入处理区,after-hook 读花色存 localVars,
      // def.afterHooks 把判定牌移入弃牌堆。
      await runJudgeFlow(ctx.state, ownerId, '洛神');

      const result = ctx.state.localVars['洛神/lastResult'];
      const judgeCardId = ctx.state.localVars['洛神/lastJudgeCardId'] as string | undefined;
      delete ctx.state.localVars['洛神/lastResult'];
      delete ctx.state.localVars['洛神/lastJudgeCardId'];

      // 官方仅明示黑色获得;红色停止且不获得
      if (result !== 'black' || !judgeCardId) break;

      // 获得判定牌:判定牌此刻已在弃牌堆顶(def.afterHooks 已运行)。
      // 用 移动牌 把判定牌从弃牌堆移到手牌。
      await applyAtom(ctx.state, {
        type: '移动牌',
        cardId: judgeCardId,
        from: { zone: '弃牌堆' },
        to: { zone: '手牌', player: ownerId },
      });

      // 记入豁免牌:本回合不计入手牌上限
      const list = readExemptList(ctx.state);
      if (!list.includes(judgeCardId)) {
        list.push(judgeCardId);
        ctx.state.turn.vars[EXEMPT_VAR] = list;
      }

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

  return () => {
    unloadProvider();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界洛神',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动洛神?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
