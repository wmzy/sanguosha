// 界铁骑(界马超·被动技,OL 界限突破官方逐字):
//   当你使用【杀】指定目标后,你可以令其本回合非锁定技失效,然后你判定,
//   除非其弃置一张与判定结果花色相同的牌,否则其不能抵消此【杀】。
//
// 与标铁骑 src/engine/skills/铁骑.ts 差异(官方对齐):
//   1. 新增「本回合非锁定技失效」:发动后给目标加 SUPPRESSION_TAG,
//      index.runBeforeHooks/runAfterHooks 据此跳过目标的非锁定技 hook
//      (锁定技与装备技描述含「锁定技/防具:/武器:」标记,不受压制)。
//   2. 「判定后弃同花色牌免闪」:旧版直接 cancel 询问闪强制命中,且只看红/黑色;
//      官方为判定后令目标选弃一张与判定结果同花色(♠/♥/♣/♦)的牌,
//      弃了 → 可正常出闪抵消;没弃/弃不出 → cancel 询问闪强制命中。
//   3. 移除旧版「黑色判定额外摸一张牌」——官方无此增益(实现臆造)。
//
// 指定目标→询问→判定/判定牌生效后读牌 骨架复用标版铁骑导出的 createTieqiSkill 工厂
// (确认键 '铁骑/confirmed'、目标键 '铁骑/target'、judgeType '铁骑' 两版共享);
// 抑制标签(onConfirmed)/花色记录(onJudgeCard)/全座次 respond/附加 hook 经 opts 注入。
//
// SUPPRESSION_TAG 生命周期:发动时加,界马超回合结束 after hook 清。
//   标签由 index 的 hook 过滤器读取,实现「目标非锁定技失效」。
import type { GameState, HookResult } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook, registerBeforeHook } from '../core/skill';
import { registerSuppressionProvider } from '../core/skill-suppression';
import { createTieqiSkill, type TieqiOptions } from './铁骑';

/** 标签:目标本回合非锁定技失效(index.runBeforeHooks/runAfterHooks 读取) */
export const SUPPRESSION_TAG = '界铁骑/非锁定技失效';
const CONFIRM = '铁骑/confirmed';
/** 判定花色按目标隔离存储(多目标杀时各目标的铁骑效果互不干扰) */
const suitKey = (target: number) => `界铁骑/suit/${target}`;
const DISCARD_CARD = '铁骑/discardCard';
const DISCARD_REQUEST = '界铁骑/discard';

