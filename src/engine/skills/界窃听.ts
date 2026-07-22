// 界窃听(界蔡夫人·群·被动技,OL 界限突破官方逐字):
//   其他角色的回合结束后,若其本回合未对其他角色造成伤害,你可以选择一项;
//   若其本回合未对其他角色使用过牌,你可以选择两项;
//   1.将其装备区里的一张牌置入你的装备区;2.摸一张牌。
//
// 界限突破(相对标蔡夫人·窃听 src/engine/skills/窃听.ts,未实现):
//   1. 标版:仅"未使用过牌"一个条件,触发后选 1 项。
//   2. 界版:两个独立条件——"未造成伤害"可触发并选 1 项;"未使用过牌"则升级为选 2 项。
//
// 实现(被动 before-hook on 回合结束 + 多 atom 跟踪):
//   - 期间跟踪(turn.vars,由「回合结束」atom apply 自动清空):
//       * 造成伤害 after-hook:source=currentPlayer && target≠currentPlayer && amount>0
//         → turn.vars['界窃听/damagedOther']=true
//       * 指定目标/询问闪/询问杀 after-hook:source=currentPlayer && target≠currentPlayer
//         → turn.vars['界窃听/usedCardOnOther']=true
//         (覆盖 杀/顺/过/借/决/火 等单点,以及 万箭齐发/南蛮入侵/决斗 等 AoE 与隐式目标)
//   - 触发(回合结束 before-hook,在 apply 清空 turn.vars 之前读取):
//       * 跳过 owner 自己的回合(atom.player === ownerId)
//       * 计算 choices = noDamage ? (noCardUse ? 2 : 1) : 0
//         (官方"若A选1项;若B选2项"渐进式:满足 A 触发;同时满足 B 升级)
//       * 询问是否发动 → 0/1/2 步执行(夺装备 / 摸牌)
//   - 夺装备(选项1):pickTargetCard 选 target 装备区一张牌 → 取到 owner 手牌 →
//     若 owner 同槽位已有装备则替换(移除技能+卸下+弃置)→ 装备 + 添加技能。
//
// 命名:文件名/loader key/character skill name 均为 '界窃听'(避开与未来标版冲突);
//   内部 Skill.name = '窃听'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, HookResult, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook, type SkillModule } from '../skill';
import { skillLoaders } from './index';

const SKILL_ID = '界窃听';
const DISPLAY_NAME = '窃听';

/** turn.vars key:本回合 currentPlayer 是否对其他角色造成过伤害(随 回合结束 清空) */
const DAMAGED_OTHER_KEY = `${SKILL_ID}/damagedOther`;
/** turn.vars key:本回合 currentPlayer 是否对其他角色使用过牌 */
const USED_CARD_ON_OTHER_KEY = `${SKILL_ID}/usedCardOnOther`;
/** 询问 RT:是否发动窃听(confirm) */
const TRIGGER_RT = `${SKILL_ID}/trigger`;
/** 询问 RT:1 选择时——夺装备还是摸牌(confirm) */
const STEAL_OR_DRAW_RT = `${SKILL_ID}/stealOrDraw`;
/** 询问 RT:夺装备路径下,选 target 装备区一张牌(pickTargetCard) */
const PICK_EQUIP_RT = `${SKILL_ID}/pickEquip`;
/** localVars:trigger confirm 结果(true/false) */
const CONFIRM_KEY = `${SKILL_ID}/confirmed`;
/** localVars:steal-or-draw confirm 结果(true=夺装备,false=摸牌) */
const STEAL_CHOICE_KEY = `${SKILL_ID}/stealChoice`;
/** localVars:pickEquip 结果({zone,cardId}) */
const PICK_RESULT_KEY = `${SKILL_ID}/pickResult`;
/** localVars:暂存 turnPlayer 座次 */
const TURN_PLAYER_KEY = `${SKILL_ID}/turnPlayer`;
/** localVars:暂存 choices 数(1/2) */
const CHOICES_KEY = `${SKILL_ID}/choices`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '其他角色的回合结束后,若其本回合未对其他角色造成伤害可选一项;若未使用过牌可选两项:1.夺其一张装备;2.摸一张牌',
  };
}

/** 当前回合玩家是否对其他角色造成过伤害 */
function damagedOtherThisTurn(state: GameState): boolean {
  return state.turn.vars[DAMAGED_OTHER_KEY] === true;
}
/** 当前回合玩家是否对其他角色使用过牌 */
function usedCardOnOtherThisTurn(state: GameState): boolean {
  return state.turn.vars[USED_CARD_ON_OTHER_KEY] === true;
}

/**
 * 执行"夺取 target 一张装备置入 owner 装备区"流程。
 * 调用方需保证 target 装备区非空、owner 与 target 均存活。
 */
