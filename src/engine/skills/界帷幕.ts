// 界帷幕(界贾诩·群·锁定技,OL 界限突破官方逐字):
//   "锁定技,你不能成为黑色锦囊牌的目标。你防止回合内受到的伤害并摸所防止伤害值
//    两倍数量的牌。"
//
// 与标版帷幕(src/engine/skills/帷幕.ts)的区别:
//   - 标版:仅"不能成为黑色锦囊牌的目标"(effect-level cancel)。
//   - 界版:在标版基础上新增"防止回合内受到的伤害并摸所防止伤害值两倍数量的牌"。
//     贾诩在自己回合内受到的**任何伤害**(不限黑色锦囊)均被防止,然后摸 2×伤害值张牌。
//
// 实现要点:
//   - 沿用标版的 5 个黑色锦囊拦截 hook(成为目标/获得/弃置/设横置/造成伤害):
//     保护贾诩免受黑色锦囊影响。
//   - 新增"回合内防伤"before-hook(挂 造成伤害):target===owner 且
//     state.currentPlayerIndex===owner 时,先 摸牌 count=2*amount,再 cancel。
//   - **hook 注册顺序关键**:回合内防伤 hook 必须先于黑色锦囊造成伤害 hook 注册。
//     贾诩回合内若受黑色锦囊伤害(罕见,如反馈/刚烈触发的连锁),先走"防止+摸牌"
//     路径(2×牌奖励),避免被黑色锦囊 cancel 静默吞掉失去摸牌收益。
//   - 黑色 = card.color === '黑'(♠/♣);锦囊卡 id 来源详见标版帷幕注释。
//
// 命名:文件名/loader key/character skill name 均为 '界帷幕'(避开标帷幕冲突);
//   内部 Skill.name = '帷幕'(OL 官方技能名,玩家可见)。
import type { AtomBeforeContext, Card, HookResult, Skill, GameState } from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { registerBeforeHook, type SkillModule } from '../skill';

const SKILL_ID = '界帷幕';
const DISPLAY_NAME = '帷幕';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '锁定技,你不能成为黑色锦囊牌的目标;你防止回合内受到的伤害并摸所防止伤害值两倍数量的牌',
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
  const unloaders: Array<() => void> = [];

  // ── ① 回合内防伤 + 摸 2×(界版新增,必须先注册)──
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '造成伤害',
      async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
        const atom = ctx.atom as { target?: number; amount?: number };
        if (atom.target !== ownerId) return;
        // 仅在贾诩自己回合内生效
        if (ctx.state.currentPlayerIndex !== ownerId) return;
        const amount = typeof atom.amount === 'number' ? atom.amount : 0;
        if (amount <= 0) return;
        // 防止伤害 → 摸 2×伤害值张牌
        await applyAtom(ctx.state, {
          type: '摸牌',
          player: ownerId,
          count: amount * 2,
        });
        return { kind: 'cancel' };
      },
    ),
  );

  // ── ② 黑色锦囊:决斗等"成为目标"(标版沿用)──
  unloaders.push(
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
    ),
  );

  // ── ③ 黑色锦囊:别人从贾诩处获得牌(如顺手牵羊)──
  unloaders.push(
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
    ),
  );

  // ── ④ 黑色锦囊:弃置贾诩的牌(如过河拆桥)──
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '弃置',
      async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
        const atom = ctx.atom as { player?: number };
        if (atom.player !== ownerId) return;
        if (!frameIsBlackTrick(ctx.state)) return;
        return { kind: 'cancel' };
      },
    ),
  );

  // ── ⑤ 黑色锦囊:对贾诩设横置(如铁索连环)──
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '设横置',
      async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
        const atom = ctx.atom as { player?: number };
        if (atom.player !== ownerId) return;
        if (!frameIsBlackTrick(ctx.state)) return;
        return { kind: 'cancel' };
      },
    ),
  );

  // ── ⑥ 黑色锦囊:AOE/火攻等造成伤害(target=贾诩 + 黑色锦囊 cardId)──
  // 注:贾诩回合内的所有伤害已被 ① 拦截,这里仅在他人回合对贾诩造成黑色锦囊伤害时生效
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '造成伤害',
      async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
        const atom = ctx.atom as { target?: number; cardId?: string };
        if (atom.target !== ownerId) return;
        if (!atom.cardId) return; // 无来源卡的伤害不拦截
        if (!isBlackTrick(ctx.state.cardMap[atom.cardId])) return; // 非 black-trick 不拦截
        return { kind: 'cancel' };
      },
    ),
  );

  return () => {
    for (const u of unloaders) u();
  };
}

const _skillModule: SkillModule = { createSkill, onInit };
export default _skillModule;
