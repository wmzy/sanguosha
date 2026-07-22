// 界悲歌(界蔡文姬·被动技):当一名角色受到【杀】造成的伤害后,
// 若你有牌,你可以令其判定,然后你可以弃置一张牌,根据判定结果执行:
//   ♥ 受伤角色回复 1 点体力
//   ♦ 受伤角色摸两张牌
//   ♣ 伤害来源弃置两张牌
//   ♠ 伤害来源将其武将牌翻面
// 若判定牌与你弃置的牌:花色相同,你获得判定牌;点数相同,你获得你弃置的牌。
//
// 与标版区别(本界版独立实现):
//   1. 顺序:标版=先弃(代价)后判;界版=先判后弃(弃为可选增益,触发"花色/点数相同"奖励)。
//   2. 弃牌可选:标版必须弃才发动;界版判定是免费的,弃牌纯粹为了触发奖励。
//   3. 新增奖励:判定牌与弃置牌花色相同 → 获得判定牌;点数相同 → 获得弃置的牌。
//
// 模式 A(被动触发):after hook 挂在「造成伤害」。
//   造成伤害(cardId 为「杀」,amount>0,任一角色受伤) →
//   询问是否发动 → 判定(受伤角色) → 询问是否弃一张牌(可选) → 若弃则 弃置 代价 →
//   按花色执行 → 比较判定牌与弃置牌的花色/点数 → 移动牌(弃牌堆→手牌)获得对应牌。
//
// 关键点:
//   - 触发对象是「任一角色」受杀伤害(不限于界蔡文姬本人);界蔡文姬须存活且有手牌
//     ("若你有牌"=有手牌,与标版一致;后续弃牌步骤本身要求手牌)。
//   - 判定牌花色+点数+cardId 经 判定 after-hook(judgeType='界悲歌')捕获,存 localVars。
//   - 判定牌和弃置牌都进弃牌堆后,通过 移动牌(弃牌堆→手牌) 获得(无需延迟拿取——
//     判定 atom 的 def.afterHooks 在技能 after hook 之后才把判定牌入弃牌堆,
//     而本技能的比较/拿取发生在造成伤害 after hook 内,那时判定 atom 早已完整结算)。
//   - ♠ 翻面复用据守/放逐/悲歌的标签+阶段 hook 机制(tag 名独立为 '界悲歌/翻面')。
//   - 界悲歌的非系统 after-hook 先于系统规则濒死检查执行:♥ 回血可在求桃前救活濒死角色。
//   - 无次数限制。
import type {
  Card,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';

const START_RT = '界悲歌/chooseStart';
const DISCARD_RT = '界悲歌/chooseDiscard';
const START_KEY = '界悲歌/start';
const DISCARD_CARD_KEY = '界悲歌/discardCard';
const JUDGE_SUIT_KEY = '界悲歌/judgeSuit';
const JUDGE_RANK_KEY = '界悲歌/judgeRank';
const JUDGE_CARD_KEY = '界悲歌/judgeCardId';
const SKIP_TAG = '界悲歌/翻面';
const SKIP_FLAG = '界悲歌/skipAll';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '悲歌',
    description:
      '受杀伤害后令其判定,可弃一张牌按花色执行;花色同获判定牌,点数同获弃置牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:界蔡文姬在「发动确认」或「弃牌选择」两个询问下共用 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== START_RT && rt !== DISCARD_RT) return '当前不是界悲歌询问';
      // 弃牌询问:若玩家选择弃,须提供合法手牌 cardId
      if (rt === DISCARD_RT) {
        const cardId = params.cardId as string | undefined;
        if (typeof cardId === 'string' && !st.players[ownerId].hand.includes(cardId)) {
          return '牌不在手牌中';
        }
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string }).requestType;
      if (rt === START_RT) {
        // confirm:true=发动;false/undefined=不发动
        st.localVars[START_KEY] = params.choice === true;
      } else if (rt === DISCARD_RT) {
        // cardId 为字符串=弃该牌;undefined=不弃
        st.localVars[DISCARD_CARD_KEY] = params.cardId;
      }
    },
  );

  // ── 判定 after hook:捕获判定牌花色+点数+cardId(判定牌进弃牌堆前)──
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '判定') return;
    if (atom.judgeType !== '界悲歌') return;
    const processing = frameCards(ctx.state);
    if (processing.length === 0) return;
    const judgeCardId = processing[processing.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;
    ctx.state.localVars[JUDGE_SUIT_KEY] = judgeCard.suit;
    ctx.state.localVars[JUDGE_RANK_KEY] = judgeCard.rank;
    ctx.state.localVars[JUDGE_CARD_KEY] = judgeCardId;
  });

  // ── 造成伤害 after hook:界悲歌主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    if ((atom.amount ?? 0) <= 0) return;
    const targetIdx = atom.target;
    if (targetIdx === undefined) return;
    if (!ctx.state.players[targetIdx]?.alive) return;

    // 必须是【杀】造成的伤害(含武圣等转化杀——影子卡 name 仍为 '杀')
    const cardId = atom.cardId;
    if (!cardId) return;
    const dmgCard = ctx.state.cardMap[cardId];
    if (dmgCard?.name !== '杀') return;

    // 界蔡文姬须存活且有手牌("若你有牌"=有手牌,与标版一致)
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    if (self.hand.length === 0) return;

    // 询问是否发动界悲歌(不发动=不判定)
    delete ctx.state.localVars[START_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: START_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '界悲歌:是否令受伤角色判定?',
        confirmLabel: '发动(判定)',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    const start = ctx.state.localVars[START_KEY] === true;
    delete ctx.state.localVars[START_KEY];
    if (!start) return; // 不发动

    // 判定(受伤角色);牌堆空则无法判定,界悲歌效果不触发
    if (ctx.state.zones.deck.length === 0) return;
    delete ctx.state.localVars[JUDGE_SUIT_KEY];
    delete ctx.state.localVars[JUDGE_RANK_KEY];
    delete ctx.state.localVars[JUDGE_CARD_KEY];
    await applyAtom(ctx.state, { type: '判定', player: targetIdx, judgeType: '界悲歌' });
    const suit = ctx.state.localVars[JUDGE_SUIT_KEY] as string | undefined;
    const rank = ctx.state.localVars[JUDGE_RANK_KEY] as string | undefined;
    const judgeCardId = ctx.state.localVars[JUDGE_CARD_KEY] as string | undefined;
    delete ctx.state.localVars[JUDGE_SUIT_KEY];
    delete ctx.state.localVars[JUDGE_RANK_KEY];
    delete ctx.state.localVars[JUDGE_CARD_KEY];
    if (suit === undefined) return;

    const sourceIdx = atom.source;

    // 询问是否弃一张牌(可选,目的是触发"花色/点数相同"奖励)
    let discardCardId: string | undefined;
    if (ctx.state.players[ownerId].hand.length > 0) {
      delete ctx.state.localVars[DISCARD_CARD_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: DISCARD_RT,
        target: ownerId,
        prompt: {
          type: 'useCard',
          title: '界悲歌:是否弃置一张牌?(花色同获判定牌,点数同获弃置牌)',
          cardFilter: { filter: () => true, min: 1, max: 1 },
        },
        timeout: 15,
      });
      discardCardId = ctx.state.localVars[DISCARD_CARD_KEY] as string | undefined;
      delete ctx.state.localVars[DISCARD_CARD_KEY];
      if (typeof discardCardId === 'string') {
        // 弃置代价
        await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [discardCardId] });
      }
    }

    // 按判定花色执行主效果(同标版)
    if (suit === '♥') {
      // 受伤角色回复 1 点体力
      if (ctx.state.players[targetIdx]?.alive) {
        await applyAtom(ctx.state, { type: '回复体力', target: targetIdx, amount: 1 });
      }
    } else if (suit === '♦') {
      // 受伤角色摸两张牌
      await applyAtom(ctx.state, { type: '摸牌', player: targetIdx, count: 2 });
    } else if (suit === '♣') {
      // 伤害来源弃置两张牌(手牌不足则全弃)
      if (sourceIdx === undefined) return;
      const source = ctx.state.players[sourceIdx];
      if (!source?.alive) return;
      const toDiscard = source.hand.slice(0, Math.min(2, source.hand.length));
      if (toDiscard.length > 0) {
        await applyAtom(ctx.state, { type: '弃置', player: sourceIdx, cardIds: toDiscard });
      }
    } else if (suit === '♠') {
      // 伤害来源武将牌翻面
      if (sourceIdx === undefined) return;
      const source = ctx.state.players[sourceIdx];
      if (!source?.alive) return;
      await applyAtom(ctx.state, { type: '加标签', player: sourceIdx, tag: SKIP_TAG });
    }

    // 奖励:若弃置了牌,比较花色/点数获得对应牌(判定牌与弃置牌此时都在弃牌堆)
    if (typeof discardCardId === 'string' && judgeCardId) {
      const judgeCard = ctx.state.cardMap[judgeCardId];
      const discardCard = ctx.state.cardMap[discardCardId];
      if (judgeCard && discardCard) {
        // 花色相同 → 获得判定牌
        if (judgeCard.suit === discardCard.suit) {
          await applyAtom(ctx.state, {
            type: '移动牌',
            cardId: judgeCardId,
            from: { zone: '弃牌堆' },
            to: { zone: '手牌', player: ownerId },
          });
        }
        // 点数相同 → 获得你弃置的牌
        if (judgeCard.rank === discardCard.rank) {
          await applyAtom(ctx.state, {
            type: '移动牌',
            cardId: discardCardId,
            from: { zone: '弃牌堆' },
            to: { zone: '手牌', player: ownerId },
          });
        }
      }
    }
  });

  // ── 阶段开始 before hook:检测翻面标签 → 启动跳过(手法同据守/放逐/悲歌,tag 独立)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      const player = atom.player;
      if (player === undefined) return;
      const p = ctx.state.players[player];
      if (!p) return;

      // 入口:准备阶段开始 + 该玩家有翻面标签 → 启动跳过
      if (atom.phase === '准备' && p.tags.includes(SKIP_TAG)) {
        await applyAtom(ctx.state, { type: '去标签', player, tag: SKIP_TAG });
        ctx.state.localVars[SKIP_FLAG] = player;
        return { kind: 'cancel' };
      }

      // skipAll 标志存在时,取消该玩家所有其他阶段
      if (ctx.state.localVars[SKIP_FLAG] === player) {
        return { kind: 'cancel' };
      }
    },
  );

  // ── 阶段结束 before hook:skipAll → 主动推进回合 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段结束',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段结束') return;
      const player = atom.player;
      if (player === undefined) return;
      if (ctx.state.localVars[SKIP_FLAG] !== player) return;

      delete ctx.state.localVars[SKIP_FLAG];
      await applyAtom(ctx.state, { type: '清过期标记', player });
      await applyAtom(ctx.state, { type: '下一玩家' });
      await applyAtom(ctx.state, { type: '回合结束', player });
      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '悲歌',
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '界悲歌:弃置一张牌(可选)',
      cardFilter: { filter: (_c: Card) => true, min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
