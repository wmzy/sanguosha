// 界疠火(界程普·吴·主动技,OL 界限突破官方逐字):
//   你使用的非火【杀】可以改为火【杀】使用,此牌结算后,若其造成伤害,
//   你弃置一张牌或失去1体力。你使用的火【杀】可以多指定一个目标。
//
// 与标版疠火(程普)区别:
//   1. 标版:仅"普通【杀】可视为火【杀】"(不含雷杀);界版:"非火【杀】"(含雷杀)。
//   2. 标版:转化杀造成伤害后"失去1点体力"(固定代价);界版:"弃置一张牌或失去1体力"(二选一)。
//   3. 多目标效果两版相同(火杀可+1目标)。
//
// 实现:
//   ① transform action(preceding,主 action=杀.use 之前执行):
//      校验 owner 手中的杀 damageType !== '火焰'(即非火杀,含普通/雷杀);
//      创建影子卡 `${cardId}#疠火`,name='杀',damageType='火焰',继承花色/点数/颜色,shadowOf 指向原卡。
//      标记 `localVars['疠火/converted:${shadowId}']` = true 供后续 hook 识别。
//   ② 造成伤害 after-hook:
//      若 atom.source===owner + atom.cardId 是疠火转化影子 + amount>0 →
//      标记 `localVars['疠火/damaged:${shadowId}']` = true。
//   ③ 移动牌 after-hook:
//      若 atom.cardId 是疠火转化影子 + from.zone='处理区' + to.zone='弃牌堆'(杀收尾移动)
//      + 已造成伤害 → 询问 owner 弃1手牌;若 owner 超时(选择"失去体力")或手牌为空,
//      则失去 1 体力。
//      询问 requestType='疠火/cost';respond 写入 COST_CARD_KEY。
//   ④ 多目标:杀.use 的 validate 不限目标数上限,前端 targetFilter max=3 已允许,
//      故 owner 使用任何火杀(原始或疠火转化)选 2 目标即可,无需额外改动。
//
// 命名:文件名/loader key/character skill name 均为 '界疠火'(避开标疠火冲突);
//   内部 Skill.name = '疠火'(OL 官方技能名,玩家可见)。
import type {
  Card,
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import {
  registerAction,
  registerAfterHook,
  hasBlockingPending,
} from '../skill';
import { defaultPlayActive, viewCanSlash } from '../action-active';

const SKILL_ID = '界疠火';
const DISPLAY_NAME = '疠火';
const COST_RT = '疠火/cost';
const COST_CARD_KEY = '疠火/costCard';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '你使用的非火【杀】可以改为火【杀】;此牌造成伤害后,你弃1牌或失去1体力;你使用的火【杀】可多指定一个目标',
  };
}

/** 影子卡 id:${原id}#疠火 */
function shadowIdOf(cardId: string): string {
  return `${cardId}#疠火`;
}

/** 标记某影子为疠火转化(在 localVars 里) */
function convertedKey(shadowId: string): string {
  return `疠火/converted:${shadowId}`;
}

