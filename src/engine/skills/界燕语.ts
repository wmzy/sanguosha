// 界燕语(界夏侯氏·主动技,OL 界限突破官方逐字):
//   出牌阶段，你可以重铸【杀】。出牌阶段结束时，若你本阶段失去过至少两张【杀】，
//   你可以令一名男性角色摸两张牌。
//
// 界限突破(相对标燕语,标版未实现):
//   1. 标版:出牌阶段,你可以重铸【杀】。出牌阶段结束时,若你于本阶段重铸过至少两张【杀】,
//      你可以令一名男性角色摸两张牌。
//   2. 界版:第一段相同(重铸杀);第二段从"重铸过"放宽为"失去过"
//      (含使用/被弃/被偷/转化后使用等任意离开手牌的途径)。
//
// 实现要点:
//   - 重铸杀(recycle action):无次数限制。出牌阶段,弃一张手牌中的【杀】,摸一张牌。
//     模式参考连环/铁索连环的 recycle。无 frame pushFrame 仅做包装日志。
//   - 失去过杀计数:owner.vars['界燕语/lostShaThisPhase'](number,仅 owner 出牌阶段有效)
//     生产者:
//       移动牌 after-hook(from.zone='手牌' && from.player=owner && card.name='杀')
//       弃置 after-hook(player=owner, 统计 cardIds 中杀的数量)
//     消费者:阶段结束(出牌) after-hook,≥2 则触发
//     重置:阶段开始(出牌) after-hook(player=owner) → 置 0
//   - 触发时机:阶段结束(出牌) after-hook(player=owner)。
//   - 男性角色判定:getGender(character) === '男';界夏侯氏为女性,天然排除自身。
//   - 非锁定技(描述以"你可以"开头):受 界铁骑/义绝 非锁定技压制影响。
//   - "失去过"覆盖使用/重铸/弃置/转化后打出/被偷 等手牌→他处路径。
//     装备/判定区牌再离开不计(仅手牌中的【杀】失去才计)。
//
// 命名:文件名/loader key/character skill name 均为 '界燕语';
//   内部 Skill.name = '燕语'(OL 官方技能名,玩家可见)。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import {
  registerAction,
  registerAfterHook,
  hasBlockingPending,
  type SkillModule,
} from '../skill';
import { getGender } from '../character-meta';

const SKILL_ID = '界燕语';
const DISPLAY_NAME = '燕语';

/** owner.vars key:本阶段已失去的【杀】数(number) */
const LOST_SHA_KEY = `${SKILL_ID}/lostShaThisPhase`;
/** 询问 requestType:是否发动燕语(第二段) */
const CONFIRM_RT = `${SKILL_ID}/confirm`;
/** 询问 requestType:选一名男性角色 */
const TARGET_RT = `${SKILL_ID}/target`;
/** localVars key:owner 是否确认发动(true/false) */
const CONFIRMED_KEY = `${SKILL_ID}/confirmed`;
/** localVars key:owner 选中的男性角色座次(number) */
const TARGET_KEY = `${SKILL_ID}/targetChoice`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段,你可以重铸【杀】;出牌阶段结束时,若你本阶段失去过至少两张【杀】,可令一名男性角色摸两张牌',
  };
}

function getLostSha(state: GameState, ownerId: number): number {
  return (state.players[ownerId]?.vars[LOST_SHA_KEY] as number | undefined) ?? 0;
}

function addLostSha(state: GameState, ownerId: number, n: number): void {
  const self = state.players[ownerId];
  if (!self) return;
  const cur = getLostSha(state, ownerId);
  self.vars[LOST_SHA_KEY] = cur + n;
}

/** 是否处于 owner 的出牌阶段(用于增计数 hooks 的门控) */
function inMyPlayPhase(state: GameState, ownerId: number): boolean {
  return state.currentPlayerIndex === ownerId && state.phase === '出牌';
}

/** 校验某座次是否为存活男性 */
function isMaleAlive(state: GameState, target: number): boolean {
  const p = state.players[target];
  if (!p?.alive) return false;
  return getGender(p.character) === '男';
}

function hasMaleAlive(state: GameState): boolean {
  return state.players.some((p) => p.alive && getGender(p.character) === '男');
}

