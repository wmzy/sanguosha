// src/engine/skills/据守.ts
// 据守(曹仁·主动技):结束阶段,你可以翻面并摸四张牌,
//   然后弃置一张手牌(若为装备牌则改为使用之)。
//
// 对齐官方 hero/29 现行描述(OL 加强版)。
//
// 实现差异说明:
//   - 旧版(本文件历史实现):翻面摸 3 + 跳过整回合。
//   - 新版(本实现,对齐 OL 加强版):摸 4 + 弃 1 手牌(装备牌则使用之)。
//     "翻面"在 OL 加强版中不实际产生跳过整回合的效果——为保持与本引擎
//     "翻面=跳过下一回合"语义解耦,本实现不添加 '据守/翻面' 标签,
//     故不会触发 skipAll/skipTurn 行为(对齐 OL 加强版"不跳过整回合"规则)。
//
// 实现:
//   - use action:结束阶段(弃牌 / 回合结束)发动 → 摸 4 张 →
//     选一张手牌弃置/装备 → 标记已用。
//   - 弃置/装备交互:use execute 内嵌 请求回应(requestType 标 '据守/弃牌' /
//     界 '界据守/弃牌'),玩家选一张手牌 → 若为装备牌则装备(含旧装备替换),否则弃置。
//   - 无手牌时跳过弃置/装备步骤(规则要求弃一张手牌,无手牌则免)。
//
// 本文件同时导出据守族共享核心(validateJushouUse/jushouDiscardOrEquip/
// registerJushouDiscardRespond):标/界的 use 前置校验、摸牌后的强制"弃一张手牌
// (装备牌改为使用之)"步骤与 respond 注册逐字相同,仅询问 requestType 与弹窗标题
// 前缀不同;localVars 键/每回合限一次 vars 键/错误文案共享('据守/discardChoice'、
// '据守/usedThisTurn' 等,见界据守文件头)。界据守.ts 消费这些导出,只写
// "翻面 + 跳过下一回合"差异段。
//
// 注:界曹仁的界据守(独立文件)仍保留"翻面+跳过下一回合"机制,与本标版规则不同。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import type { SkillModule } from '../types';
import { applyAtom } from '../core/apply'
import { popFrame, pushFrame } from '../core/frame';
import { usedThisTurn, markOncePerTurn } from '../rules/once-per-turn';
import { registerAction, hasBlockingPending } from '../core/skill';
import { equipReplacingOld } from './_equipReplace';
import { firstCardId, requireRequestType, defineConfirmAction } from '../util/skillRuntime';
import { slotOf } from '../util/equip-slot';

const USED_KEY = '据守/usedThisTurn';
const DISCARD_RT = '据守/弃牌';
const DISCARD_CHOICE_KEY = '据守/discardChoice';
const DISCARD_PROMPT_TITLE = '据守:选择一张手牌弃置(装备牌将改为使用)';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '据守',
    description: '结束阶段:翻面并摸四张牌,然后弃置一张手牌(装备牌改为使用之)',
  };
}

/**
 * 据守族 use action 前置校验(标/界共用,错误文案/vars 键逐字相同):
 * 自己回合、结束阶段(弃牌/回合结束)、无阻塞 pending、存活、本回合未用过;
 * opts.skipTag 传入时(界版)额外要求未持有该翻面标签(已翻面不能再次发动)。
 */
export function validateJushouUse(
  state: GameState,
  ownerId: number,
  opts: { skipTag?: string } = {},
): string | null {
  const myTurn = state.currentPlayerIndex === ownerId;
  // 发动时机:结束阶段(弃牌 或 回合结束 阶段)
  const inEndPhase = state.phase === '弃牌' || state.phase === '回合结束';
  const free = !hasBlockingPending(state);
  const self = state.players[ownerId];
  const selfAlive = self?.alive === true;
  // 已经翻面/已用过 → 不能再次发动(界版传入 skipTag 时生效)
  const notSkipped = opts.skipTag === undefined || !self.tags.includes(opts.skipTag);
  const notUsed = !usedThisTurn(state, ownerId, '据守');
  const ok = myTurn && inEndPhase && free && selfAlive && notSkipped && notUsed;
  return ok ? null : '现在不能发动据守';
}