async function executeStealEquip(
  state: GameState,
  ownerId: number,
  turnPlayer: number,
): Promise<void> {
  const targetPlayer = state.players[turnPlayer];
  if (!targetPlayer?.alive) return;

  // 装备列表(仅装备,无判定/手牌)
  const equipment = Object.entries(targetPlayer.equipment)
    .filter(([, id]) => typeof id === 'string')
    .map(([slot, id]) => ({
      slot,
      cardId: id as string,
      cardName: state.cardMap[id as string]?.name ?? '?',
    }));
  if (equipment.length === 0) return;

  // 弹选牌面板:owner 选一张 target 的装备
  delete state.localVars[PICK_RESULT_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: PICK_EQUIP_RT,
    target: ownerId,
    prompt: {
      type: 'pickTargetCard',
      title: `窃听:选择 ${targetPlayer.name ?? `P${turnPlayer}`} 装备区一张牌置入你的装备区`,
      target: turnPlayer,
      equipment,
      judge: [],
      handCount: 0,
    },
    defaultChoice: { zone: 'equipment', cardId: equipment[0].cardId } as unknown as Json,
    timeout: 20,
  });

  const result = state.localVars[PICK_RESULT_KEY] as
    | { zone?: string; cardId?: string }
    | undefined;
  delete state.localVars[PICK_RESULT_KEY];

  const cardId =
    result?.zone === 'equipment' && typeof result.cardId === 'string'
      ? result.cardId
      : equipment[0].cardId;
  // 校验:cardId 在 target 装备区
  const slotEntry = equipment.find((e) => e.cardId === cardId);
  if (!slotEntry) return;
  const slot = slotEntry.slot as '武器' | '防具' | '进攻马' | '防御马' | '宝物';
  const card = state.cardMap[cardId];
  if (!card) return;

  // 1. 移除 target 该装备的自带技能(若有)
  if (card.name && skillLoaders[card.name]) {
    await applyAtom(state, { type: '移除技能', player: turnPlayer, skillId: card.name });
  }
  // 2. 从 target 装备区取到 owner 手牌(获得 atom 同时清理 target.equipment[slot])
  await applyAtom(state, { type: '获得', player: ownerId, cardId, from: turnPlayer });

  // 3. 若 owner 同槽位已有装备:替换(移除技能 + 卸下 + 移动牌 to 弃牌堆,与 装备通用 对齐)
  const myOld = state.players[ownerId].equipment[slot];
  if (myOld) {
    const oldCard = state.cardMap[myOld];
    if (oldCard?.name && skillLoaders[oldCard.name]) {
      await applyAtom(state, { type: '移除技能', player: ownerId, skillId: oldCard.name });
    }
    await applyAtom(state, { type: '卸下', player: ownerId, slot });
    await applyAtom(state, {
      type: '移动牌',
      cardId: myOld,
      from: { zone: '手牌', player: ownerId },
      to: { zone: '弃牌堆' },
    });
  }

  // 4. 装备 stolen card(此时牌已在 owner 手牌)
  await applyAtom(state, { type: '装备', player: ownerId, cardId });
  // 5. 添加 stolen card 的自带技能(若有)
  if (card.name && skillLoaders[card.name]) {
    await applyAtom(state, { type: '添加技能', player: ownerId, skillId: card.name });
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:owner 回应窃听各类询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as Record<string, unknown>).requestType as string;
      if (rt !== TRIGGER_RT && rt !== STEAL_OR_DRAW_RT && rt !== PICK_EQUIP_RT) {
        return '当前不是窃听询问';
      }
      if (rt === PICK_EQUIP_RT) {
        // 选 target 装备:zone='equipment' + cardId
        if (params.zone !== 'equipment') return '需要选装备';
        if (typeof params.cardId !== 'string') return '需要 cardId';
        // 校验 cardId 在 target 装备区
        const turnPlayer = st.localVars[TURN_PLAYER_KEY];
        if (typeof turnPlayer !== 'number') return '询问状态异常';
        const tp = st.players[turnPlayer];
        if (!tp) return '目标不存在';
        const inEquip = Object.values(tp.equipment).includes(params.cardId);
        if (!inEquip) return '该牌不在目标装备区';
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as Record<string, unknown> | undefined)?.requestType as string;
      if (rt === TRIGGER_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === STEAL_OR_DRAW_RT) {
        st.localVars[STEAL_CHOICE_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === PICK_EQUIP_RT) {
        st.localVars[PICK_RESULT_KEY] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
        } as Json;
      }
    },
  );

  // ── 跟踪:造成伤害 after-hook(本回合 currentPlayer 是否对其他角色造过伤害)──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    const cur = ctx.state.currentPlayerIndex;
    if (atom.source !== cur) return;
    if (atom.target === cur) return;
    if ((atom.amount ?? 0) <= 0) return;
    ctx.state.turn.vars[DAMAGED_OTHER_KEY] = true;
  });

  // ── 跟踪:指定目标 after-hook(单点目标牌:杀/顺/过/借/决/火 等)──
  registerAfterHook(state, skill.id, ownerId, '指定目标', async (ctx) => {
    const atom = ctx.atom;
    const cur = ctx.state.currentPlayerIndex;
    if (atom.source !== cur) return;
    if (atom.target === cur) return;
    ctx.state.turn.vars[USED_CARD_ON_OTHER_KEY] = true;
  });

  // ── 跟踪:询问闪 after-hook(AoE:万箭齐发;以及杀的隐式目标)──
  registerAfterHook(state, skill.id, ownerId, '询问闪', async (ctx) => {
    const atom = ctx.atom;
    const cur = ctx.state.currentPlayerIndex;
    if (atom.source !== cur) return;
    if (atom.target === cur) return;
    ctx.state.turn.vars[USED_CARD_ON_OTHER_KEY] = true;
  });

  // ── 跟踪:询问杀 after-hook(AoE:南蛮入侵;以及决斗)──
  registerAfterHook(state, skill.id, ownerId, '询问杀', async (ctx) => {
    const atom = ctx.atom;
    const cur = ctx.state.currentPlayerIndex;
    if (atom.source !== cur) return;
    if (atom.target === cur) return;
    ctx.state.turn.vars[USED_CARD_ON_OTHER_KEY] = true;
  });

  // ── 触发:回合结束 before-hook(在 apply 清空 turn.vars 之前读取跟踪值)──
  registerBeforeHook(state, skill.id, ownerId, '回合结束', async (ctx): Promise<HookResult | void> => {
    const atom = ctx.atom;
    const turnPlayer = atom.player;
    if (typeof turnPlayer !== 'number') return { kind: 'pass' };
    if (turnPlayer === ownerId) return { kind: 'pass' }; // 仅其他角色的回合
    if (!ctx.state.players[ownerId]?.alive) return { kind: 'pass' };

    const noDamage = !damagedOtherThisTurn(ctx.state);
    const noCardUse = !usedCardOnOtherThisTurn(ctx.state);

    // 渐进式选择数:未造伤→1 项;未造伤且未用牌→2 项;造伤则不触发
    const choices = noDamage ? (noCardUse ? 2 : 1) : 0;
    if (choices === 0) return { kind: 'pass' };

    // 暂存 turnPlayer / choices(跨多步询问)
    ctx.state.localVars[TURN_PLAYER_KEY] = turnPlayer;
    ctx.state.localVars[CHOICES_KEY] = choices;

    // 询问:是否发动窃听?
    delete ctx.state.localVars[CONFIRM_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: TRIGGER_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `窃听:${ctx.state.players[turnPlayer]?.name ?? `P${turnPlayer}`} 本回合${noDamage ? '未' : '已'}对其他角色造成伤害,${noCardUse ? '未' : '已'}使用过牌。是否发动?`,
        description: choices === 2 ? '可选两项(夺装备+摸牌)' : '可选一项(夺装备或摸牌)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });

    if (ctx.state.localVars[CONFIRM_KEY] !== true) {
      delete ctx.state.localVars[CONFIRM_KEY];
      delete ctx.state.localVars[TURN_PLAYER_KEY];
      delete ctx.state.localVars[CHOICES_KEY];
      return { kind: 'pass' };
    }
    delete ctx.state.localVars[CONFIRM_KEY];

    // 二次校验:turnPlayer / owner 仍存活
    if (!ctx.state.players[turnPlayer]?.alive || !ctx.state.players[ownerId]?.alive) {
      delete ctx.state.localVars[TURN_PLAYER_KEY];
      delete ctx.state.localVars[CHOICES_KEY];
      return { kind: 'pass' };
    }

    const hasEquip = Object.values(ctx.state.players[turnPlayer].equipment).some(
      (id) => typeof id === 'string',
    );

    if (choices === 1) {
      // 选一项:有装备询问,无装备则只能摸牌
      if (hasEquip) {
        delete ctx.state.localVars[STEAL_CHOICE_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: STEAL_OR_DRAW_RT,
          target: ownerId,
          prompt: {
            type: 'confirm',
            title: '窃听:夺一张装备?(确认=夺装备,取消=摸一张牌)',
            confirmLabel: '夺装备',
            cancelLabel: '摸一张牌',
          },
          defaultChoice: false,
          timeout: 15,
        });
        const steal = ctx.state.localVars[STEAL_CHOICE_KEY] === true;
        delete ctx.state.localVars[STEAL_CHOICE_KEY];
        if (steal) {
          await executeStealEquip(ctx.state, ownerId, turnPlayer);
        } else {
          await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
        }
      } else {
        // 无可夺装备:仅可摸牌(选项1 不可用)
        await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
      }
    } else {
      // choices === 2:选两项 = 都执行(若有装备)
      if (hasEquip) {
        await executeStealEquip(ctx.state, ownerId, turnPlayer);
      }
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    }

    delete ctx.state.localVars[TURN_PLAYER_KEY];
    delete ctx.state.localVars[CHOICES_KEY];
    return { kind: 'pass' };
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动窃听?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