/** 标记某影子已造成伤害(在 localVars 里) */
function damagedKey(shadowId: string): string {
  return `疠火/damaged:${shadowId}`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ─── transform action:把非火杀转化为火杀影子(preceding,杀.use 之前) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'transform',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无阻塞 pending + 存活
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? state.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      // 非火杀:name === '杀' 且 damageType !== '火焰'(含普通杀与雷杀)
      const isNonFireSlash = !!card && card.name === '杀' && card.damageType !== '火焰';
      const ok =
        myTurn && inActPhase && free && selfAlive && cardInHand && isNonFireSlash;
      return ok ? null : '现在不能使用疠火';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      // 通过 atom 走完整 pipeline(产生 ViewEvent,保证 processedView 同步)
      // outputDamageType='火焰' 是疠火核心:非火杀转化为火杀
      await applyAtom(state, {
        type: '当作',
        player: ownerId,
        cardIds: [cardId],
        shadowId,
        outputName: '杀',
        outputDamageType: '火焰',
      });
      // 标记此影子为疠火转化,供后续 hook 识别
      state.localVars[convertedKey(shadowId)] = true;
    },
    // rollback:主 action validate 失败时撤销转化
    (state: GameState, params: Record<string, Json>) => {
      const cardId = params.cardId as string;
      const shadowId = shadowIdOf(cardId);
      delete state.cardMap[shadowId];
      delete state.localVars[convertedKey(shadowId)];
      delete state.localVars[damagedKey(shadowId)];
      state.players[ownerId].hand = state.players[ownerId].hand.map((id) =>
        id === shadowId ? cardId : id,
      );
    },
  );

  // ─── respond:玩家在「疠火/cost」询问下选弃哪张牌;超时 = 失去1体力 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s, params) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== COST_RT) return '当前不是疠火代价选择';
      const cardId = params.cardId as string | undefined;
      if (typeof cardId !== 'string') return 'cardId required';
      const self = s.players[ownerId];
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      return null;
    },
    async (s, params) => {
      s.localVars[COST_CARD_KEY] = params.cardId as string;
    },
  );

  // ─── 造成伤害 after:记录疠火转化杀是否造成伤害 ──────────────────
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const cardId = atom.cardId;
    if (typeof cardId !== 'string') return;
    // 只标记疠火转化的影子(其他来源的火杀不触发代价)
    if (!ctx.state.localVars[convertedKey(cardId)]) return;
    ctx.state.localVars[damagedKey(cardId)] = true;
  });

  // ─── 移动牌 after:杀收尾时(处理区→弃牌堆)触发疠火代价 ─────────
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    if (atom.from?.zone !== '处理区') return;
    if (atom.to?.zone !== '弃牌堆') return;
    const cardId = atom.cardId;
    if (typeof cardId !== 'string') return;
    // 仅疠火转化影子触发
    if (!ctx.state.localVars[convertedKey(cardId)]) return;
    // 必须造成过伤害
    const damaged = ctx.state.localVars[damagedKey(cardId)] === true;
    // 清理 localVars 标记(无论是否触发代价,影子已入弃牌堆不再追踪)
    delete ctx.state.localVars[convertedKey(cardId)];
    delete ctx.state.localVars[damagedKey(cardId)];
    if (!damaged) return;

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;

    // 弃1张牌 or 失去1体力
    // 实现:询问 owner 弃1张手牌。若 owner 超时(pass=不愿弃)或手牌为空 → 失去1体力。
    if (self.hand.length > 0) {
      delete ctx.state.localVars[COST_CARD_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: COST_RT,
        target: ownerId,
        prompt: {
          type: 'useCard',
          title: '疠火:此杀造成伤害。弃置 1 张牌,或放弃(失去 1 体力)',
          cardFilter: { min: 1, max: 1 },
        },
        // 超时默认 false(放弃,失去1体力)
        defaultChoice: false,
        timeout: 10,
      });
      const costCard = ctx.state.localVars[COST_CARD_KEY] as string | undefined;
      delete ctx.state.localVars[COST_CARD_KEY];
      if (typeof costCard === 'string' && self.hand.includes(costCard)) {
        // 弃置选中的牌
        await applyAtom(ctx.state, {
          type: '弃置',
          player: ownerId,
          cardIds: [costCard],
        });
      } else {
        // 未选(超时/主动放弃)→ 失去1体力
        await applyAtom(ctx.state, { type: '失去体力', target: ownerId, amount: 1 });
      }
    } else {
      // 无手牌:只能失去1体力
      await applyAtom(ctx.state, { type: '失去体力', target: ownerId, amount: 1 });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  // transform:前端选非火杀 → 选目标 → 点疠火按钮 → 提交 preceding=[疠火.transform] + 主 action=杀.use
  api.defineAction('transform', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '疠火:将非火【杀】当火【杀】使用',
      // 选非火杀(普通/雷杀)
      cardFilter: {
        filter: (c) => c.name === '杀' && c.damageType !== '火焰',
        min: 1,
        max: 1,
      },
      targetFilter: {
        min: 1,
        // 火杀可多指定一个目标,前端 max=3 已允许(参考方天画戟注释)
        max: 3,
        filter: (view: GameView, t: number) => {
          // 排除自己;具体距离校验由后端 杀.use validate 处理
          const cp = view.currentPlayerIndex;
          return t !== cp;
        },
      },
    },
    activeWhen: (ctx) => defaultPlayActive(ctx) && viewCanSlash(ctx.view, ctx.perspectiveIdx),
  });
  // respond:代价选择(弃1张牌或放弃=失去1体力)
  api.defineAction('respond', {
    label: '弃1张牌',
    style: 'default',
    prompt: {
      type: 'useCard',
      title: '疠火:请弃置 1 张牌(或放弃失去 1 体力)',
      cardFilter: { min: 1, max: 1 },
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