const OPTIONS: TieqiOptions = {
  name: '界铁骑',
  description:
    '使用杀指定目标后,可令其本回合非锁定技失效并判定;除非其弃一张与判定结果同花色的牌,否则不能抵消此杀',
  confirmRt: '界铁骑/confirm',
  confirmTitle: '是否发动铁骑(令目标本回合非锁定技失效并判定)?',

  // respond:同一 action 处理两种 requestType ——
  //   '界铁骑/confirm':ownerId 确认是否发动
  //   '界铁骑/discard':目标玩家弃同花色手牌的免闪代价
  // 为所有玩家注册:同一玩家可能在不同时机收到不同 requestType(参考界烈弓模式)。
  registerRespond: (state, skillId, _ownerId) => {
    const unloaders: Array<() => void> = [];
    for (const p of state.players) {
      const pid = p.index;
      unloaders.push(
        registerAction(
          state,
          skillId,
          pid,
          'respond',
          (st: GameState, params: Record<string, unknown>): string | null => {
            const slot = st.pendingSlots.get(pid);
            if (!slot) return '当前不需要回应';
            const atom = slot.atom as { type?: string; requestType?: string };
            if (atom.type !== '请求回应') return '当前不是请求回应';
            if (atom.requestType === '界铁骑/confirm') {
              return null; // 确认型:无需额外校验
            }
            if (atom.requestType === DISCARD_REQUEST) {
              const cardId = params.cardId as string | undefined;
              if (typeof cardId !== 'string') return '请选择一张手牌弃置';
              if (!st.players[pid].hand.includes(cardId)) return '牌不在手牌中';
              // 花色校验:必须与判定花色相同(后端兜底)
              const suit = st.localVars[suitKey(pid)] as string | undefined;
              const card = st.cardMap[cardId];
              if (!suit || !card) return '无法校验花色';
              if (card.suit !== suit) return '花色与判定结果不符';
              return null;
            }
            return '当前不是铁骑回应';
          },
          async (st: GameState, params: Record<string, unknown>) => {
            const slot = st.pendingSlots.get(pid);
            const reqType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
            if (reqType === '界铁骑/confirm') {
              st.localVars[CONFIRM] = params.choice === true || params.confirmed === true;
            } else if (reqType === DISCARD_REQUEST) {
              st.localVars[DISCARD_CARD] = params.cardId as string;
            }
          },
        ),
      );
    }
    return unloaders;
  },

  // 发动后:给目标加非锁定技失效标签(回合结束 after hook 清)
  onConfirmed: async (state, target) => {
    if (!state.players[target]?.tags.includes(SUPPRESSION_TAG)) {
      await applyAtom(state, { type: '加标签', player: target, tag: SUPPRESSION_TAG });
    }
  },

  // 判定牌生效后:记录花色(空花色=转化合成卡,目标无同花色牌可弃→强制命中)
  onJudgeCard: async (state, target, judgeCard) => {
    const suit = judgeCard.suit || '';
    state.localVars[suitKey(target)] = suit;
  },

  extraInit: (state, skillId, ownerId) => {
    const unloaders: Array<() => void> = [];

    // ── 非锁定技失效 provider:目标持有 SUPPRESSION_TAG 时,其非锁定技 hook 被压制 ──
    //   通过 skill-suppression 扩展点注册,避免引擎核心硬编码技能名/标签。
    unloaders.push(
      registerSuppressionProvider(
        state,
        (st, targetOwnerId, _skillId) =>
          st.players[targetOwnerId]?.tags.includes(SUPPRESSION_TAG) === true,
      ),
    );

    // ── 询问闪 before:令目标弃一张同花色手牌,否则 cancel 询问闪(强制命中) ──
    unloaders.push(
      registerBeforeHook(
        state,
        skillId,
        ownerId,
        '询问闪',
        async (ctx): Promise<HookResult | void> => {
          const atom = ctx.atom;
          if (atom.source !== ownerId) return;
          const target = atom.target;
          if (target === undefined) return;

          // 仅对由阶段2(判定)写入的目标花色生效(按目标隔离,多目标杀互不干扰)
          const sKey = suitKey(target);
          const suit = ctx.state.localVars[sKey] as string | undefined;
          if (suit === undefined) return;

          const player = ctx.state.players[target];
          if (!player?.alive) return;

          // 无手牌 / 无同花色牌 → 直接 cancel(强制命中)
          const hasMatching = player.hand.some((id) => ctx.state.cardMap[id]?.suit === suit);
          if (!hasMatching) {
            // 清费本次杀的 localVars
            delete ctx.state.localVars[sKey];
            return { kind: 'cancel' };
          }

          // 请求目标弃一张同花色手牌(sKey 仍需保留供 respond validate 校验)
          delete ctx.state.localVars[DISCARD_CARD];
          await applyAtom(ctx.state, {
            type: '请求回应',
            requestType: DISCARD_REQUEST,
            target,
            prompt: {
              type: 'useCard',
              title: `界铁骑:弃置一张${suit}花色手牌,否则不能出闪抵消此杀`,
              cardFilter: { filter: (c) => c.suit === suit, min: 1, max: 1 },
            },
            timeout: 15,
          });

          // 弃牌询问结束后才清 Localvars(下次杀不再复用)
          delete ctx.state.localVars[sKey];

          const discardCardId = ctx.state.localVars[DISCARD_CARD] as string | undefined;
          delete ctx.state.localVars[DISCARD_CARD];

          if (discardCardId && player.hand.includes(discardCardId)) {
            // 弃了同花色牌 → 正常询问闪(目标仍可出闪抵消)
            await applyAtom(ctx.state, { type: '弃置', player: target, cardIds: [discardCardId] });
            return; // pass → 询问闪正常执行
          }
          // 没弃/超时 → 强制命中
          return { kind: 'cancel' };
        },
      ),
    );

    // ── 回合结束 after:界马超回合结束时清除目标的非锁定技失效标签 ──
    unloaders.push(
      registerAfterHook(state, skillId, ownerId, '回合结束', async (ctx) => {
        const atom = ctx.atom;
        if (atom.player !== ownerId) return; // 仅自己回合结束
        for (const p of ctx.state.players) {
          if (p.tags.includes(SUPPRESSION_TAG)) {
            await applyAtom(ctx.state, { type: '去标签', player: p.index, tag: SUPPRESSION_TAG });
          }
        }
      }),
    );

    return unloaders;
  },
};

export const { createSkill, onInit, onMount } = createTieqiSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
