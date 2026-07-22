// 悲歌(蔡文姬·被动技):当一名角色受到【杀】造成的伤害后,你可以弃置一张牌,
// 然后令该角色判定,根据判定结果执行效果:
//   ♥ 受伤角色回复 1 点体力
//   ♦ 受伤角色摸两张牌
//   ♣ 伤害来源弃置两张牌
//   ♠ 伤害来源将其武将牌翻面
//
// 模式 A(被动触发):after hook 挂在「造成伤害」。
//   造成伤害(cardId 为「杀」,amount>0,任一角色受伤) → 询问蔡文姬是否弃一张牌发动 →
//   弃置代价 → 判定(受伤角色) → 按花色执行。
//
// 关键点:
//   - 触发对象是「任一角色」受杀伤害(不限于蔡文姬本人);蔡文姬须存活且有手牌作代价。
//   - 判定牌花色经 判定 after-hook(judgeType='悲歌')捕获,存 localVars。
//   - ♠ 翻面复用据守/放逐的标签+阶段 hook 机制(tag 名独立为 '悲歌/翻面')。
//   - 悲歌的非系统 after-hook 先于系统规则濒死检查执行:♥ 回血可在求桃前救活濒死角色。
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

const DISCARD_RT = '悲歌/discard';
const DISCARD_CARD_KEY = '悲歌/discardCard';
const JUDGE_SUIT_KEY = '悲歌/judgeSuit';
const SKIP_TAG = '悲歌/翻面';
const SKIP_FLAG = '悲歌/skipAll';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '悲歌',
    description: '一名角色受到杀伤害后,弃一张牌令其判定:♥回血/♦摸二/♣来源弃二/♠来源翻面',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:蔡文姬选择弃置一张手牌发动悲歌 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== DISCARD_RT) return '当前不是悲歌询问';
      const cardId = params.cardId as string | undefined;
      if (typeof cardId !== 'string') return '请选择一张手牌弃置';
      if (!st.players[ownerId].hand.includes(cardId)) return '牌不在手牌中';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[DISCARD_CARD_KEY] = params.cardId;
    },
  );

  // ── 判定 after hook:捕获判定牌花色(判定牌进弃牌堆前)──
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '判定') return;
    if (atom.judgeType !== '悲歌') return;
    const processing = frameCards(ctx.state);
    if (processing.length === 0) return;
    const judgeCardId = processing[processing.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;
    ctx.state.localVars[JUDGE_SUIT_KEY] = judgeCard.suit;
  });

  // ── 造成伤害 after hook:悲歌主逻辑 ──
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

    // 蔡文姬须存活且有手牌作代价
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    if (self.hand.length === 0) return;

    // 询问弃一张牌发动(不弃=不发动)
    delete ctx.state.localVars[DISCARD_CARD_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: DISCARD_RT,
      target: ownerId,
      prompt: {
        type: 'useCard',
        title: '悲歌:弃置一张牌,令受伤角色判定',
        cardFilter: { filter: () => true, min: 1, max: 1 },
      },
      timeout: 15,
    });
    const discardCardId = ctx.state.localVars[DISCARD_CARD_KEY] as string | undefined;
    delete ctx.state.localVars[DISCARD_CARD_KEY];
    if (typeof discardCardId !== 'string') return; // 不发动

    // 弃置代价
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [discardCardId] });

    // 判定(受伤角色);牌堆空则无法判定,悲歌效果不触发
    if (ctx.state.zones.deck.length === 0) return;
    delete ctx.state.localVars[JUDGE_SUIT_KEY];
    await applyAtom(ctx.state, { type: '判定', player: targetIdx, judgeType: '悲歌' });
    const suit = ctx.state.localVars[JUDGE_SUIT_KEY] as string | undefined;
    delete ctx.state.localVars[JUDGE_SUIT_KEY];
    if (suit === undefined) return;

    const sourceIdx = atom.source;

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
  });

  // ── 阶段开始 before hook:检测翻面标签 → 启动跳过(手法同据守/放逐,tag 独立)──
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
      title: '悲歌:弃置一张牌发动',
      cardFilter: { filter: (_c: Card) => true, min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
