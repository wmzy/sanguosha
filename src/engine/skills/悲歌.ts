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
//   - 判定牌花色经 判定牌生效后 after-hook(judgeType='悲歌')捕获,存 localVars.
//   - ♠ 翻面复用据守/放逐的标签+阶段 hook 机制(tag 名独立为 '悲歌/翻面')。
//   - 悲歌的非系统 after-hook 先于系统规则濒死检查执行:♥ 回血可在求桃前救活濒死角色。
//   - 无次数限制。
//
// 本文件同时导出悲歌族共享核心(beigeDamageTarget/applyBeigeSuitEffect/
// registerBeigeJudgeCaptureHook):标/界的触发守卫、花色主效果与判定牌捕获 hook
// 逐字相同,仅 judgeType 不同('悲歌' vs '界悲歌')。界悲歌.ts 消费这些导出,
// 只写"先判后弃+花色/点数奖励"差异段。翻面跳过 hooks 两版均直接调
// flows/face-down 的 registerFlipSkipTurnHooks(悲歌翻的是伤害来源 → scope 'any',
// 仅 reason 前缀不同,'悲歌' vs '界悲歌',标签/标志键随之隔离)。
import type {
  AtomOfName,
  Card,
  FrontendAPI,
  GameState,
  Json,
  Skill,
  SkillModule,
} from '../types';
import { applyAtom } from '../core/apply'
import { runJudgeFlow, currentJudgeCardId } from '../flows/judge';
import { flipFaceDown, registerFlipSkipTurnHooks } from '../flows/face-down';
import { registerAction, registerAfterHook } from '../core/skill';
import { requireRequestType, askResponse } from '../util/skillRuntime';

const DISCARD_RT = '悲歌/discard';
const DISCARD_CARD_KEY = '悲歌/discardCard';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '悲歌',
    description: '一名角色受到杀伤害后,弃一张牌令其判定:♥回血/♦摸二/♣来源弃二/♠来源翻面',
  };
}

/**
 * 悲歌族触发守卫(标/界逐字相同):【杀】造成的正伤害、受伤角色存活,
 * 且持有者(ownerId)存活并有手牌("若你有牌"=有手牌)。
 *
 * @returns 满足条件时返回受伤角色座次,否则 undefined(调用方直接 return)。
 */
export function beigeDamageTarget(
  state: GameState,
  ownerId: number,
  atom: AtomOfName<'受到伤害后'>,
): number | undefined {
  if ((atom.amount ?? 0) <= 0) return undefined;
  const targetIdx = atom.target;
  if (targetIdx === undefined) return undefined;
  if (!state.players[targetIdx]?.alive) return undefined;

  // 必须是【杀】造成的伤害(含武圣等转化杀——影子卡 name 仍为 '杀')
  const cardId = atom.cardId;
  if (!cardId) return undefined;
  const dmgCard = state.cardMap[cardId];
  if (dmgCard?.name !== '杀') return undefined;

  const self = state.players[ownerId];
  if (!self?.alive) return undefined;
  if (self.hand.length === 0) return undefined;
  return targetIdx;
}

/**
 * 悲歌族判定主效果(标/界逐字相同,仅翻面 reason 前缀不同):
 *   ♥ 受伤角色回复 1 点体力 / ♦ 摸两张牌 / ♣ 伤害来源弃两张牌 / ♠ 伤害来源翻面。
 *
 * @returns 是否正常走完(♣/♠ 分支在伤害来源缺失或已死亡时提前终止并返回 false——
 *          界版的"花色/点数奖励"阶段此时不应继续,与原内联实现的提前 return 一致;
 *          标版调用方无后续阶段,返回值可忽略)。
 */
