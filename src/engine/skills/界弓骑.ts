// 界弓骑(界韩当·吴·主动技,OL hero/676 界限突破官方逐字):
//   "出牌阶段限一次,你可以弃置一张牌使你本回合攻击范围无限,
//    且你使用与弃置的牌花色相同的【杀】无次数限制。
//    若弃置的牌为装备牌,你可以弃置一名其他角色一张牌。"
//
// 与标版弓骑(韩当·一将成名,未实现)的差异(参考 docs/research/武将技能/吴国/韩当.md):
//   1. 标版:"弃置一张牌令你本回合攻击范围无限,若弃置牌为装备牌,
//            你可以弃置一名其他角色一张牌。"——仅"攻击范围无限"。
//   2. 界版:额外"你使用与弃置的牌花色相同的【杀】无次数限制"。
//   3. "弃装备→弃他人牌"两版相同。
//
// 实现要点:
//   - 主动技 registerAction 'use':参数 { cardId }(要弃置的手牌)。
//   - 限一次:player.vars['界弓骑/usedThisTurn']=true(后缀 /usedThisTurn → 回合结束自动清空)。
//   - 攻击范围无限:turn.vars['界弓骑/active']=ownerId;distance.ts inAttackRange 据此放行,
//     viewDistance.ts viewCanAttack 同步前端 filter。
//   - 同花色杀无次数限制:turn.vars['界弓骑/suit']=suit;杀.ts validate/execute 横切新增分支
//     (同 suit 的杀 bypass canSlash + 跳过 incSlashUsed);action-active.ts viewCanSlash
//     同步前端按钮启用(手中有同花色杀时按钮可点)。
//   - 弃装备后弃他人牌:复用过河拆桥选牌面板(runPickTargetCardPanel);先 confirm 询问是否弃,
//     再 choosePlayer 选目标,再 runPickTargetCardPanel 弃 1 张。
//
// 命名:文件名/loader key/character skill name 均为 '界弓骑'(避开标版弓骑冲突);
//   内部 Skill.name = '弓骑'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import {
  registerAction,
  hasBlockingPending,
  type SkillModule,
} from '../skill';
import { defaultPlayActive } from '../action-active';
import { runPickTargetCardPanel } from './选牌面板';
import { registerAttackRangeExemptor } from '../distance';
import { registerSlashExemptor } from '../slash-quota';

const SKILL_ID = '界弓骑';
const DISPLAY_NAME = '弓骑';

/** player.vars key:本回合已发动(后缀 /usedThisTurn → 回合结束自动清空) */
const USED_KEY = `${SKILL_ID}/usedThisTurn`;
/** turn.vars key:本回合攻击范围无限激活(值=激活者 ownerId) */
const ACTIVE_VAR = `${SKILL_ID}/active`;
/** turn.vars key:本回合无次数限制的杀花色(值=花色字符串) */
const SUIT_VAR = `${SKILL_ID}/suit`;

// 询问 requestType
const CONFIRM_RT = `${SKILL_ID}/confirm`; // 是否弃他人牌
const TARGET_RT = `${SKILL_ID}/选目标`; // 选他人
const PICK_CARD_RT = `${SKILL_ID}/选牌`; // 选他人的牌

// localVars 键
const CONFIRM_KEY = `${SKILL_ID}/confirmed`;
const TARGET_KEY = `${SKILL_ID}/target`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段限一次,弃一张牌使本回合攻击范围无限,且同花色杀无次数限制;弃装备可再弃一名其他角色一张牌',
  };
}

/** 判断玩家本回合是否已发动过弓骑 */
function usedThisTurn(state: GameState, ownerId: number): boolean {
  return state.players[ownerId]?.vars[USED_KEY] === true;
}

/** 玩家区域(手牌+装备)是否有牌可被弃 */
function hasDiscardableCards(player: GameState['players'][number]): boolean {
  if (!player) return false;
  if (player.hand.length > 0) return true;
  return Object.values(player.equipment).some((id) => typeof id === 'string');
}

