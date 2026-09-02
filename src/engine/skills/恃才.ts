// 恃才(许攸·群·被动技,OL hero/406 风林火山官方逐字):
//   "当你每回合首次使用一种类型的牌后,你可以将之置于牌堆顶,然后摸一张牌。"
//
// 触发模型:每回合,owner 首次"使用"某类型(基本牌/锦囊牌/装备牌)的牌后触发。
//   - 使用时 after-hook:声明阶段记录类型占用(首次的牌标记为 eligible)。
//     按声明顺序(使用时)判定"首次",而非结算完成顺序(使用结算结束后)——
//     嵌套出牌(B 在 A 结算中使用)时,B.使用时 晚于 A.使用时,A 占用类型,B 不再首占。
//   - 使用结算结束后 after-hook:若此牌 eligible,询问发动;发动则将此牌置牌堆顶 + 摸一张。
//     此时牌已离开处理区:基本牌/锦囊牌在弃牌堆,装备牌在装备区。
//
// 置牌堆顶的实现(牌堆顶 = deck 末尾,摸牌 atom 从末尾抽):
//   · 基本牌/锦囊牌:移动牌 弃牌堆→牌堆(push 到 deck 末尾 = 牌堆顶)。
//   · 装备牌:先 卸下(装备区→手牌,清武器距离 vars),再 移动牌 手牌→牌堆。
//   · 延时锦囊(判定区)/其它:无法置顶 → 跳过置顶(仅摸牌)。
//
// 摸牌联动寸目:恃才的摸牌走 摸牌 atom → 寸目 before-hook 改为从牌堆底摸。
//   故"置牌堆顶 + 摸牌(底)"不会把刚置顶的牌摸回(置顶牌留顶,摸牌从底)。
//
// 类型占用:turn.vars['恃才/已用类型'] = string[](本回合已占用的类型)。
//   eligible 追踪:turn.vars['恃才/待触发'] = string[](待触发的 cardId effective id)。
//   均随 turn.vars 在回合结束自动清空。
//
// 转化牌(影子卡):effectiveId = card.shadowOf ?? cardId。使用时与使用结算结束后
//   均用 effectiveId 关联;弃牌堆中影子卡已被引擎还原为原卡,用 effectiveId 查找。
//
// 范围:owner 使用的所有牌(主动使用 + 被迫使用如逼杀;respond 出闪亦走 runUseFlow
//   → 使用时,故防守出闪也可触发)。source===ownerId 判定。
import type { EquipSlot, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import type { SkillModule } from '../types';

const SKILL_ID = '恃才';
/** turn.vars:本回合已占用的牌类型(string[])。 */
const USED_TYPES_VAR = '恃才/已用类型';
/** turn.vars:待触发的 effective cardId(string[])。 */
const PENDING_VAR = '恃才/待触发';
/** localVars:恃才发动确认结果。 */
const CONFIRM_KEY = '恃才/confirmed';
/** 帧参数 key:使用时记录的实体卡 id(转化牌为原卡,真实牌即本体)。 */
const EFFECTIVE_ID_KEY = '恃才/effectiveCardId';
/** 询问 requestType(T1:前缀 = skillId)。 */
const CONFIRM_RT = '恃才/confirm';

/** 计算牌的有效 id(转化牌用原卡 id)。 */
function effectiveIdOf(state: GameState, cardId: string): string {
  const card = state.cardMap[cardId];
  return card?.shadowOf ?? cardId;
}

/** 在 owner 装备区查找 cardId 所在槽位。 */
function findEquipSlot(state: GameState, ownerId: number, cardId: string): EquipSlot | null {
  const equip = state.players[ownerId]?.equipment;
  if (!equip) return null;
  for (const [slot, id] of Object.entries(equip)) {
    if (id === cardId) return slot as EquipSlot;
  }
  return null;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description: '当你每回合首次使用一种类型的牌后,你可以将之置于牌堆顶,然后摸一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:恃才发动确认(恃才/confirm) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== CONFIRM_RT) return '当前不是恃才询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 使用时 after-hook:首次使用某类型 → 占用类型 + 标记 eligible ──
  registerAfterHook(state, skill.id, ownerId, '使用时', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '使用时') return;
    if (atom.source !== ownerId) return;
    const card = ctx.state.cardMap[atom.cardId];
    if (!card) return;
    const type = card.type;
    const used = (ctx.state.turn.vars[USED_TYPES_VAR] as string[] | undefined) ?? [];
    if (used.includes(type)) return; // 非首次,不占用
    used.push(type);
    ctx.state.turn.vars[USED_TYPES_VAR] = used;
    const pending = (ctx.state.turn.vars[PENDING_VAR] as string[] | undefined) ?? [];
    pending.push(effectiveIdOf(ctx.state, atom.cardId));
    ctx.state.turn.vars[PENDING_VAR] = pending;
    // 影子卡(转化牌)入弃牌堆时被引擎还原为原卡并删除影子条目——结算结束后
    // effectiveIdOf 将无法反查。趁影子仍在,把实体原卡 id 记入当前结算帧参数。
    ctx.frame.params[EFFECTIVE_ID_KEY] = card.shadowOf ?? atom.cardId;
  });

  // ── 使用结算结束后 after-hook:eligible 牌 → 询问置顶摸牌 ──
  registerAfterHook(state, skill.id, ownerId, '使用结算结束后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '使用结算结束后') return;
    if (atom.source !== ownerId) return;
    if (!ctx.state.players[ownerId]?.alive) return;

    // 实体卡 id:优先用 使用时 记入帧参数的原卡 id(转化牌兼容);
    // 无记录(如纯虚拟使用)回退 cardMap 反查
    const effectiveId =
      (ctx.frame.params[EFFECTIVE_ID_KEY] as string | undefined) ??
      effectiveIdOf(ctx.state, atom.cardId);
    const pending = (ctx.state.turn.vars[PENDING_VAR] as string[] | undefined) ?? [];
    if (!pending.includes(effectiveId)) return; // 非首次使用此类型,不触发
    // 移除 eligible 标记(无论是否发动,本类型本回合不再触发)
    ctx.state.turn.vars[PENDING_VAR] = pending.filter((id) => id !== effectiveId);

    // 询问是否发动
    delete ctx.state.localVars[CONFIRM_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动恃才?(将此牌置于牌堆顶,然后摸一张牌)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (ctx.state.localVars[CONFIRM_KEY] !== true) {
      delete ctx.state.localVars[CONFIRM_KEY];
      return;
    }
    delete ctx.state.localVars[CONFIRM_KEY];

    // 将此牌置于牌堆顶
    const st = ctx.state;
    if (st.zones.discardPile.includes(effectiveId)) {
      // 基本牌/锦囊牌:弃牌堆 → 牌堆顶
      await applyAtom(st, {
        type: '移动牌',
        cardId: effectiveId,
        from: { zone: '弃牌堆' },
        to: { zone: '牌堆' },
      });
    } else {
      const slot = findEquipSlot(st, ownerId, effectiveId);
      if (slot) {
        // 装备牌:卸下(装备区→手牌)→ 手牌→牌堆顶
        await applyAtom(st, { type: '卸下', player: ownerId, slot });
        if (st.players[ownerId]?.hand.includes(effectiveId)) {
          await applyAtom(st, {
            type: '移动牌',
            cardId: effectiveId,
            from: { zone: '手牌', player: ownerId },
            to: { zone: '牌堆' },
          });
        }
      }
      // 延时锦囊(判定区)/其它区域:无法置顶,跳过置顶(仅摸牌)
    }

    // 摸一张牌(寸目会自动改为从牌堆底摸)
    await applyAtom(st, { type: '摸牌', player: ownerId, count: 1 });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: SKILL_ID,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '恃才',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
