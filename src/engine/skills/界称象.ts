// 界称象(界曹冲·被动技,OL 界限突破官方逐字):
//   "当你受到1点伤害后,你可以亮出牌堆顶四张牌,获得其中任意张点数和不大于13的牌;
//    若获得的牌点数和恰好为13,你下次发动'称象'多亮出一张牌。"
//
// 与标版曹冲 称象 的区别(标版未实现;基于官方描述对比):
//   - 标版(标 曹冲):"当你受到伤害后,你可以亮出牌堆顶四张牌,获得其中任意张点数
//     和不大于13的牌。"——无 "=13 则下次 +1" 加成。
//   - 界版(界 曹冲):增加 "=13 则下次亮出+1 张" 的累加激励;触发时机明示"1点伤害后"
//     (与标版"受到伤害后"一致:每 1 点伤害触发一次)。
//
// 实现要点:
//   - 触发时机:造成伤害 after-hook(target=ownerId, amount>0)。每点伤害触发一次
//     (与遗计/反馈一致;amount=2 则本钩内 for 循环跑两次)。
//   - 亮出张数 N = BASE(4) + player.vars['称象/bonus'](上次=13 时设 1,本实现按
//     "一次性 +1" 语义:每次发动消费 bonus,无论本次是否再次 =13,bonus 起点重置为 0,
//     本次 =13 则再设为 1)。下次发动又从 4 起,=13 再 +1。匹配官方"多亮出一张"的口语语义。
//   - 剩余未选的牌:保持原相对顺序(在被选中的牌被"抽走"后的位置)。
//     实现:玩家选好后,用 整理牌堆 重排牌堆(选中牌置于牌堆顶以保持顺序),
//     再 applyAtom(摸牌, count=选中数量)把它们抽入手牌(走标准摸牌路径,
//     避免直接 移动牌 牌堆→手牌 触发已知视图事件缺失 id/color/type 的 bug)。
//   - 玩家可选 0~N 张:0 张=放弃发动(所有亮出的牌留在牌堆原位,不重排);
//     非 0 张则 sum(ranks) ≤ 13 是硬约束(validate 拒绝超 13 的方案)。sum=13 → 设 bonus=1。
//   - rank 解析:A=1, J=11, Q=12, K=13, 数字牌直接 parse。大小王不存在。
//
// 命名:文件名/loader key 为 '界称象'(避免与未来标版 '称象' 冲突);
//   内部 Skill.name = '称象'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界称象';
const DISPLAY_NAME = '称象';
/** localVars 键:玩家本次选择(被选中亮出牌的 cardId 列表,空数组=放弃发动) */
const SELECTION_KEY = '称象/selection';
/** localVars 键:玩家是否发动(confirm) */
const CONFIRMED_KEY = '称象/confirmed';
/** player.vars 键:下次发动额外亮出的张数(0 或 1)。永久 vars(不被 回合结束 清理)。 */
const BONUS_KEY = '称象/bonus';

/** 基础亮出张数 */
const BASE_REVEAL = 4;
/** 点数上限 */
const RANK_LIMIT = 13;

/** A/J/Q/K → 1/11/12/13;数字直接 parse;其他 → 0(忽略,实际不会发生) */
function rankValue(rank: string | undefined): number {
  if (!rank) return 0;
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  const n = parseInt(rank, 10);
  return Number.isFinite(n) ? n : 0;
}

