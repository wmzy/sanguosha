// src/engine/rank-flow.ts
// 拼点两步化编排函数(对齐 出牌流程重设计.md 模块 G / rankcompare.md)。
//
// 将单 atom(拼点)模式升级为「编排函数 + 时机标记 atom」模式(与 runUseFlow /
// runDamageFlow / runDeathFlow / runMoveCardFlow 一致):
//   applyAtom(拼点扣置) → applyAtom(拼点亮出) → 确定结果 → 牌入弃牌堆 → applyAtom(拼点后)
//
// 关键约束(模块 G 范围):
//   - 新增编排函数 runRankCompareFlow + 三时机 atom 定义(拼点扣置/拼点亮出/拼点后)。
//   - 全部拼点主路径(驱虎/界惴恐/天义/烈刃/界巧说/界陷阵)迁移至 runRankCompareFlow;
//     调用方原来自行移动两张牌到处理区,改为不移动——runRankCompareFlow 内部通过
//     拼点扣置 atom 处理移动,实现同时扣置、面朝下。
//   - 酣战/纵适 的拼点后效果 hook 迁移至「拼点后」时机。
//
// 面朝下语义:
//   拼点扣置 的 toViewEvents 对非扣置者隐藏牌面(发起方只看到自己的牌,目标方只看到自己的,
//   其他人两张都看不到)。拼点亮出 向全员公开两张牌面。
//
// 死亡中拼点:
//   扣置与亮出之间不插入任何询问,无死亡窗口。若一方在选牌阶段死亡,调用方应自行检查存活
//   (编排函数前置保证双方手牌中持有拼点牌)。
import type { Card, GameState, Json } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction } from '../core/skill';

/** 拼点/点数牌通用点数:A=1, 2-10=面值, J=11, Q=12, K=13。
 *  各拼点技(天义/驱虎/烈刃/制霸 等)与点数技(界烈弓/界称象/酣战)共用。
 *  card 为 undefined 时返回 0(编排函数前置保证牌存在,此处仅防御)。 */
export function getCardValue(card: Card | undefined): number {
  if (!card) return 0;
  const rank = card.rank;
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  const n = parseInt(rank, 10);
  return Number.isFinite(n) ? n : 0;
}

/** 牌是否黑桃 2~9(闪电命中判定;界鬼道改判收牌同族判定也复用此语义)。 */
export function isSpade2to9(card: Card | undefined): boolean {
  if (card?.suit !== '♠') return false;
  const n = getCardValue(card);
  return n >= 2 && n <= 9;
}

/** 拼点两步化编排函数——对齐 rankcompare.md 四步。
 *
 *  时机1 拼点扣置:双方同时将一张手牌扣置入处理区(面朝下)。
 *    apply 把两张牌从手牌移入处理区;toViewEvents 对非扣置者隐藏牌面。
 *  时机2 拼点亮出:同时亮出(面朝上),向全员公开牌面。
 *  确定结果:initiator 点数严格大于 target = '赢';否则(≤)= '没赢'。
 *  牌入弃牌堆:两张拼点牌 处理区→弃牌堆(在 拼点后 之前——钩子读 discardPile 取牌)。
 *  时机3 拼点后:纯标记,after-hook 触发拼点后效果(酣战获杀/纵适获牌)。
 *
 *  调用方约定:initiatorCard 须在 initiator 手牌中、targetCard 须在 target 手牌中。
 *  返回拼点结果('赢'/'没赢'),供调用方分支结算。 */
export async function runRankCompareFlow(
  state: GameState,
  initiator: number,
  target: number,
  initiatorCard: string,
  targetCard: string,
): Promise<'赢' | '没赢'> {
  // 时机1:同时扣置(面朝下移入处理区)
  await applyAtom(state, {
    type: '拼点扣置',
    initiator,
    target,
    initiatorCard,
    targetCard,
  });

  // 时机2:同时亮出(公开牌面)
  await applyAtom(state, {
    type: '拼点亮出',
    initiator,
    target,
    initiatorCard,
    targetCard,
  });

  // 确定结果(严格大于才算赢,相等算没赢)
  const initVal = getCardValue(state.cardMap[initiatorCard]);
  const targetVal = getCardValue(state.cardMap[targetCard]);
  const result: '赢' | '没赢' = initVal > targetVal ? '赢' : '没赢';

  // 牌入弃牌堆(在 拼点后 之前发出——酣战获杀/纵适获牌 等钩子读 discardPile 取牌,须先入弃牌堆)
  await applyAtom(state, {
    type: '移动牌',
    cardId: initiatorCard,
    from: { zone: '处理区' },
    to: { zone: '弃牌堆' },
  });
  await applyAtom(state, {
    type: '移动牌',
    cardId: targetCard,
    from: { zone: '处理区' },
    to: { zone: '弃牌堆' },
  });

  // 时机3:拼点后(after-hook 触发拼点后效果:酣战获杀/纵适获牌)
  await applyAtom(state, {
    type: '拼点后',
    initiator,
    target,
    initiatorCard,
    targetCard,
    result,
  });

  return result;
}

// ─── 拼点询问仪式封装(天义/界巧说/界陷阵/驱虎/烈刃/界惴恐/制霸/界制霸 共用) ───
//
// 上述技能原先各自手写同一套 25-40 行仪式:
//   delete localVars[KEY] → applyAtom(请求回应, useCard prompt) → 目标 respond 出拼点牌
//   → 读 localVars → runRankCompareFlow;目标未出牌(超时)时另走兜底分支。
// 超时策略差异参数化保留、不归一:
//   · 天义/界巧说/界陷阵/驱虎/烈刃:目标未出牌 → 发起方拼点牌 手牌→弃牌堆,
//     发起方点数>0 判默认胜(弃权默认胜)→ runRankCompareOrForfeit / askRankCardAndCompare;
//   · 界惴恐:目标未出牌 → 兜底其 hand[0](兜底仍无效则整体中止,不动牌)→ askRankCard 的 fallbackCard;
//   · 制霸/界制霸:被拼点方未出牌 → 发起方拼点牌 处理区→弃牌堆并中止(不比点;
//     两版拼点牌流转走 移动牌 而非 runRankCompareFlow,清理分支留在技能文件)→ 仅共用 askRankCard。

