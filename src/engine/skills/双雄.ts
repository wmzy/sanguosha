// 双雄(颜良文丑·群雄):摸牌阶段,你可以改为进行一次判定,
// 你获得判定牌且本回合可以将一张与之颜色不同的手牌当【决斗】使用。
//
// 三部分组合:
//   A) 摸牌阶段触发(before-hook on 阶段开始,镜像再起/突袭):
//        询问发动 → 进行一次判定(判定 atom, judgeType='双雄')
//        → 跳过默认摸牌(applyAtom(阶段结束, 摸牌) + return {kind:'cancel'})
//   B) 判定 after hook(judgeType='双雄'):判定牌生效后(可能经鬼才/鬼道改判),
//        玩家获得判定牌(进手牌) + 记 turn.vars['双雄/color']=判定牌颜色
//   C) 转化 action(transform,preceding 决斗.use,镜像武圣单卡转化):
//        把一张与判定牌颜色不同的手牌当【决斗】(影子卡 outputName='决斗')
//
// 跳过默认摸牌的手法同再起/突袭/兵粮寸断:applyAtom(阶段结束, 摸牌) 把阶段
// 推进到出牌,再 return {kind:'cancel'} 取消本次 阶段开始(摸牌),使 回合管理
// 的 after-hook(自动摸2张)不再执行。
//
// 判定机制:applyAtom(判定 atom, judgeType='双雄') 从牌堆顶翻一张到 frameCards 顶,
// 经 鬼才/鬼道 改判后,本技能的 after hook 在技能 hook 阶段(判定 atom 自身 afterHooks
// 清理之前)读到最终判定牌。直接读 frameCards 顶并 移动牌 到手牌(同天妒/八卦阵模式),
// 拿走后 frame 空,判定 atom 自身 afterHooks 的 splice 变 no-op。
//
// 颜色状态同步:turn.vars['双雄/color'] 由 after-hook 写入 state(后端 transform
// validate 读)。view 侧经「回合用量」atom 同步到 players[me].turnUsage['双雄/color'],
// 供前端 transform 的 activeWhen/cardFilter 读取(processedView 不增量维护 turn.vars)。
import type {
  Card,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { runJudgeFlow } from '../judge-flow';
import {
  registerAction,
  registerAfterHook,
  registerBeforeHook,
  hasBlockingPending,
} from '../skill';
import { skipPhase } from '../skip-phase';
import { defaultPlayActive } from '../action-active';

const CONFIRM_RT = '双雄/confirm';
const TRIGGERED_KEY = '双雄/triggered';
const COLOR_KEY = '双雄/color';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '双雄',
    description: '摸牌阶段,改为进行一次判定,获得判定牌,本回合可将与之颜色不同的手牌当决斗使用',
  };
}