export async function applyBeigeSuitEffect(
  state: GameState,
  targetIdx: number,
  sourceIdx: number | undefined,
  suit: Card['suit'] | undefined,
  reason: string,
): Promise<boolean> {
  if (suit === '♥') {
    // 受伤角色回复 1 点体力
    if (state.players[targetIdx]?.alive) {
      await applyAtom(state, { type: '回复体力', target: targetIdx, amount: 1 });
    }
  } else if (suit === '♦') {
    // 受伤角色摸两张牌
    await applyAtom(state, { type: '摸牌', player: targetIdx, count: 2 });
  } else if (suit === '♣') {
    // 伤害来源弃置两张牌(手牌不足则全弃)
    if (sourceIdx === undefined) return false;
    const source = state.players[sourceIdx];
    if (!source?.alive) return false;
    const toDiscard = source.hand.slice(0, Math.min(2, source.hand.length));
    if (toDiscard.length > 0) {
      await applyAtom(state, { type: '弃置', player: sourceIdx, cardIds: toDiscard });
    }
  } else if (suit === '♠') {
    // 伤害来源武将牌翻面(经 flipFaceDown 补发「翻面后」时机,解围等 /翻面 hook 消费者依赖此事件)
    if (sourceIdx === undefined) return false;
    const source = state.players[sourceIdx];
    if (!source?.alive) return false;
    await flipFaceDown(state, sourceIdx, reason);
  }
  return true;
}

/**
 * 注册「判定牌生效后」捕获 hook(标/界逐字相同,仅 judgeType 不同):
 * 捕获仍在结算帧牌区顶、尚未入弃牌堆的判定牌。当前为空操作(捕获后不落地),
 * 保留 hook 注册以维持既有的 hook 顺序/占位。
 */
export function registerBeigeJudgeCaptureHook(
  state: GameState,
  skillId: string,
  ownerId: number,
  judgeType: string,
): void {
  registerAfterHook(state, skillId, ownerId, '判定牌生效后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.judgeType !== judgeType) return;
    const judgeCardId = currentJudgeCardId(ctx.state);
    const judgeCard = judgeCardId ? ctx.state.cardMap[judgeCardId] : undefined;
    if (!judgeCard) return;
  });
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
      const check = requireRequestType(st, ownerId, [DISCARD_RT], {
        mismatchError: '当前不是悲歌询问',
      });
      if (check.error) return check.error;
      const cardId = params.cardId as string | undefined;
      if (typeof cardId !== 'string') return '请选择一张手牌弃置';
      if (!st.players[ownerId].hand.includes(cardId)) return '牌不在手牌中';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[DISCARD_CARD_KEY] = params.cardId;
    },
  );

  // ── 判定牌生效后 after hook:捕获判定牌花色(标/界共享,judgeType='悲歌')──
  registerBeigeJudgeCaptureHook(state, skill.id, ownerId, '悲歌');

  // ── 造成伤害 after hook:悲歌主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    const targetIdx = beigeDamageTarget(ctx.state, ownerId, atom);
    if (targetIdx === undefined) return;

    // 询问弃一张牌发动(不弃=不发动)
    const discardCardId = await askResponse<string>(ctx.state, DISCARD_RT, ownerId, {
      resultKey: DISCARD_CARD_KEY,
      prompt: {
        type: 'useCard',
        title: '悲歌:弃置一张牌,令受伤角色判定',
        cardFilter: { filter: () => true, min: 1, max: 1 },
      },
      timeout: 15,
    });
    if (typeof discardCardId !== 'string') return; // 不发动

    // 弃置代价
    await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [discardCardId], voluntary: true });

    // 判定(受伤角色);牌堆空则无法判定,悲歌效果不触发
    if (ctx.state.zones.deck.length === 0) return;
    const judgeCardId = await runJudgeFlow(ctx.state, targetIdx, '悲歌');
    const suit = judgeCardId ? ctx.state.cardMap[judgeCardId]?.suit : undefined;
    if (suit === undefined) return;

    await applyBeigeSuitEffect(ctx.state, targetIdx, atom.source, suit, '悲歌');
  });

  // ── 翻面跳过 hooks(共用 face-down 通用版;悲歌翻的是伤害来源 → scope 'any')──
  registerFlipSkipTurnHooks(state, skill.id, ownerId, '悲歌', { scope: 'any' });

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

export default { createSkill, onInit, onMount } satisfies SkillModule;