/** 是否存在可被弃牌的其他角色(存活、非自己、有牌) */
function hasValidTargets(state: GameState, ownerId: number): boolean {
  return state.players.some(
    (p) => p.alive && p.index !== ownerId && hasDiscardableCards(p),
  );
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 距离豁免器:发动后本回合攻击范围无限 ──────────────────────
  //   通过 distance provider 实现,避免污染 杀.ts/distance.ts。
  const unloadRangeExemptor = registerAttackRangeExemptor(
    state,
    ownerId,
    (st, from, _to, _cardId) => st.turn.vars[ACTIVE_VAR] === from,
  );

  // ── 出杀豁免器:与弃置牌同花色的杀不占次数 ─────────────────────
  //   通过 slash-quota provider 实现,避免污染 杀.ts/slash-quota.ts。
  const unloadSlashExemptor = registerSlashExemptor(
    state,
    ownerId,
    (st, player, cardId) => {
      if (st.turn.vars[ACTIVE_VAR] !== player) return false;
      if (!cardId) return false;
      const suit = st.turn.vars[SUIT_VAR];
      if (typeof suit !== 'string') return false;
      const card = st.cardMap[cardId];
      return card?.suit === suit;
    },
  );

  // ── use:主动发动弓骑 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>): string | null => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId)) return '本回合已发动过弓骑';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';

      const cardId = params.cardId as string | undefined;
      if (typeof cardId !== 'string') return '需要选择一张要弃置的手牌';
      if (!self.hand.includes(cardId)) return '牌不在手牌中';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const self = st.players[from];
      const discardedCard = st.cardMap[cardId];

      // 计数 +1(同步设 vars,防 dispatch 重入)。后缀 /usedThisTurn → 回合结束自动清空。
      st.players[from].vars[USED_KEY] = true;

      await pushFrame(st, SKILL_ID, from, { ...params });

      // 1. 弃置代价牌(走完整管线,触发反馈/旋风/枭姬等失牌副作用)
      await applyAtom(st, { type: '弃置', player: from, cardIds: [cardId] });

      // 2. 攻击范围无限 + 同花色杀无次数限制(本回合)。即便弃的牌花色为空(无色合卡),
      //    仍设 ACTIVE_VAR(范围无限对所有杀生效);SUIT_VAR 仅在花色非空时设。
      st.turn.vars[ACTIVE_VAR] = from;
      await applyAtom(st, {
        type: '回合用量',
        player: from,
        key: ACTIVE_VAR,
        value: true,
      });
      if (discardedCard?.suit) {
        st.turn.vars[SUIT_VAR] = discardedCard.suit;
        await applyAtom(st, {
          type: '回合用量',
          player: from,
          key: SUIT_VAR,
          value: discardedCard.suit,
        });
      }

      // 3. 若弃置的牌为装备牌,可弃一名其他角色一张牌
      if (
        discardedCard?.type === '装备牌' &&
        self.alive &&
        hasValidTargets(st, from)
      ) {
        await maybeDiscardOthersCard(st, from);
      }

      await popFrame(st);
    },
  );

  // ── respond:弓骑本人对各询问的回应 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不是请求回应';
      const rt = atom.requestType;
      const valid = [CONFIRM_RT, TARGET_RT, PICK_CARD_RT];
      if (!rt || !valid.includes(rt)) return '当前不是弓骑询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] =
          params.choice === true || params.confirmed === true;
        return;
      }
      if (rt === TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
        return;
      }
      if (rt === PICK_CARD_RT) {
        // 选牌面板结果(与过河拆桥/反馈共用 '选牌/结果' 契约)
        const zone = params.zone;
        if (zone === 'equipment') {
          if (typeof params.cardId !== 'string') return;
        } else if (zone === 'hand') {
          if (typeof params.handIndex !== 'number') return;
        } else {
          return;
        }
        st.localVars['选牌/结果'] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
          handIndex: params.handIndex ?? null,
        };
        return;
      }
    },
  );

  return () => {
    unloadRangeExemptor();
    unloadSlashExemptor();
  };
}

/** 弃置代价牌为装备时,询问是否弃一名其他角色一张牌;确认则选目标+弃牌 */
async function maybeDiscardOthersCard(
  state: GameState,
  ownerId: number,
): Promise<void> {
  // 1. confirm 询问是否弃他人牌
  delete state.localVars[CONFIRM_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CONFIRM_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '弓骑:弃置的牌为装备,是否弃一名其他角色一张牌?',
      confirmLabel: '弃牌',
      cancelLabel: '不弃',
    },
    defaultChoice: false,
    timeout: 10,
  });
  if (!state.localVars[CONFIRM_KEY]) {
    delete state.localVars[CONFIRM_KEY];
    return;
  }
  delete state.localVars[CONFIRM_KEY];

  // 2. 二次校验:自身存活 + 仍有可弃目标
  if (!state.players[ownerId]?.alive) return;
  if (!hasValidTargets(state, ownerId)) return;

  // 3. 选目标(其他存活且有牌的角色)
  delete state.localVars[TARGET_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: TARGET_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: '弓骑:选择要弃置其一张牌的其他角色',
      min: 1,
      max: 1,
      filter: (_view: GameView, t: number) =>
        t !== ownerId &&
        state.players[t]?.alive === true &&
        hasDiscardableCards(state.players[t]),
    },
    timeout: 20,
  });
  const targetIdx = state.localVars[TARGET_KEY] as number | undefined;
  delete state.localVars[TARGET_KEY];
  if (typeof targetIdx !== 'number') return;

  const target = state.players[targetIdx];
  if (!target?.alive || !hasDiscardableCards(target)) return;

  // 4. 用过河拆桥选牌面板从目标弃 1 张(明选装备/盲选手牌;不含判定区)
  await runPickTargetCardPanel(state, ownerId, targetIdx, target, {
    mode: 'discard',
    requestType: PICK_CARD_RT,
    title: `弓骑:选择要从 ${target.name} 弃置的 1 张牌`,
    includeJudge: false,
  });
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '弓骑:选择一张手牌弃置(本回合攻击范围无限,同花色杀无次数限制;装备牌可再弃他人一张牌)',
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      // 本回合未发动过则可发动
      const used = ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.[USED_KEY];
      return used !== true;
    },
  });
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'default',
    prompt: { type: 'confirm', title: '弓骑' },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
