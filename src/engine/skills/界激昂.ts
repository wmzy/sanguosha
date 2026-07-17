// 界激昂(界孙策·被动技,OL hero/452 官方逐字):
//   当你使用【决斗】或红色【杀】指定目标后，或成为【决斗】或红色【杀】的目标后，
//   你可以摸一张牌。每回合首次【决斗】或红色【杀】因弃置进入弃牌堆后，
//   你可以失去1点体力获得之。
//
// 两段式加强版(相对标激昂 src/engine/skills/激昂.ts,不修改标版):
//   第一段(同标激昂):使用/被使用 决斗或红色杀 → 可摸一张牌
//     (after-hook 挂「成为目标」,覆盖使用/被使用四种情形;source 情形按 cardId 去重)
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
//   - 同时弃置多张此类牌:只取首张(每回合限一次)。
//
// 命名:文件/loader key/character skill name = '界激昂'(避开标激昂冲突);
//   内部 Skill.name = '激昂'(OL 官方技能名,玩家可见)。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const SKILL_ID = '界激昂';
const DISPLAY_NAME = '激昂';

// 第一段:使用/被使用 → 摸一张牌
const CONFIRM_RT = `${SKILL_ID}/confirm`;
const CONFIRMED_KEY = `${SKILL_ID}/confirmed`;
/** source 情形去重:已为本 cardId 触发过(localVars 标记,键含 cardId) */
function srcDoneKey(cardId: string): string {
  return `${SKILL_ID}/src/${cardId}`;
}

// 第二段:因弃置入弃牌堆 → 可失去1体力获得之(每回合限一次)
const RECYCLE_RT = `${SKILL_ID}/recycle`;
const RECYCLE_CONFIRM_KEY = `${SKILL_ID}/recycleConfirm`;
/** 每回合限一次标记:后缀 /usedThisTurn 由「回合结束」atom 自动清空 */
const RECYCLE_USED_KEY = `${SKILL_ID}/recycle/usedThisTurn`;

/** 判定是否为激昂可触发场景(决斗或红色杀);与标激昂同款判定 */
function isJiangTrigger(state: GameState, cardId: string | undefined): boolean {
  const card = cardId ? state.cardMap[cardId] : undefined;
  if (card?.name === '决斗') return true;
  if (card?.name === '杀' && card.color === '红') return true;
  // 虚拟决斗(离间无实体牌):用当前结算帧兜底
  const frameSkill = topFrame(state)?.skillId;
  if (frameSkill === '决斗' || frameSkill === '离间') return true;
  return false;
}

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
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== CONFIRM_RT && rt !== RECYCLE_RT) return '当前不是界激昂确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return;
      const rt = (slot.atom as Record<string, unknown>)['requestType'] as string;
      const yes = params.choice === true || params.confirmed === true;
      if (rt === CONFIRM_RT) st.localVars[CONFIRMED_KEY] = yes;
      else st.localVars[RECYCLE_CONFIRM_KEY] = yes;
    },
  );

  // ── 第一段:成为目标 after-hook(覆盖使用/被使用全部情形,同标激昂)──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '成为目标',
    async (ctx: AtomAfterContext): Promise<void> => {
      const atom = ctx.atom as { source?: number; target?: number; cardId?: string };
      const involved = atom.source === ownerId || atom.target === ownerId;
      if (!involved) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (!isJiangTrigger(ctx.state, atom.cardId)) return;

      // source 情形去重:多目标杀只触发一次
      if (atom.source === ownerId) {
        const cardId = atom.cardId ?? '__virtual__';
        const key = srcDoneKey(cardId);
        if (ctx.state.localVars[key]) return;
        ctx.state.localVars[key] = true;
      }

      // 询问是否发动(可选)
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动激昂?(摸一张牌)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!ctx.state.localVars[CONFIRMED_KEY]) return;

      // 发动:摸一张牌
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    },
  );

  // ── 第二段:弃置 after-hook — 每回合首次 决斗或红色杀 因弃置入弃牌堆 ──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '弃置',
    async (ctx: AtomAfterContext): Promise<void> => {
      const atom = ctx.atom as { player?: number; cardIds?: string[] };
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      // 每回合限一次(任意玩家弃置都算,不按 atom.player 过滤)
      if (ctx.state.players[ownerId].vars[RECYCLE_USED_KEY]) return;

      const cardIds = atom.cardIds ?? [];
      // 取首张符合条件的牌(同时弃多张只触发一次)
      const target = cardIds.find((id) => isJiangTrigger(ctx.state, id));
      if (!target) return;

      // 标记本回合已用(每回合首次,无论是否发动都消耗额度)
      ctx.state.players[ownerId].vars[RECYCLE_USED_KEY] = true;

      // 询问是否失去1点体力获得之
      delete ctx.state.localVars[RECYCLE_CONFIRM_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: RECYCLE_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动激昂?(失去1点体力获得此牌)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (!ctx.state.localVars[RECYCLE_CONFIRM_KEY]) return;

      // 发动:失去1点体力(非伤害,不触发伤害技;体力归零由系统规则进入濒死)
      await applyAtom(ctx.state, { type: '失去体力', target: ownerId, amount: 1 });
      // 获得该牌:弃牌堆 → 手牌
      await applyAtom(ctx.state, {
        type: '移动牌',
        cardId: target,
        from: { zone: '弃牌堆' },
        to: { zone: '手牌', player: ownerId },
      });
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动激昂?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
