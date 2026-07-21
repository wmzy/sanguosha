// 界智迟(界陈宫·群·锁定技,OL 界限突破官方逐字):
//   "锁定技,当你于回合外受到伤害后,本回合【杀】和普通锦囊牌对你无效。"
//
// 与标版智迟(docs/research/武将技能/群雄/陈宫.md)对比:**描述完全相同**。
// 标版陈宫未实现,按界武将命名约定(标版未实现时创建"界X"文件),独立文件界智迟.ts。
//
// 触发模型(锁定技):
//   - 触发时机:造成伤害 after-hook,target===owner && currentPlayerIndex!==owner(回合外)
//   - 激活后写 turn.vars[ACTIVE_KEY]=ownerId(回合结束 atom 自动清空 turn.vars,天然每回合重置)
//
// "本回合杀和普通锦囊牌对你无效"实现(多 before-hook 拦截,模型参考 界帷幕/界贞烈):
//   1. 成为目标 before:杀/决斗 在 成为目标 atom 阶段即 cancel(杀流程检测到 false 跳过)
//   2. 检测有效性 before:杀/决斗 的备援拦截(防其他流程绕过 成为目标)
//   3. 询问杀 before:南蛮入侵 不询问 owner 出杀
//   4. 造成伤害 before:南蛮/万箭/决斗/火攻/AOE 等伤害被 cancel(含 杀 备援)
//   5. 获得 before:顺手牵羊/借刀杀人(获武器)不能从 owner 处获得
//   6. 弃置 before:过河拆桥 不弃置 owner 的牌
//   7. 设横置 before:铁索连环 不对 owner 横置
//
// 卡类型判定:
//   - 杀:card.name === '杀'(含物理杀与武圣/丈八转化杀——通过 cardMap 影子卡判定)
//   - 普通锦囊:card.type === '锦囊牌' && card.trickSubtype !== '延时锦囊'
//     (延时锦囊如乐不思蜀/兵粮寸断/闪电不属于"普通锦囊",不受智迟影响)
//
// cardId 来源:
//   - 直接:atom.cardId(杀/决斗/火攻 的 造成伤害 atom 直接带 cardId)
//   - 间接:top frame params.cardId(普通锦囊 use execute pushFrame 时携带)
//   两者都不存在时,不视为杀/锦囊(可能是反馈/刚烈等技能造成的伤害,智迟不影响)
//
// 命名:文件名/loader key/character skill name 均为 '界智迟';内部 Skill.name='智迟'(OL 官方名)。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  Card,
  GameState,
  HookResult,
  Skill,
  SkillModule,
} from '../types';
import { topFrame } from '../create-engine';
import { registerAfterHook, registerBeforeHook } from '../skill';

const SKILL_ID = '界智迟';
const DISPLAY_NAME = '智迟';

/** turn.vars key:智迟激活(值=激活者 ownerId)。turn.vars 在「回合结束」atom 自动清空。 */
const ACTIVE_KEY = '智迟/active';

/** 判定一张卡是否为【杀】(含转化杀——影子卡 name 即为 '杀') */
function isSlash(card: Card | undefined): boolean {
  return !!card && card.name === '杀';
}

/** 判定一张卡是否为普通锦囊牌(排除延时锦囊) */
function isNormalTrick(card: Card | undefined): boolean {
  return (
    !!card &&
    card.type === '锦囊牌' &&
    card.trickSubtype !== '延时锦囊'
  );
}

/** 判定一张卡是否为智迟影响范围(杀或普通锦囊) */
function isAffectingCard(card: Card | undefined): boolean {
  return isSlash(card) || isNormalTrick(card);
}

/** 智迟是否对本 owner 已激活(本回合) */
function isActiveFor(state: GameState, ownerId: number): boolean {
  return state.turn.vars[ACTIVE_KEY] === ownerId;
}

/**
 * 取与当前 atom 关联的卡(用于判定是否为杀/普通锦囊)。
 * 优先 atom 直接携带的 cardId;否则回退到顶帧 params.cardId(普通锦囊 use 帧携带)。
 */
