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
//   - 触发守卫/花色主效果/判定牌捕获 hook 复用标版悲歌导出的共享核心
//     (beigeDamageTarget/applyBeigeSuitEffect/registerBeigeJudgeCaptureHook);
//     翻面跳过 hooks 两版均直接调 flows/face-down 的 registerFlipSkipTurnHooks
//     (悲歌翻的是伤害来源 → scope 'any';本版 reason '界悲歌',标签 '界悲歌/翻面'
//     与标版 '悲歌/翻面' 隔离)。
//   - 花色主效果的 ♣/♠ 分支因来源缺失/死亡提前终止时,奖励阶段不继续
//     (applyBeigeSuitEffect 返回 false,与原内联实现的提前 return 一致)。
//   - 判定牌和弃置牌都进弃牌堆后,通过 移动牌(弃牌堆→手牌) 获得(无需延迟拿取——
//     runJudgeFlow 收尾在判定牌生效后 hook 之后才把判定牌入弃牌堆,
//     而本技能的比较/拿取发生在造成伤害 after hook 内,那时判定流程早已完整结算)。
//   - 界悲歌的非系统 after-hook 先于系统规则濒死检查执行:♥ 回血可在求桃前救活濒死角色。
//   - 无次数限制。
import type {
  Card,
  FrontendAPI,
  GameState,
  Json,
  Skill,
  SkillModule,
} from '../types';
import { applyAtom } from '../core/apply'
import { runJudgeFlow } from '../flows/judge';
import { registerFlipSkipTurnHooks } from '../flows/face-down';
import { registerAction, registerAfterHook } from '../core/skill';
import {
  requireRequestType,
  askConfirm,
  askResponse,
  currentRequestType,
} from '../util/skillRuntime';
import {
  beigeDamageTarget,
  applyBeigeSuitEffect,
  registerBeigeJudgeCaptureHook,
} from './悲歌';

const START_RT = '界悲歌/chooseStart';
const DISCARD_RT = '界悲歌/chooseDiscard';
const START_KEY = '界悲歌/start';
const DISCARD_CARD_KEY = '界悲歌/discardCard';

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
      const check = requireRequestType(st, ownerId, [START_RT, DISCARD_RT], {
        mismatchError: '当前不是界悲歌询问',
      });
      if (check.error) return check.error;
      // 弃牌询问:若玩家选择弃,须提供合法手牌 cardId
      if (check.requestType === DISCARD_RT) {
        const cardId = params.cardId as string | undefined;
        if (typeof cardId === 'string' && !st.players[ownerId].hand.includes(cardId)) {
          return '牌不在手牌中';
        }
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const rt = currentRequestType(st, ownerId);
      if (rt === START_RT) {
        // confirm:true=发动;false/undefined=不发动
        st.localVars[START_KEY] = params.choice === true;
      } else if (rt === DISCARD_RT) {
        // cardId 为字符串=弃该牌;undefined=不弃
        st.localVars[DISCARD_CARD_KEY] = params.cardId;
      }
    },
  );

  // ── 判定牌生效后 after hook:捕获判定牌花色+点数+cardId(标/界共享,judgeType='界悲歌')──
  registerBeigeJudgeCaptureHook(state, skill.id, ownerId, '界悲歌');

  // ── 造成伤害 after hook:界悲歌主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    const targetIdx = beigeDamageTarget(ctx.state, ownerId, atom);
    if (targetIdx === undefined) return;

    // 询问是否发动界悲歌(不发动=不判定)
    const start = await askConfirm(ctx.state, START_RT, ownerId, {
      confirmedKey: START_KEY,
      title: '界悲歌:是否令受伤角色判定?',
      confirmLabel: '发动(判定)',
      cancelLabel: '不发动',
      defaultChoice: false,
      timeout: 15,
    });
    delete ctx.state.localVars[START_KEY];
    if (!start) return; // 不发动

    // 判定(受伤角色);牌堆空则无法判定,界悲歌效果不触发
    if (ctx.state.zones.deck.length === 0) return;
    const judgeCardId = await runJudgeFlow(ctx.state, targetIdx, '界悲歌');
    const judgeCard = judgeCardId ? ctx.state.cardMap[judgeCardId] : undefined;
    const suit = judgeCard?.suit;
    const _rank = judgeCard?.rank;
    if (suit === undefined) return;

    const sourceIdx = atom.source;

    // 询问是否弃一张牌(可选,目的是触发"花色/点数相同"奖励)
    let discardCardId: string | undefined;
    if (ctx.state.players[ownerId].hand.length > 0) {
      discardCardId = await askResponse<string>(ctx.state, DISCARD_RT, ownerId, {
        resultKey: DISCARD_CARD_KEY,
        prompt: {
          type: 'useCard',
          title: '界悲歌:是否弃置一张牌?(花色同获判定牌,点数同获弃置牌)',
          cardFilter: { filter: () => true, min: 1, max: 1 },
        },
        timeout: 15,
      });
      if (typeof discardCardId === 'string') {
        // 弃置代价
        await applyAtom(ctx.state, { type: '弃置', player: ownerId, cardIds: [discardCardId], voluntary: true });
      }
    }

    // 按判定花色执行主效果(标/界共享;false=♣/♠ 因来源缺失/死亡提前终止,奖励不继续)
    const proceeded = await applyBeigeSuitEffect(ctx.state, targetIdx, sourceIdx, suit, '界悲歌');

    // 奖励:若弃置了牌,比较花色/点数获得对应牌(判定牌与弃置牌此时都在弃牌堆)
    // 防御:判定牌/弃置牌可能在奖励结算前被其他技能从弃牌堆取走
    //   (如落英/界落英抢夺被弃置的梅花牌),须校验仍在弃牌堆再移动,否则 移动牌
    //   会盲取(弃牌堆 filter 为 no-op + 手牌 push)导致该牌同时出现在多人手牌中。
    if (proceeded && typeof discardCardId === 'string' && judgeCardId) {
      const judgeCard = ctx.state.cardMap[judgeCardId];
      const discardCard = ctx.state.cardMap[discardCardId];
      if (judgeCard && discardCard) {
        // 花色相同 → 获得判定牌
        if (judgeCard.suit === discardCard.suit && ctx.state.zones.discardPile.includes(judgeCardId)) {
          await applyAtom(ctx.state, {
            type: '移动牌',
            cardId: judgeCardId,
            from: { zone: '弃牌堆' },
            to: { zone: '手牌', player: ownerId },
          });
        }
        // 点数相同 → 获得你弃置的牌
        if (judgeCard.rank === discardCard.rank && ctx.state.zones.discardPile.includes(discardCardId)) {
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

  // ── 翻面跳过 hooks(共用 face-down 通用版;界悲歌翻的是伤害来源 → scope 'any')──
  registerFlipSkipTurnHooks(state, skill.id, ownerId, '界悲歌', { scope: 'any' });

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

export default { createSkill, onInit, onMount } satisfies SkillModule;
