// 成略(许攸·群·主动技·转换技,OL hero/406 风林火山官方逐字):
//   "转换技,出牌阶段限一次,阳:你可以摸一张牌并弃置两张手牌;
//    阴:你可以摸两张牌并弃置一张手牌。
//    然后你本阶段使用与弃置牌花色相同的牌无距离和次数限制。"
//
// 转换态:player.vars['成略/态'] = '阳'(默认) | '阴',跨回合持久。
//   - 阳:摸 1,弃 2 手牌。
//   - 阴:摸 2,弃 1 手牌。
//   发动后翻为另一态。
//
// 同花色无限制(turn.vars['成略/suits'] 驱动,本回合生效,回合结束自动清空):
//   弃置牌的花色记录到 turn.vars['成略/suits']。本回合 owner 使用同花色牌时:
//     · 杀:无次数限制(SlashExemptor,per-cardId 花色判定)
//     · 杀:无距离限制(AttackRangeExemptor,per-cardId)
//     · 顺手牵羊/兵粮寸断:无距离限制(DistanceExemptor,per-cardId——引擎已增强为 cardId 感知)
//   三个豁免器在 onInit 一次性注册,读 turn.vars['成略/suits'] 实时判定,无动态注册/卸载。
//
// 流程(use action,出牌阶段限一次):
//   1. validate:出牌阶段 + 自己回合 + 无阻塞 pending + 未用过 + 手牌足够弃置(阳需≥1)
//   2. execute:标记限一次 → 读态 → 摸 N → 请求回应选弃牌 → 弃置 → 记花色 → 翻态
//
// 弃牌选择(draw-then-discard):摸牌后弹出选牌面板(useCard prompt),玩家从含新摸牌的
// 完整手牌中选弃置牌。超时/非法时 fallback 弃手牌前 N 张,保证技能完整结算。
//
// 关键点:
//   - 转换态经「回合用量」atom 投影 view.turnUsage['成略/态'];回合结束整体清空 turnUsage,
//     故在拥有者「回合开始」after-hook 重新同步一次(供前端 activeWhen 展示当前阴阳态)。
//   - 限一次:'成略/usedThisTurn'(once-per-turn 工具,回合结束自动清空)。
//   - 一个 respond action 处理 弃牌选择(requestType='成略/discard')。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import {
  registerAction,
  registerAfterHook,
  hasBlockingPending,
} from '../core/skill';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../rules/once-per-turn';
import { defaultPlayActive } from '../rules/action-active';
import {
  registerSlashExemptor,
} from '../rules/slash-quota';
import {
  registerAttackRangeExemptor,
  registerDistanceExemptor,
} from '../rules/distance';
import type { SkillModule } from '../types';
import { CHENGLUE_SUITS_VIEW_KEY, slashUnlimitedKey } from '../rules/vars-keys';

const SKILL_ID = '成略';
/** 转换态 state key(跨回合持久,无 /usedThisTurn 后缀)。 */
const STATE_KEY = '成略/态';
/** 转换态 view 同步 key(经 回合用量 atom 投影 turnUsage)。 */
const STATE_VIEW_KEY = '成略/态';
/** turn.vars key:本回合成略弃置牌的花色数组(string[]),驱动三个豁免器。 */
const SUITS_VAR = CHENGLUE_SUITS_VIEW_KEY;

/** 弃牌选择 requestType(T1:requestType 前缀 = skillId)。 */
const DISCARD_RT = '成略/discard';
/** localVars key:弃牌选择结果(string[])。 */
const DISCARD_KEY = '成略/discard结果';
/** localVars key:本次成略需弃置的张数(供 respond validate 读取)。 */
const DISCARD_COUNT_KEY = '成略/弃牌数';

function getState(state: GameState, ownerId: number): '阳' | '阴' {
  return state.players[ownerId]?.vars[STATE_KEY] === '阴' ? '阴' : '阳';
}