/** 计算玩家当前亮出加成(默认 0) */
function currentBonus(state: GameState, ownerId: number): number {
  const v = state.players[ownerId]?.vars[BONUS_KEY];
  return typeof v === 'number' ? v : 0;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '受到1点伤害后,亮出牌堆顶4张牌,获得其中点数和≤13的若干张;若点数和恰好为13,下次发动多亮出1张',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:处理 确认发动 + 选牌 两种询问 ──
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
      const rt = atom['requestType'] as string;
      if (rt !== '称象/confirm' && rt !== '称象/select') return '当前不是称象询问';

      if (rt === '称象/select') {
        // 校验:所选 cardIds 必须是亮出牌(prompt.cardIds 静态列表)的子集,
        // 且点数和 ≤ 13(称象硬约束)
        const selectAtom = atom as { prompt?: { cardIds?: string[] } };
        const candidateIds: string[] = selectAtom.prompt?.cardIds ?? [];
        const candidateSet = new Set(candidateIds);
        const chosen = (params.cardIds as string[] | undefined) ?? [];
        const seen = new Set<string>();
        let sum = 0;
        for (const cid of chosen) {
          if (!candidateSet.has(cid)) return '牌不在亮出范围内';
          if (seen.has(cid)) return '存在重复的牌';
          seen.add(cid);
          sum += rankValue(st.cardMap[cid]?.rank);
        }
        if (sum > RANK_LIMIT) return `获得牌点数和(${sum})超过13`;
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as Record<string, unknown>)?.requestType as string;
      if (rt === '称象/confirm') {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === '称象/select') {
        const ids = (params.cardIds as string[] | undefined) ?? [];
        st.localVars[SELECTION_KEY] = ids;
      }
    },
  );

  // ── 造成伤害 after:每点伤害触发一次 ──
  registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    const amount = atom.amount ?? 0;
    if (amount <= 0) return;

    for (let i = 0; i < amount; i++) {
      if (!ctx.state.players[ownerId]?.alive) break;

      // 计算本次亮出张数 N = 4 + bonus(本次消费 bonus,起点删除)
      const bonus = currentBonus(ctx.state, ownerId);
      const revealCount = BASE_REVEAL + bonus;
      delete ctx.state.players[ownerId].vars[BONUS_KEY];

      // 牌堆不足 N 张:仅亮出可用张数;完全空则跳过本次
      const deck = ctx.state.zones.deck;
      if (deck.length === 0) break;
      const n = Math.min(revealCount, deck.length);

      // 亮出牌堆顶 n 张(deck 末尾为顶,与 摸牌 atom 一致)。顺序:top→bottom。
      const revealed: string[] = [];
      for (let k = 0; k < n; k++) revealed.push(deck[deck.length - 1 - k]);

      // 询问是否发动(可选)
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: '称象/confirm',
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `称象:是否亮出牌堆顶 ${n} 张牌并获取点数和≤13的若干张?`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 20,
      });
      if (!ctx.state.localVars[CONFIRMED_KEY]) {
        delete ctx.state.localVars[CONFIRMED_KEY];
        continue;
      }

      // 选牌(可空=放弃获得,但已亮出 → 视为发动后未选牌;剩余牌留在牌堆原位)
      delete ctx.state.localVars[SELECTION_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: '称象/select',
        target: ownerId,
        prompt: {
          type: 'distribute',
          mode: 'select',
          title: '称象:选择点数和≤13的若干张(可不选)',
          cardIds: revealed,
          minTotal: 0,
          maxTotal: n,
        },
        defaultChoice: false,
        timeout: 30,
      });

      const chosen = (ctx.state.localVars[SELECTION_KEY] as string[] | undefined) ?? [];
      delete ctx.state.localVars[CONFIRMED_KEY];
      delete ctx.state.localVars[SELECTION_KEY];

      // 玩家未选牌(放弃获得):牌堆原序保留,不重排
      if (chosen.length === 0) continue;

      // 计算选中牌点数和(用于 =13 判定)
      let sum = 0;
      for (const cid of chosen) {
        sum += rankValue(ctx.state.cardMap[cid]?.rank);
      }

      // 重排牌堆:被选中的牌置于牌堆顶(顶=deck 末尾),未被选中的牌保持原相对顺序
      // newDeck 构造:[...belowRevealed, ...unpickedRevealedBottomFirst, ...chosenReversed]
      //   - belowRevealed:原牌堆中位于亮出区下方的牌(不变)
      //   - unpickedRevealedBottomFirst:亮出区中未被选中的牌,以底→顶顺序追加
      //     (保证与原牌堆中的相对位置一致)
      //   - chosenReversed:被选中的牌,逆序后追加到末尾,使 chosen[0] 位于 deck[L-1]
      //     = 最先被 摸牌 抽出(摸牌用 deck.slice(-count).reverse())
      const deckArr = ctx.state.zones.deck;
      const belowRevealed = deckArr.slice(0, deckArr.length - n);
      const revealedSet = new Set(revealed);
      const chosenSet = new Set(chosen);
      const unpickedRevealedTopFirst: string[] = [];
      for (let k = 0; k < n; k++) {
        const cid = deckArr[deckArr.length - 1 - k]; // top→bottom
        if (revealedSet.has(cid) && !chosenSet.has(cid)) unpickedRevealedTopFirst.push(cid);
      }
      // 反转:以底→顶顺序放置(保证原相对位置不变)
      const unpickedRevealedBottomFirst = [...unpickedRevealedTopFirst].reverse();
      const newDeck = [...belowRevealed, ...unpickedRevealedBottomFirst, ...[...chosen].reverse()];
      await applyAtom(ctx.state, {
        type: '整理牌堆',
        cards: newDeck,
        topCount: chosen.length,
        bottomCount: unpickedRevealedBottomFirst.length,
      });

      // 摸 chosen.length 张(从牌堆顶抽出选中的牌,入手)
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: chosen.length });

      // 点数和恰好 13 → 下次发动 +1
      if (sum === RANK_LIMIT) {
        ctx.state.players[ownerId].vars[BONUS_KEY] = 1;
      }
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动称象?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
