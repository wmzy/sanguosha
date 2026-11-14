// 双雄(颜良文丑·群雄):摸牌阶段,你可以改为进行一次判定,
// 你获得判定牌且本回合可以将一张与之颜色不同的手牌当【决斗】使用。
//
// 三部分组合:
//   A) 摸牌阶段触发(before-hook on 阶段开始,镜像再起/突袭):
//        询问发动 → 进行一次判定(判定 atom, judgeType='双雄')
//        → 跳过默认摸牌(applyAtom(阶段结束, 摸牌) + return {kind:'cancel'})
//   B) 判定牌生效后 hook(judgeType='双雄'):判定牌生效后(可能经鬼才/鬼道改判),
//        玩家获得判定牌(进手牌) + 记 turn.vars['双雄/color']=判定牌颜色
//   C) 转化 action(transform,preceding 决斗.use,镜像武圣单卡转化):
//        把一张与判定牌颜色不同的手牌当【决斗】(影子卡 outputName='决斗')
//        ——五件套由 skillRuntime 转化技工厂统一实现(颜色谓词维度)
//
// 跳过默认摸牌的手法同再起/突袭/兵粮寸断:applyAtom(阶段结束, 摸牌) 把阶段
// 推进到出牌,再 return {kind:'cancel'} 取消本次 阶段开始(摸牌),使 回合管理
// 的 after-hook(自动摸2张)不再执行。
//
// 判定机制:runJudgeFlow 从牌堆顶翻一张到 frameCards 顶,经 鬼才/鬼道 改判后,
// 本技能的 判定牌生效后 hook 读到最终判定牌(仍在 frameCards 顶,runJudgeFlow 收尾
// 入弃牌堆之前)。直接读 frameCards 顶并 移动牌 到手牌(同天妒/八卦阵模式),
// 拿走后 frame 空,runJudgeFlow 收尾 splice 变 no-op。
//
// 颜色状态同步:turn.vars['双雄/color'] 由 after-hook 写入 state(后端 transform
// validate 读)。view 侧经「回合用量」atom 同步到 players[me].turnUsage['双雄/color'],
// 供前端 transform 的 activeWhen/cardFilter 读取(processedView 不增量维护 turn.vars)。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply'
import { runJudgeFlow, currentJudgeCardId } from '../flows/judge';
import {
  registerAfterHook,
} from '../core/skill';
import { skipPhase } from '../rules/skip-phase';
import { defaultPlayActive } from '../rules/action-active';
import { setTurnVarUsage } from '../rules/turn-usage';
import { SHUANGXIONG_COLOR_VIEW_KEY } from '../rules/vars-keys';
import { askConfirm, defineConfirmAction, mountTransformAction, registerConfirmRespond, registerPhaseStartHook, registerTransformAction, type TransformActionOptions } from '../util/skillRuntime';

const CONFIRM_RT = '双雄/confirm';
const TRIGGERED_KEY = '双雄/triggered';
/** turn.vars + view.turnUsage:拼点判定牌颜色(红/黑),供后端 transform validate + 前端 activeWhen 读 */
const COLOR_KEY = SHUANGXIONG_COLOR_VIEW_KEY;

const OPTIONS: TransformActionOptions = {
  outputName: '决斗',
  // 核心:本回合已发动双雄(判定牌颜色已记)且手牌颜色与判定牌颜色不同(红 vs 黑)
  cardPredicate: (s, _ownerId, cardIds) => {
    const judgeColor = s.turn.vars[COLOR_KEY] as string | undefined;
    const card = s.cardMap[cardIds[0]];
    return typeof judgeColor === 'string' && judgeColor !== '' && !!card && card.color !== judgeColor;
  },
  invalidError: '双雄:需要一张与本回合判定牌颜色不同的手牌',
  mount: {
    label: '双雄',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '选择一张与本回合判定牌颜色不同的手牌当决斗使用',
      cardFilter: { filter: () => true, min: 1, max: 1 },
      targetFilter: { min: 1, max: 1 },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p?.hand) return false;
      const judgeColor = p.turnUsage?.[COLOR_KEY];
      if (typeof judgeColor !== 'string' || judgeColor === '') return false;
      // 存在颜色不同的手牌时激活
      return p.hand.some((c) => c.color !== judgeColor);
    },
  },
};

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '双雄',
    description: '摸牌阶段,改为进行一次判定,获得判定牌,本回合可将与之颜色不同的手牌当决斗使用',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // respond:处理 confirm(是否发动)询问
  registerConfirmRespond(state, skill.id, ownerId, CONFIRM_RT, TRIGGERED_KEY, {
    mismatchError: '当前不是双雄询问',
  });

  // 阶段开始(摸牌) before:询问发动 → 进行一次判定 → 跳过默认摸牌
  registerPhaseStartHook(
    state,
    skill.id,
    ownerId,
    '摸牌',
    async (ctx): Promise<HookResult | void> => {
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 发动前置条件:牌堆至少 1 张可判定。不足则放弃发动,走默认摸牌
      if (ctx.state.zones.deck.length < 1) return;

      // 询问是否发动双雄
      const triggered = await askConfirm(ctx.state, CONFIRM_RT, ownerId, {
        confirmedKey: TRIGGERED_KEY,
        title: '是否发动双雄?(放弃摸牌,进行判定,获得判定牌,本回合异色手牌当决斗)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
        defaultChoice: false,
        timeout: 10,
      });
      if (!triggered) return; // 不发动 → 默认摸牌

      // 进行一次判定(judgeType='双雄'):从牌堆翻一张,鬼才/鬼道可在 afterApply 阶段改判,
      // 本技能的 after hook 在判定牌生效后获得判定牌并记颜色
      await runJudgeFlow(ctx.state, ownerId, '双雄');

      // 清理询问期 localVars
      delete ctx.state.localVars[TRIGGERED_KEY];

      // 跳过默认摸牌(直接型):阶段结束(摸牌)+ cancel
      return skipPhase(ctx.state, { player: ownerId, phase: '摸牌' });
    },
    { requireCurrentPlayer: true },
  );

  // 判定牌生效后 hook(judgeType='双雄'):玩家获得判定牌 + 记颜色
  registerAfterHook(state, skill.id, ownerId, '判定牌生效后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    if (atom.judgeType !== '双雄') return;

    // 判定牌生效后,判定牌仍在 frameCards 末尾(尚未入弃牌堆),可能是改判后的最终牌
    const judgeCardId = currentJudgeCardId(ctx.state);
    if (!judgeCardId) return;
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    // 记录本回合决斗异色(后端 transform validate 读)
    const judgeColor = judgeCard.color;
    // 同步到 view 侧(经「回合用量」atom),供前端 activeWhen/cardFilter 读取
    await setTurnVarUsage(ctx.state, ownerId, COLOR_KEY, judgeColor);

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
  registerTransformAction(state, skill.id, ownerId, OPTIONS);

  return () => {};
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  defineConfirmAction(api, 'respond', {
    label: '双雄',
    title: '是否发动双雄?',
  });

  // 转化技 transform:把一张异色手牌当【决斗】。前端两步 UI(选牌+目标),
  // 提交时 preceding=[双雄.transform] + 主 action=决斗.use。
  // cardFilter 放宽为任意手牌(颜色匹配由后端 validate 兜底),
  // activeWhen 仅在已发动双雄且存在异色手牌时激活按钮。
  mountTransformAction(api, skill.id, OPTIONS);
  return;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