async function syncStateView(state: GameState, ownerId: number): Promise<void> {
  await applyAtom(state, {
    type: '回合用量',
    player: ownerId,
    key: STATE_VIEW_KEY,
    value: getState(state, ownerId),
  });
}

/** 判断 cardId 的花色是否在本回合成略弃置牌花色集合中。 */
function suitInChenglue(state: GameState, cardId: string | undefined): boolean {
  if (!cardId) return false;
  const card = state.cardMap[cardId];
  if (!card) return false;
  const suits = state.turn.vars[SUITS_VAR] as string[] | undefined;
  if (!Array.isArray(suits) || suits.length === 0) return false;
  return suits.includes(card.suit);
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description:
      '转换技,出牌阶段限一次。阳:摸一张牌并弃置两张手牌;阴:摸两张牌并弃置一张手牌。然后本阶段使用与弃置牌花色相同的牌无距离和次数限制',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 同花色杀:无次数限制(per-cardId 花色豁免) ──
  const unloadSlashExemptor = registerSlashExemptor(
    state,
    ownerId,
    (st, player, cardId) => player === ownerId && suitInChenglue(st, cardId),
  );

  // ── 同花色杀:无距离限制(per-cardId 攻击范围豁免) ──
  const unloadRangeExemptor = registerAttackRangeExemptor(
    state,
    ownerId,
    (st, from, _to, cardId) => from === ownerId && suitInChenglue(st, cardId),
  );

  // ── 同花色顺手牵羊/兵粮寸断:无距离限制(per-cardId 通用距离豁免) ──
  const unloadDistanceExemptor = registerDistanceExemptor(
    state,
    ownerId,
    (st, from, _to, cardId) => from === ownerId && suitInChenglue(st, cardId),
  );

  // ── respond:弃牌选择(成略/discard) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== DISCARD_RT) return '当前不是成略弃牌';
      const ids = params.cardIds as string[] | undefined;
      if (!Array.isArray(ids) || ids.length === 0) return '请选择要弃置的手牌';
      const expected = st.localVars[DISCARD_COUNT_KEY] as number | undefined;
      const self = st.players[ownerId];
      if (!self) return 'player not found';
      if (typeof expected === 'number' && ids.length !== expected) {
        return `需弃置 ${expected} 张牌`;
      }
      if (!ids.every((id) => self.hand.includes(id))) return '牌不在手牌中';
      // 去重校验:重复 id 会使同一张牌被计入多张弃置
      if (new Set(ids).size !== ids.length) return 'cardIds 含重复牌';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const ids = params.cardIds as string[] | undefined;
      if (Array.isArray(ids) && ids.length > 0) {
        st.localVars[DISCARD_KEY] = ids;
      }
    },
  );

  // ── use:发动成略(出牌阶段限一次) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const self = st.players[ownerId];
      if (!self) return 'player not found';
      if (!self.alive) return '你已死亡';
      if (st.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
      if (st.phase !== '出牌') return '只能在出牌阶段使用';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId, SKILL_ID)) return '本回合已使用过成略';
      // 弃置前置:摸牌后须能弃出指定张数。
      //   阳:摸1弃2 → 当前手牌 +1 ≥ 2 → 手牌 ≥ 1
      //   阴:摸2弃1 → 当前手牌 +2 ≥ 1 → 恒满足(手牌≥0)
      const stt = getState(st, ownerId);
      const need = stt === '阳' ? 2 : 1;
      if (self.hand.length + (stt === '阳' ? 1 : 2) < need) {
        return '手牌不足以发动成略';
      }
      return null;
    },
    async (st: GameState, _params: Record<string, Json>): Promise<void> => {
      const from = ownerId;
      // [时序修复] 限一次标记必须在第一个 await 之前设置:防 dispatch 重入(见制衡.ts 注释)。
      await markOncePerTurn(st, from, SKILL_ID);

      const stt = getState(st, from);
      const drawCount = stt === '阳' ? 1 : 2;
      const discardCount = stt === '阳' ? 2 : 1;

      await pushFrame(st, `${SKILL_ID}(${stt})`, from, { drawCount, discardCount });

      // 摸牌(寸目会自动改为从牌堆底摸)
      await applyAtom(st, { type: '摸牌', player: from, count: drawCount });

      // 请求弃牌选择(从含新摸牌的完整手牌中选)
      delete st.localVars[DISCARD_KEY];
      st.localVars[DISCARD_COUNT_KEY] = discardCount;
      const self = st.players[from];
      await applyAtom(st, {
        type: '请求回应',
        requestType: DISCARD_RT,
        target: from,
        prompt: {
          type: 'useCard',
          title: `成略(${stt}):选择 ${discardCount} 张手牌弃置(本阶段同花色牌无距离和次数限制)`,
          cardFilter: { filter: () => true, min: discardCount, max: discardCount },
        },
        timeout: 30,
      });
      delete st.localVars[DISCARD_COUNT_KEY];

      let discardIds = st.localVars[DISCARD_KEY] as string[] | undefined;
      delete st.localVars[DISCARD_KEY];
      // 超时/非法 fallback:弃手牌前 discardCount 张,保证技能完整结算
      if (!Array.isArray(discardIds) || discardIds.length !== discardCount) {
        discardIds = (self?.hand ?? []).slice(0, discardCount);
      }
      // 再次校验弃牌仍在手牌中(防御)
      discardIds = discardIds.filter((id) => st.players[from]?.hand.includes(id));
      if (discardIds.length === discardCount) {
        await applyAtom(st, {
          type: '弃置',
          player: from,
          cardIds: discardIds,
          voluntary: true,
        });
        // 记录弃置牌花色(去重)
        const suits = Array.from(
          new Set(
            discardIds
              .map((id) => st.cardMap[id]?.suit)
              .filter((s) => typeof s === 'string' && s !== ''),
          ),
        );
        if (suits.length > 0) {
          st.turn.vars[SUITS_VAR] = suits;
          // 投影到 view.turnUsage:
          //  - '成略/suits':供 viewDistance 放宽目标距离(同花色牌无距离限制)
          //  - '杀/unlimited/成略':供 viewSlashMax 放宽出杀次数(同花色杀无次数限制)
          // 前端均宽松放行(无法感知选中卡花色);后端 SlashExemptor/AttackRangeExemptor/
          // DistanceExemptor 按 cardId 花色严格校验(仅同花色放行)。
          await applyAtom(st, {
            type: '回合用量',
            player: from,
            key: SUITS_VAR,
            value: suits,
          });
          await applyAtom(st, {
            type: '回合用量',
            player: from,
            key: slashUnlimitedKey('成略'),
            value: true,
          });
        }
      }

      // 翻转转换态
      st.players[from].vars[STATE_KEY] = stt === '阳' ? '阴' : '阳';
      await syncStateView(st, from);

      await popFrame(st);
    },
  );

  // ── 回合开始:重新同步转换态到 view(回合结束整体清空 turnUsage) ──
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx) => {
    if (ctx.atom.type !== '回合开始') return;
    if (ctx.atom.player !== ownerId) return;
    await syncStateView(ctx.state, ownerId);
  });

  return () => {
    unloadSlashExemptor();
    unloadRangeExemptor();
    unloadDistanceExemptor();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: SKILL_ID,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '发动成略(摸牌并弃置手牌,本阶段同花色牌无距离和次数限制)',
      confirmLabel: '发动',
      cancelLabel: '取消',
    },
    activeWhen: (ctx) => {
      if (!activeUnlessUsedThisTurn(SKILL_ID)(ctx)) return false;
      // 阳 需至少 1 张手牌(摸1弃2)
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      const isYin = p.turnUsage?.[STATE_VIEW_KEY] === '阴';
      if (!isYin && (p.handCount ?? 0) < 1) return false;
      return defaultPlayActive(ctx);
    },
  });

  api.defineAction('respond', {
    label: SKILL_ID,
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '成略:选择要弃置的手牌',
      cardFilter: { filter: () => true, min: 1, max: 99 },
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