function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as unknown as Record<string, unknown>).requestType as string | undefined;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── recycle:出牌阶段,弃一张手牌中的【杀】,摸一张牌(重铸) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'recycle',
    (st: GameState, params: Record<string, Json>) => {
      const myTurn = st.currentPlayerIndex === ownerId;
      const inActPhase = st.phase === '出牌';
      const free = !hasBlockingPending(st);
      const self = st.players[ownerId];
      const selfAlive = self?.alive === true;
      const cardId = params.cardId as string;
      const cardIdOk = typeof cardId === 'string';
      const card = cardIdOk ? st.cardMap[cardId] : undefined;
      const cardInHand = cardIdOk && self.hand.includes(cardId);
      const isSha = !!card && card.name === '杀';
      const ok = myTurn && inActPhase && free && selfAlive && cardInHand && isSha;
      return ok ? null : '现在不能重铸(需出牌阶段、手中【杀】)';
    },
    async (st: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      await pushFrame(st, SKILL_ID, from, { ...params, recycle: true });
      await applyAtom(st, { type: '弃置', player: from, cardIds: [cardId] });
      await applyAtom(st, { type: '摸牌', player: from, count: 1 });
      await popFrame(st);
    },
  );

  // ── respond:owner 在 confirm / target 询问下的回应 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const rt = currentRequestType(st, ownerId);
      if (rt !== CONFIRM_RT && rt !== TARGET_RT) return '当前不是燕语询问';
      if (rt === TARGET_RT) {
        const t = params.target as number | undefined;
        if (typeof t !== 'number') return '请选择一名男性角色';
        if (!isMaleAlive(st, t)) return '目标必须是存活的男性角色';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const rt = currentRequestType(st, ownerId);
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === TARGET_RT) {
        st.localVars[TARGET_KEY] = params.target as number;
      }
    },
  );

  // ── 阶段开始(出牌) after-hook:owner 出牌阶段开始 → 重置 lostSha 计数 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '出牌') return;
    if (atom.player !== ownerId) return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    self.vars[LOST_SHA_KEY] = 0;
  });

  // ── 移动牌 after-hook:owner 手牌中的【杀】移出 → lostSha +1 ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx: AtomAfterContext) => {
    if (!inMyPlayPhase(ctx.state, ownerId)) return;
    const atom = ctx.atom as {
      cardId?: string;
      from?: { zone?: string; player?: number };
    };
    if (atom.from?.zone !== '手牌') return;
    if (atom.from.player !== ownerId) return;
    const cardId = atom.cardId;
    if (typeof cardId !== 'string') return;
    const card = ctx.state.cardMap[cardId];
    if (!card || card.name !== '杀') return;
    addLostSha(ctx.state, ownerId, 1);
  });

  // ── 弃置 after-hook:owner 弃置的【杀】计入 lostSha ──
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx: AtomAfterContext) => {
    if (!inMyPlayPhase(ctx.state, ownerId)) return;
    const atom = ctx.atom as { player?: number; cardIds?: string[] };
    if (atom.player !== ownerId) return;
    const ids = Array.isArray(atom.cardIds) ? atom.cardIds : [];
    const shaCount = ids.filter((id) => ctx.state.cardMap[id]?.name === '杀').length;
    if (shaCount > 0) addLostSha(ctx.state, ownerId, shaCount);
  });

  // ── 阶段结束(出牌) after-hook:owner 出牌阶段结束 → 若 lostSha≥2 触发 ──
  registerAfterHook(state, skill.id, ownerId, '阶段结束', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段结束') return;
    if (atom.phase !== '出牌') return;
    if (atom.player !== ownerId) return;
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;
    if (getLostSha(st, ownerId) < 2) return;
    if (!hasMaleAlive(st)) return; // 无男性存活 → 不询问

    // 1. 询问是否发动(非锁定技,默认不发动)
    delete st.localVars[CONFIRMED_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动燕语?(令一名男性角色摸两张牌)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!st.localVars[CONFIRMED_KEY]) return;
    delete st.localVars[CONFIRMED_KEY];

    // 2. 选一名男性角色
    delete st.localVars[TARGET_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: TARGET_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '燕语:选择一名男性角色(其摸两张牌)',
        min: 1,
        max: 1,
        filter: (view, t) =>
          view.players[t]?.alive === true && getGender(view.players[t].character) === '男',
      },
      timeout: 15,
    });
    const target = st.localVars[TARGET_KEY] as number | undefined;
    delete st.localVars[TARGET_KEY];
    if (typeof target !== 'number') return;
    if (!st.players[target]?.alive) return;

    // 3. 目标摸 2 张
    await applyAtom(st, { type: '摸牌', player: target, count: 2 });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('recycle', {
    label: `${DISPLAY_NAME}·重铸`,
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '燕语:重铸一张【杀】(弃此牌,摸一张)',
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
    },
  });
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动燕语?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