/**
 * 据守族共用:摸牌后的强制"弃置一张手牌(装备牌改为使用之)"步骤。
 * 超时/非法提交兜底自动弃手牌首张;装备牌走完整替换装备流程
 * (移除旧技能→卸下→弃旧→装备→添加新技能)。无手牌时跳过(无牌则免)。
 * 标/界仅 询问 requestType 与弹窗标题前缀不同,localVars 键共享 '据守/discardChoice'。
 */
export async function jushouDiscardOrEquip(
  state: GameState,
  ownerId: number,
  discardRt: string,
  promptTitle: string,
): Promise<void> {
  const self = state.players[ownerId];
  if (self.hand.length > 0) {
    delete state.localVars[DISCARD_CHOICE_KEY];
    await applyAtom(state, {
      type: '请求回应',
      requestType: discardRt,
      target: ownerId,
      prompt: {
        type: 'useCard',
        title: promptTitle,
        cardFilter: { filter: () => true, min: 1, max: 1 },
      },
      // 强制弃牌(摸四的代价,不可放弃):超时由下方兜底自动弃首张
      mandatory: true,
      timeout: 20,
    });
    let chosenId = state.localVars[DISCARD_CHOICE_KEY] as string | undefined;
    delete state.localVars[DISCARD_CHOICE_KEY];
    // 强制弃牌兜底:超时/空响应未选 → 自动弃手牌首张(不放弃弃牌义务)
    if (!chosenId || !self.hand.includes(chosenId)) {
      chosenId = self.hand[0];
    }
    if (chosenId && self.hand.includes(chosenId)) {
      const card = state.cardMap[chosenId];
      const slot = slotOf(card);
      if (card?.type === '装备牌' && slot) {
        // 装备牌:使用之(替换旧装备,逻辑同 装备通用)
        await equipReplacingOld(state, ownerId, slot, chosenId);
      } else {
        // 非装备牌:弃置
        await applyAtom(state, { type: '弃置', player: ownerId, cardIds: [chosenId], voluntary: true });
      }
    }
  }
}

/**
 * 注册据守族 respond:玩家选择弃置/使用的手牌(标/界逐字相同,仅 requestType 不同)。
 * 双形状归一(mandatory 多选弃牌 UI/HeadlessGameClient 提交 {cardIds:[x]},旧单发形状
 * 为 {cardId}),且仅接受自己手牌中的牌(防注入他人牌);非法形状不写 → use execute
 * 走兜底弃首张。标/界历史行为:不持有 unloader(保持原卸载语义不变)。
 */
export function registerJushouDiscardRespond(
  state: GameState,
  skillId: string,
  ownerId: number,
  discardRt: string,
): void {
  registerAction(
    state,
    skillId,
    ownerId,
    'respond',
    (s: GameState, _params: Record<string, Json>) => {
      return requireRequestType(s, ownerId, [discardRt], {
        wrongTypeError: '当前不是选牌窗口',
        mismatchError: '当前不是据守弃牌窗口',
      }).error;
    },
    async (s: GameState, params: Record<string, Json>): Promise<void> => {
      const raw = firstCardId(params);
      const self = s.players[ownerId];
      if (raw !== undefined && self?.hand.includes(raw)) {
        s.localVars[DISCARD_CHOICE_KEY] = raw;
      }
    },
  );
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── use:主动发动据守 ────────────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, _params: Record<string, Json>) =>
      validateJushouUse(state, ownerId),
    async (state: GameState, _params: Record<string, Json>) => {
      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(state, ownerId, '据守');
      await pushFrame(state, '据守', ownerId, {});
      try {
        // 摸四张牌(OL 加强版),然后弃置一张手牌(若为装备牌则改为使用之)
        await applyAtom(state, { type: '摸牌', player: ownerId, count: 4 });
        await jushouDiscardOrEquip(state, ownerId, DISCARD_RT, DISCARD_PROMPT_TITLE);
      } finally {
        await popFrame(state);
      }
    },
  );

  // ── respond:玩家选择弃置/使用的手牌(标/界共享注册)──
  registerJushouDiscardRespond(state, skill.id, ownerId, DISCARD_RT);

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  defineConfirmAction(api, 'use', {
    label: '据守',
    title: '是否发动据守?(翻面摸四张,然后弃置一张手牌)',
    activeWhen: (ctx) => {
      if (ctx.view.currentPlayerIndex !== ctx.perspectiveIdx) return false;
      const phase = ctx.view.phase;
      if (phase !== '弃牌' && phase !== '回合结束') return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      if (p.turnUsage?.[USED_KEY]) return false;
      return true;
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
