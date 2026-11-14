// 界激昂(界孙策·被动技,OL hero/452 官方逐字):
//   当你使用【决斗】或红色【杀】指定目标后，或成为【决斗】或红色【杀】的目标后，
//   你可以摸一张牌。每回合首次【决斗】或红色【杀】因弃置进入弃牌堆后，
//   你可以失去1点体力获得之。
//
// 两段式加强版(相对标激昂 src/engine/skills/激昂.ts,不修改标版):
//   第一段(同标激昂):使用/被使用 决斗或红色杀 → 可摸一张牌
//     (复用标版导出的 registerJiangFirstStage 工厂:after-hook 挂「成为目标」,
//      覆盖使用/被使用四种情形;source 情形按 cardId 去重;键前缀 '界激昂' 与标版隔离)
//   第二段(界新增):每回合首次有 决斗或红色杀「因弃置」入弃牌堆 → 可失去1点体力获得之
//     (after-hook 挂「弃置」atom;每回合限一次)
//
// 第二段语义要点:
//   - 「因弃置」= 走「弃置」atom 进入弃牌堆(弃牌阶段弃牌、技能弃置),
//     不含使用结算后的正常入堆(走「移动牌」atom)。故挂「弃置」after-hook 精确命中。
//   - 「每回合首次」:不区分谁的回合、谁弃的牌;本回合内首次有此类牌因弃置入堆即触发,
//     无论是否发动都消耗本回合额度(player.vars['界激昂/recycle/usedThisTurn'],
//     后缀 /usedThisTurn 由「回合结束」atom 自动清空)。
//   - 任意玩家弃置的此类牌都触发(官方未限定弃置者),不按 atom.player 过滤。
//   - 同时弃置多张此类牌:全部获得之(每回合限一次,失1体力获得全部符合条件的牌)。
//
// 命名:文件/loader key/character skill name = '界激昂'(避开标激昂冲突);
//   内部 Skill.name = '激昂'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply'
import { registerAction, registerAfterHook } from '../core/skill';
import {
  askConfirm,
  currentRequestType,
  defineConfirmAction,
  requireRequestType,
} from '../util/skillRuntime';
import { isJiangTrigger, registerJiangFirstStage } from './激昂';

const SKILL_ID = '界激昂';
const DISPLAY_NAME = '激昂';

// 第一段:使用/被使用 → 摸一张牌(共享工厂 registerJiangFirstStage 派生同前缀键)
const CONFIRM_RT = `${SKILL_ID}/confirm`;
const CONFIRMED_KEY = `${SKILL_ID}/confirmed`;

// 第二段:因弃置入弃牌堆 → 可失去1体力获得之(每回合限一次)
const RECYCLE_RT = `${SKILL_ID}/recycle`;
const RECYCLE_CONFIRM_KEY = `${SKILL_ID}/recycleConfirm`;
/** 每回合限一次标记:后缀 /usedThisTurn 由「回合结束」atom 自动清空 */
const RECYCLE_USED_KEY = `${SKILL_ID}/recycle/usedThisTurn`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '使用/被使用【决斗】或红色【杀】时可摸一张牌;每回合首次此类牌因弃置入弃牌堆时可失去1体力获得之',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:界孙策回应是否发动激昂(第一段 confirm / 第二段 recycle confirm)──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      return requireRequestType(st, ownerId, [CONFIRM_RT, RECYCLE_RT], {
        mismatchError: '当前不是界激昂确认',
      }).error;
    },
    async (st: GameState, params: Record<string, Json>) => {
      // validate 已断言 pending slot 为 请求回应 且 requestType ∈ 两段之一;
      // 此处按 currentRequestType 分流结果键(skillRuntime 共享读取,替代手写 slot 解析)
      const rt = currentRequestType(st, ownerId);
      if (rt === undefined) return;
      const yes = params.choice === true || params.confirmed === true;
      if (rt === CONFIRM_RT) st.localVars[CONFIRMED_KEY] = yes;
      else st.localVars[RECYCLE_CONFIRM_KEY] = yes;
    },
  );

  // ── 第一段:成为目标 after-hook(覆盖使用/被使用全部情形;标激昂共享工厂)──
  registerJiangFirstStage(skill.id, state, ownerId, { keyPrefix: SKILL_ID });

  // ── 第二段:弃置 after-hook — 每回合首次 决斗或红色杀 因弃置入弃牌堆 ──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '弃置',
    async (ctx): Promise<void> => {
      const atom = ctx.atom;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      // 每回合限一次(任意玩家弃置都算,不按 atom.player 过滤)
      if (ctx.state.players[ownerId].vars[RECYCLE_USED_KEY]) return;

      const cardIds = atom.cardIds ?? [];
      // 取全部符合条件的牌(同时弃多张决斗/红杀应全部获得之;每回合限一次)
      // 弃置的必是真实牌:按牌本身身份判定,禁用虚拟决斗帧兜底
      // (否则离间等在「弃置」时帧顶为决斗/离间,会误判代价牌为决斗/红杀)
      const targets = cardIds.filter((id) => isJiangTrigger(ctx.state, id, false));
      if (targets.length === 0) return;

      // 标记本回合已用(每回合首次,无论是否发动都消耗额度)
      ctx.state.players[ownerId].vars[RECYCLE_USED_KEY] = true;

      // 询问是否失去1点体力获得之
      const recycle = await askConfirm(ctx.state, RECYCLE_RT, ownerId, {
        confirmedKey: RECYCLE_CONFIRM_KEY,
        title: '是否发动激昂?(失去1点体力获得此牌)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
        defaultChoice: false,
        timeout: 15,
      });
      if (!recycle) return;

      // 发动:失去1点体力(非伤害,不触发伤害技;体力归零由系统规则进入濒死)
      await applyAtom(ctx.state, { type: '失去体力', target: ownerId, amount: 1 });
      // 失血致死(无人救援)→ 不再获得牌(对齐 界天香/奋激/武烈 失血致死早退)
      if (!ctx.state.players[ownerId]?.alive) return;
      // 获得全部符合条件的牌:弃牌堆 → 手牌(移动牌 atom 一次一张,逐张移动)
      // 逐张校验 discardPile.includes:失去体力触发的濒死/死亡流程可能移走弃牌堆中的牌
      for (const cid of targets) {
        if (!ctx.state.zones.discardPile.includes(cid)) continue;
        await applyAtom(ctx.state, {
          type: '移动牌',
          cardId: cid,
          from: { zone: '弃牌堆' },
          to: { zone: '手牌', player: ownerId },
        });
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  defineConfirmAction(api, 'respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    title: '是否发动激昂?',
    confirmLabel: '发动',
    cancelLabel: '不发动',
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
