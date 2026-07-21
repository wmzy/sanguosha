// 帷幕(贾诩·群·锁定技):你不能成为黑色锦囊的目标。
//
// 实现:before-hook 拦截黑色锦囊结算流程中"贾诩成为目标/受影响"的关键 atom,
//   与谦逊/空城同构(effect-level cancel)。黑色 = card.color === '黑'(♠/♣)。
//
//   只按黑色锦囊牌的颜色统一拦截,不与具体锦囊名耦合:
//   获得/弃置/设横置 hook 通过 frameIsBlackTrick 判定顶帧 params.cardId 对应的牌是否
//   为黑色锦囊——非锦囊结算帧(如弃牌阶段、反馈/突袭等)顶帧没有有效 cardId → false;
//   红色锦囊 → false;黑色锦囊 → true → 拦截。
//
//   锦囊卡 id 来源:成为目标/造成伤害 由 atom.cardId 直接给出;获得/弃置/设横置 由
//   顶帧 frame.params.cardId 给出(各锦囊 use execute pushFrame 时把 cardId 带入 params)。
import type { AtomBeforeContext, HookResult, Skill, GameState, Card } from '../types';
import { topFrame } from '../create-engine';
import { registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '帷幕',
    description: '锁定技:你不能成为黑色锦囊的目标',
    isLocked: true,
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

  // ── 获得:别人从贾诩处获得牌(黑色锦囊,如顺手牵羊)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '获得',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { from?: number; player?: number };
      if (atom.from !== ownerId) return; // 别人从贾诩处获得
      if (atom.player === ownerId) return; // 自己获得自己不算
      if (!frameIsBlackTrick(ctx.state)) return; // 只拦截黑色锦囊结算帧
      return { kind: 'cancel' };
    },
  );

  // ── 弃置:弃置贾诩的牌(黑色锦囊,如过河拆桥)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '弃置',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { player?: number };
      if (atom.player !== ownerId) return;
      if (!frameIsBlackTrick(ctx.state)) return; // 只拦截黑色锦囊结算帧
      return { kind: 'cancel' };
    },
  );

  // ── 设横置:对贾诩设横置(黑色锦囊,如铁索连环)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '设横置',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { player?: number };
      if (atom.player !== ownerId) return;
      if (!frameIsBlackTrick(ctx.state)) return; // 只拦截黑色锦囊结算帧
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