/** 影子卡 id:${原id}#双雄 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#双雄`;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // respond:处理 confirm(是否发动)询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s: GameState, params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== CONFIRM_RT) return '当前不是双雄询问';
      return null;
    },
    async (s: GameState, params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        s.localVars[TRIGGERED_KEY] = params.choice === true || params.confirmed === true;
      }
    },
  );

  // 阶段开始(摸牌) before:询问发动 → 进行一次判定 → 跳过默认摸牌
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '摸牌') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 发动前置条件:牌堆至少 1 张可判定。不足则放弃发动,走默认摸牌
      if (ctx.state.zones.deck.length < 1) return;

      // 询问是否发动双雄
      delete ctx.state.localVars[TRIGGERED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动双雄?(放弃摸牌,进行判定,获得判定牌,本回合异色手牌当决斗)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars[TRIGGERED_KEY] !== true) return; // 不发动 → 默认摸牌

      // 进行一次判定(judgeType='双雄'):从牌堆翻一张,鬼才/鬼道可在 afterApply 阶段改判,
      // 本技能的 after hook 在判定牌生效后获得判定牌并记颜色
      await runJudgeFlow(ctx.state, ownerId, '双雄');

      // 清理询问期 localVars
      delete ctx.state.localVars[TRIGGERED_KEY];

      // 跳过默认摸牌(直接型):阶段结束(摸牌)+ cancel
      return skipPhase(ctx.state, { player: ownerId, phase: '摸牌' });
    },
  );

  // 判定 after(judgeType='双雄'):判定牌生效后,玩家获得判定牌 + 记颜色
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '判定') return;
    if (atom.player !== ownerId) return;
    if (atom.judgeType !== '双雄') return;

    // 判定牌在 frameCards 末尾(判定 atom afterHooks 清理前),可能是改判后的最终牌
    const processing = frameCards(ctx.state);
    if (processing.length === 0) return;
    const judgeCardId = processing[processing.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    // 记录本回合决斗异色(后端 transform validate 读)
    const judgeColor = judgeCard.color;
    ctx.state.turn.vars[COLOR_KEY] = judgeColor;
    // 同步到 view 侧(经「回合用量」atom),供前端 activeWhen/cardFilter 读取
    await applyAtom(ctx.state, {
      type: '回合用量',
      player: ownerId,
      key: COLOR_KEY,
      value: judgeColor,
    });

    // 获得判定牌(处理区→手牌);拿走后判定 atom 的 afterHooks 清理为 no-op
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: judgeCardId,
      from: { zone: '处理区' },
      to: { zone: '手牌', player: ownerId },
    });
  });

  // transform action:把一张与判定牌颜色不同的手牌转化为影子"决斗"(新建 Card 实体,
  // shadowOf 指向原卡)。作为 preceding 在 决斗.use 之前执行。
  // 决斗.use validate 读 cardMap[影子id] 看到"决斗"通过。决斗技能零感知双雄。
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (s: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无阻塞 pending + 存活
      const myTurn = s.currentPlayerIndex === ownerId;
      const inActPhase = s.phase === '出牌';
      const free = !hasBlockingPending(s);
      const self = s.players[ownerId];
      const selfAlive = self.alive === true;
      // 本回合必须已发动过双雄(判定牌颜色已记)
      const judgeColor = s.turn.vars[COLOR_KEY] as string | undefined;
      const colorSet = typeof judgeColor === 'string' && judgeColor !== '';
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const card = cardIdOk ? s.cardMap[cardId] : undefined;
      const cardExists = !!card;
      // 核心:手牌颜色与判定牌颜色不同(红 vs 黑)
      const colorDiff = !!card && !!judgeColor && card.color !== judgeColor;
      const ok =
        myTurn && inActPhase && free && selfAlive && colorSet && cardInHand && cardExists && colorDiff;
      return ok ? null : '双雄:需要一张与本回合判定牌颜色不同的手牌';
    },
    async (s: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      // 通过「当作」atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      await applyAtom(s, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '决斗',
      });
    },
    // rollback:主 action validate 失败时,撤销转化(删影子,手牌还原)
    (s: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const sId = shadowIdOf(cardId);
      delete s.cardMap[sId];
      const self = s.players[ownerId];
      const idx = self.hand.indexOf(sId);
      if (idx >= 0) self.hand[idx] = cardId;
    },
  );

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '双雄',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动双雄?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });

  // 转化技 transform:把一张异色手牌当【决斗】。前端两步 UI(选牌+目标),
  // 提交时 preceding=[双雄.transform] + 主 action=决斗.use。
  // cardFilter 放宽为任意手牌(颜色匹配由后端 validate 兜底),
  // activeWhen 仅在已发动双雄且存在异色手牌时激活按钮。
  api.defineAction('transform', {
    label: '双雄',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张与本回合判定牌颜色不同的手牌当决斗使用',
      cardFilter: { filter: () => true, min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
    transform: (card: Card) => ({
      name: '决斗',
      sourceCardId: card.id,
      fromSkill: skill.id,
    }),
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p?.hand) return false;
      const judgeColor = p.turnUsage?.[COLOR_KEY];
      if (typeof judgeColor !== 'string' || judgeColor === '') return false;
      // 存在颜色不同的手牌时激活
      return p.hand.some((c) => c.color !== judgeColor);
    },
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