/** askRankCard / registerRankCardRespond 的参数。 */
export interface AskRankCardOptions {
  /** 询问 requestType(respond validate 据此分流,各技能唯一)。 */
  requestType: string;
  /** 回应结果写入/读取的 localVars key(各技能沿用原 key)。 */
  answerKey: string;
  /** 被询问玩家座次。 */
  target: number;
  /** prompt 标题(含技能名前缀)。 */
  title: string;
  /** 超时秒数。 */
  timeout: number;
  /** 超时/回应牌不在手牌时的兜底牌(界惴恐 hand[0];兜底牌也须在手牌中才生效)。 */
  fallbackCard?: string;
}

/** 询问一名玩家出拼点牌并读取其回应。
 *  内部:delete localVars[answerKey] → 请求回应(useCard prompt) → 读回应 → delete。
 *  返回回应牌 id;回应牌不在其手牌中(含超时未回应)时回落 fallbackCard,
 *  兜底牌也不在手牌中则返回 undefined(调用方自行中止或走超时分支)。 */
export async function askRankCard(
  state: GameState,
  opts: AskRankCardOptions,
): Promise<string | undefined> {
  delete state.localVars[opts.answerKey];
  await applyAtom(state, {
    type: '请求回应',
    requestType: opts.requestType,
    target: opts.target,
    prompt: {
      type: 'useCard',
      title: opts.title,
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
    timeout: opts.timeout,
  });
  const cardId = state.localVars[opts.answerKey] as string | undefined;
  delete state.localVars[opts.answerKey];
  if (cardId && state.players[opts.target].hand.includes(cardId)) return cardId;
  const fallback = opts.fallbackCard;
  if (fallback && state.players[opts.target].hand.includes(fallback)) return fallback;
  return undefined;
}

/** 拼点比点或弃权兜底(目标已应/未应二选一):
 *  目标牌有效(在手牌中)→ runRankCompareFlow,返回发起方是否赢;
 *  目标牌无效(超时未出)→ 发起方拼点牌 手牌→弃牌堆,发起方点数>0 判默认胜出。 */
export async function runRankCompareOrForfeit(
  state: GameState,
  initiator: number,
  target: number,
  initiatorCardId: string,
  targetCardId: string | undefined,
): Promise<boolean> {
  if (targetCardId && state.players[target].hand.includes(targetCardId)) {
    const result = await runRankCompareFlow(state, initiator, target, initiatorCardId, targetCardId);
    return result === '赢';
  }
  // 目标未出牌(超时):清理发起方拼点牌(手牌→弃牌堆),按发起方默认胜出。
  // 拼点规则中一方未出牌视为弃权,按发起方默认胜出(若发起方点数>0)。
  await applyAtom(state, {
    type: '移动牌',
    cardId: initiatorCardId,
    from: { zone: '手牌', player: initiator },
    to: { zone: '弃牌堆' },
  });
  return getCardValue(state.cardMap[initiatorCardId]) > 0;
}

/** 完整拼点仪式(询问 + 比点/弃权兜底):天义/界巧说/界陷阵/驱虎 直接使用。
 *  烈刃 的 结算帧入栈 位置夹在询问与比点之间(atom 序可见,不可挪动),
 *  拆用 askRankCard + runRankCompareOrForfeit。 */
export async function askRankCardAndCompare(
  state: GameState,
  initiator: number,
  target: number,
  initiatorCardId: string,
  opts: Omit<AskRankCardOptions, 'target' | 'fallbackCard'>,
): Promise<boolean> {
  const targetCardId = await askRankCard(state, { ...opts, target });
  return runRankCompareOrForfeit(state, initiator, target, initiatorCardId, targetCardId);
}

/** 为所有玩家注册「出拼点牌」respond action(纯拼点询问技能仪式的一部分:
 *  天义/界巧说/界陷阵 的 respond 只服务本询问,整段 for 循环收编于此)。
 *  validate 严格校验 pending requestType,非本技能拼点询问一律拒绝(无副作用);
 *  respond 与 askRankCard 通过 answerKey 的 localVars 通信。
 *  同一 respond 内分流多种 requestType 的技能(驱虎/烈刃/制霸/界制霸/界惴恐)
 *  不适用本封装,注册仍留在技能文件。 */
export function registerRankCardRespond(
  state: GameState,
  skillId: string,
  opts: { requestType: string; answerKey: string; mismatchError: string },
): void {
  for (const p of state.players) {
    const pid = p.index;
    registerAction(
      state,
      skillId,
      pid,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as unknown as Record<string, unknown>;
        if (atom.type !== '请求回应') return '当前不需要回应';
        const reqType = atom.requestType as string;
        if (reqType !== opts.requestType) return opts.mismatchError;
        if ((atom.target as number) !== pid) return '不是问你的';
        const cardId = params.cardId as string;
        if (typeof cardId !== 'string') return '请选择一张拼点牌';
        if (!st.players[pid].hand.includes(cardId)) return '拼点牌不在手牌中';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return;
        const atom = slot.atom as unknown as Record<string, unknown>;
        if (atom.type !== '请求回应' || (atom.requestType as string) !== opts.requestType) return;
        st.localVars[opts.answerKey] = params.cardId;
      },
    );
  }
}
