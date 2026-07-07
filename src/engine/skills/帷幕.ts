// 帷幕(贾诩·群·锁定技):你不能成为黑色锦囊的目标。
//
// 实现:before-hook 拦截各黑色锦囊结算流程中"贾诩成为目标/受影响"的关键 atom。
//   与谦逊/空城同构(effect-level cancel)。黑色 = card.color === '黑'(♠/♣)。
//
//   覆盖的黑色锦囊(按其结算流程中贾诩受影响的 atom):
//     · 决斗      → 成为目标(atom.cardId 是决斗锦囊;离间发起的无实体决斗无 cardId,不拦截)
//     · 顺手牵羊  → 获得(from=贾诩;顶帧 skillId='顺手牵羊')
//     · 过河拆桥  → 弃置(player=贾诩;顶帧 skillId='过河拆桥')
//     · 铁索连环  → 设横置(player=贾诩;顶帧 skillId='铁索连环')
//     · 南蛮入侵/万箭齐发(AOE)→ 造成伤害(target=贾诩 + 黑色锦囊 cardId)
//     · 火攻      → 造成伤害(同上;黑色火攻的伤害被取消,部分覆盖)
//
//   锦囊卡 id 来源:成为目标/造成伤害 由 atom.cardId 直接给出;获得/弃置/设横置 由
//   顶帧 frame.params.cardId 给出(各锦囊 use execute pushFrame 时把 cardId 带入 params)。
//
//   待澄清(文档备注自相矛盾,部分实现):
//     · 火攻/借刀杀人对贾诩为目标:其流程无可干净 cancel 的"成为目标"原子
//       (cancel 单个 请求回应 不能中止整个锦囊 execute)。火攻的"伤害"已被造成伤害 hook
//       拦截(部分覆盖);借刀杀人以贾诩为被借刀者(A)时无法在此层拦截,留作后续
//       (需在借刀杀人.use validate 层加帷幕检查)。
//     · 延时锦囊(乐不思蜀/兵粮寸断):文档备注"也不受影响",故不拦截。
import type { AtomBeforeContext, HookResult, Skill, GameState, Card } from '../types';
import { topFrame } from '../create-engine';
import { registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '帷幕',
    description: '锁定技:你不能成为黑色锦囊的目标',
  };
}

/** 判定一张卡是否为黑色锦囊牌 */
function isBlackTrick(card: Card | undefined): boolean {
  return !!card && card.type === '锦囊牌' && card.color === '黑';
}

/** 从顶帧 params 取锦囊卡 id(各锦囊 use execute pushFrame 时 params 携带 cardId) */
function frameTrickCardId(state: GameState): string | undefined {
  const cardId = topFrame(state)?.params?.cardId;
  return typeof cardId === 'string' ? cardId : undefined;
}

/** 顶帧锦囊卡是否为黑色锦囊(获得/弃置/设横置 hook 用) */
function frameIsBlackTrick(state: GameState): boolean {
  const cardId = frameTrickCardId(state);
  return cardId !== undefined && isBlackTrick(state.cardMap[cardId]);
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 决斗:成为目标(atom.cardId 是决斗锦囊)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '成为目标',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { target?: number; cardId?: string };
      if (atom.target !== ownerId) return;
      if (!atom.cardId) return; // 无 cardId(如离间虚拟决斗)不拦截
      if (!isBlackTrick(ctx.state.cardMap[atom.cardId])) return;
      return { kind: 'cancel' };
    },
  );

  // ── 顺手牵羊:获得(from=贾诩;顶帧=顺手牵羊)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '获得',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { from?: number; player?: number };
      if (atom.from !== ownerId) return; // 别人从贾诩处获得
      if (atom.player === ownerId) return; // 自己获得自己不算
      if (topFrame(ctx.state)?.skillId !== '顺手牵羊') return; // 精确区分反馈/突袭等
      if (!frameIsBlackTrick(ctx.state)) return;
      return { kind: 'cancel' };
    },
  );

  // ── 过河拆桥:弃置(player=贾诩;顶帧=过河拆桥)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '弃置',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { player?: number };
      if (atom.player !== ownerId) return;
      if (topFrame(ctx.state)?.skillId !== '过河拆桥') return; // 区分弃牌阶段等其他弃置
      if (!frameIsBlackTrick(ctx.state)) return;
      return { kind: 'cancel' };
    },
  );

  // ── 铁索连环:设横置(player=贾诩;顶帧=铁索连环)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '设横置',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { player?: number };
      if (atom.player !== ownerId) return;
      if (topFrame(ctx.state)?.skillId !== '铁索连环') return;
      if (!frameIsBlackTrick(ctx.state)) return;
      return { kind: 'cancel' };
    },
  );

  // ── AOE(南蛮入侵/万箭齐发)及火攻:造成伤害(target=贾诩 + 黑色锦囊 cardId)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { target?: number; cardId?: string };
      if (atom.target !== ownerId) return;
      if (!atom.cardId) return; // 无来源卡的伤害不拦截
      if (!isBlackTrick(ctx.state.cardMap[atom.cardId])) return; // 普通【杀】等非锦囊不拦截
      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export default { createSkill, onInit } satisfies import('../types').SkillModule;