function relevantCard(state: GameState, atomCardId: string | undefined): Card | undefined {
  if (typeof atomCardId === 'string') return state.cardMap[atomCardId];
  const frameCardId = topFrame(state)?.params?.cardId;
  if (typeof frameCardId === 'string') return state.cardMap[frameCardId];
  return undefined;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '锁定技:回合外受到伤害后,本回合【杀】和普通锦囊牌对你无效',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── 触发:回合外受到伤害后,激活智迟(本回合剩余时间生效)──
  unloaders.push(
    registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
      const atom = ctx.atom as { target?: number };
      if (atom.target !== ownerId) return;
      // 回合外 = 不是 owner 自己的回合
      if (ctx.state.currentPlayerIndex === ownerId) return;
      // 已死亡则不激活
      if (!ctx.state.players[ownerId]?.alive) return;
      ctx.state.turn.vars[ACTIVE_KEY] = ownerId;
    }),
  );

  // ── 拦截 1:成为目标(杀/决斗)── 杀流程在成为目标 false 时跳过该目标 ──
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '成为目标',
      async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
        if (!isActiveFor(ctx.state, ownerId)) return;
        const atom = ctx.atom as { target?: number; cardId?: string };
        if (atom.target !== ownerId) return;
        const card = relevantCard(ctx.state, atom.cardId);
        if (!isAffectingCard(card)) return;
        return { kind: 'cancel' };
      },
    ),
  );

  // ── 拦截 2:检测有效性(杀备援;某些流程可能绕过成为目标)──
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '检测有效性',
      async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
        if (!isActiveFor(ctx.state, ownerId)) return;
        const atom = ctx.atom as { target?: number; cardId?: string };
        if (atom.target !== ownerId) return;
        const card = relevantCard(ctx.state, atom.cardId);
        if (!isAffectingCard(card)) return;
        return { kind: 'cancel' };
      },
    ),
  );

  // ── 拦截 3:询问杀(南蛮入侵)── 不询问 owner 出杀 ──
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '询问杀',
      async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
        if (!isActiveFor(ctx.state, ownerId)) return;
        const atom = ctx.atom as { target?: number };
        if (atom.target !== ownerId) return;
        // 顶帧 cardId 应为普通锦囊(南蛮);非普通锦囊不拦截
        const card = relevantCard(ctx.state, undefined);
        if (!isNormalTrick(card)) return;
        return { kind: 'cancel' };
      },
    ),
  );

  // ── 拦截 4:造成伤害(南蛮/万箭/决斗/火攻/AOE;含 杀 备援)──
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '造成伤害',
      async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
        if (!isActiveFor(ctx.state, ownerId)) return;
        const atom = ctx.atom as { target?: number; cardId?: string };
        if (atom.target !== ownerId) return;
        const card = relevantCard(ctx.state, atom.cardId);
        if (!isAffectingCard(card)) return;
        return { kind: 'cancel' };
      },
    ),
  );

  // ── 拦截 5:获得(顺手牵羊/借刀杀人 获武器)── 不能从 owner 处获得 ──
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '获得',
      async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
        if (!isActiveFor(ctx.state, ownerId)) return;
        const atom = ctx.atom as { from?: number; player?: number };
        if (atom.from !== ownerId) return; // 别人从 owner 处获得
        if (atom.player === ownerId) return; // 自己获得自己不算
        const card = relevantCard(ctx.state, undefined);
        if (!isNormalTrick(card)) return;
        return { kind: 'cancel' };
      },
    ),
  );

  // ── 拦截 6:弃置(过河拆桥)── 不弃置 owner 的牌 ──
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '弃置',
      async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
        if (!isActiveFor(ctx.state, ownerId)) return;
        const atom = ctx.atom as { player?: number };
        if (atom.player !== ownerId) return;
        const card = relevantCard(ctx.state, undefined);
        if (!isNormalTrick(card)) return;
        return { kind: 'cancel' };
      },
    ),
  );

  // ── 拦截 7:设横置(铁索连环)── 不对 owner 横置 ──
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '设横置',
      async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
        if (!isActiveFor(ctx.state, ownerId)) return;
        const atom = ctx.atom as { player?: number };
        if (atom.player !== ownerId) return;
        const card = relevantCard(ctx.state, undefined);
        if (!isNormalTrick(card)) return;
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
