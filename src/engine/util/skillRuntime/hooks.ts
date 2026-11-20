// src/engine/util/skillRuntime/hooks.ts — hook 守卫工厂。
// (自 util/skillRuntime.ts 按内聚拆出;导出经桶文件 skillRuntime.ts re-export,调用方零改动。)
// 收敛 skills/ 下逐字复制的「前导守卫 + handler」after/before-hook 样板:
//   registerOnOwnSlashDodged:「自己使用的杀被闪抵消」前导守卫 after-hook
//     (贯石斧/青龙偃月刀/界咆哮/界空城 四处时机一致,均为 '被抵消' after);
//   registerOnDamagedAsTarget:「受到伤害后」四行前导守卫 after-hook(刚烈 骨架);
//   registerPhaseStartHook:「阶段开始」before-hook 前导三查(type/player/phase 归属);
//   registerDamageBonusHook:「造成伤害时」增伤 before-hook(裸衣/界裸衣 同款守卫链);
//   registerJudgeCardHook:「判定牌生效后」判定牌捕获 after-hook(双雄/屯田/悲歌/界落英 同款守卫链)。
// 命名:函数/类型英文;业务字面量(atom 类型/牌名)保持中文。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  AtomOfName,
  Card,
  GameState,
  HookResult,
} from '../../types';
import { registerAfterHook, registerBeforeHook } from '../../core/skill';
import { isCancelled } from '../../core/frame';
import { currentJudgeCardId } from '../../flows/judge';

// ────────────────────── 「自己使用的杀被闪抵消」after-hook ──────────────────────

/** registerOnOwnSlashDodged 可选项。 */
export interface OwnSlashDodgedOptions {
  /** 武器技限定:仅当 ownerId 武器栏装备该牌名时触发,并附带 isCancelled 复核
   *  (闪已被 drain 到弃牌堆,抵消态只能看结算帧 cancelled 标记)——
   *  与 贯石斧/青龙偃月刀 的武器分支逐字一致。武将技(界咆哮/界空城)不传。 */
  weaponName?: string;
}

/**
 * 注册「自己使用的【杀】被【闪】抵消」时机 hook('被抵消' atom 的 after hook;
 * 现存四处实现 贯石斧/青龙偃月刀/界咆哮/界空城 时机一致,均为 after,无需 before 变体)。
 *
 * 前导守卫(不满足则直接放行,不进入 handler):
 *   ① ctx.frame.skillId === '杀'——万箭齐发等锦囊被闪抵消不触发;
 *   ② atom.source === ownerId——只在"自己使用的杀"被抵消时触发;
 *   ③ opts.weaponName 时:owner 存活于 players + 武器栏有牌 + 卡名匹配 +
 *      isCancelled(state, atom.cardId, atom.target) 复核。
 *
 * 用法(武将技,界咆哮式摸牌):
 * ```ts
 * const unregHook = registerOnOwnSlashDodged(state, skill.id, ownerId, async (ctx) => {
 *   await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
 * });
 * ```
 *
 * 用法(武器技,须自备武器):
 * ```ts
 * const unregHook = registerOnOwnSlashDodged(state, skill.id, ownerId, handler, {
 *   weaponName: '贯石斧',
 * });
 * ```
 *
 * @returns unloader(registerAfterHook 原样透传)。
 */
export function registerOnOwnSlashDodged(
  state: GameState,
  skillId: string,
  ownerId: number,
  handler: (ctx: AtomAfterContext<AtomOfName<'被抵消'>>) => Promise<void>,
  opts: OwnSlashDodgedOptions = {},
): () => void {
  return registerAfterHook(state, skillId, ownerId, '被抵消', async (ctx) => {
    // 只对杀生效:万箭齐发等锦囊被闪抵消不触发
    if (ctx.frame.skillId !== '杀') return;
    // 只在"自己使用的杀"被抵消时触发
    if (ctx.atom.source !== ownerId) return;
    if (opts.weaponName !== undefined) {
      const self = ctx.state.players[ownerId];
      if (!self) return;
      const weaponId = self.equipment['武器'];
      if (!weaponId) return;
      if (ctx.state.cardMap[weaponId]?.name !== opts.weaponName) return;
      // 检查是否被抵消(闪已设置标记,但闪已被 drain 到弃牌堆)
      if (!isCancelled(ctx.state, ctx.atom.cardId, ctx.atom.target)) return;
    }
    await handler(ctx);
  });
}

// ────────────────────── 「受到伤害后(以自己为目标)」after-hook ──────────────────────

/**
 * 注册「受到伤害后」技能 hook,封装四行前导守卫(不满足则直接放行,不进入 handler):
 *   ① atom.target === ownerId——只在自己受到伤害后触发;
 *   ② (atom.amount ?? 0) > 0——失去体力/零伤害不触发;
 *   ③ atom.source !== undefined——无来源伤害不触发;
 *   ④ atom.source !== ownerId——自伤不触发。
 * 参考现状 刚烈.ts:75(刚烈/遗计/反馈/放逐 等「被他人伤害后」技能共用此骨架)。
 *
 * @returns unloader(registerAfterHook 原样透传)。
 */
export function registerOnDamagedAsTarget(
  state: GameState,
  skillId: string,
  ownerId: number,
  handler: (ctx: AtomAfterContext<AtomOfName<'受到伤害后'>>) => Promise<void>,
): () => void {
  return registerAfterHook(state, skillId, ownerId, '受到伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (atom.source === undefined || atom.source === ownerId) return;
    await handler(ctx);
  });
}

// ────────────────────────── 「阶段开始」before-hook 前导守卫 ──────────────────────────

/** registerPhaseStartHook 可选项(可选附加守卫;更特化的条件留在 handler 内自查)。 */
export interface PhaseStartHookOptions {
  /** true = 追加 `state.currentPlayerIndex === ownerId` 守卫(阶段开始只对回合角色
   *  本人生效的技能,如神速三选项的 shensuPhaseEntry 同款检查)。默认不追加。 */
  requireCurrentPlayer?: boolean;
}

/**
 * 注册「阶段开始」before-hook 并内置前导三查:
 * atom.type === '阶段开始' + atom.player === ownerId + atom.phase === phase
 * (各技能 handler 开头逐字复制的三连),全部通过才进入 handler。
 * 额外语义守卫(存活/限一次标记/存在其他存活角色等)由 handler 自行实现,
 * 保持各技能现状语义可表达。
 *
 * 用法(神速选项1 骨架):
 * ```ts
 * const unreg = registerPhaseStartHook(
 *   state, skill.id, ownerId, '判定',
 *   async (ctx): Promise<HookResult | void> => {
 *     const self = ctx.state.players[ownerId];
 *     if (!self?.alive || self.vars[USED_KEY]) return;
 *     // …询问发动;发动则虚拟杀 + return { kind: 'cancel' }
 *   },
 *   { requireCurrentPlayer: true },
 * );
 * ```
 *
 * @returns unloader(registerBeforeHook 原样透传)。
 */
export function registerPhaseStartHook(
  state: GameState,
  skillId: string,
  ownerId: number,
  phase: string,
  handler: (ctx: AtomBeforeContext<AtomOfName<'阶段开始'>>) => Promise<HookResult | void>,
  opts: PhaseStartHookOptions = {},
): () => void {
  return registerBeforeHook(state, skillId, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== phase) return;
    if (opts.requireCurrentPlayer === true && ctx.state.currentPlayerIndex !== ownerId) return;
    return await handler(ctx);
  });
}

// ────────────────────────── 「造成伤害」增伤 before-hook ──────────────────────────

/** registerDamageBonusHook 必填项。 */
export interface DamageBonusHookOptions {
  /** 增伤标签 key(`技能名/属性` 命名空间,如 '裸衣/bonus' / '界裸衣/bonus')——
   *  owner 的 tags 含此标签时本 hook 才生效。标签的挂/清时机由技能自身的其他
   *  hook 负责,本工厂只管读。 */
  tag: string;
  /** 享受增伤的伤害来源牌名(如 ['杀', '决斗'])——atom.cardId 对应卡牌的 name
   *  不在列表内则放行。 */
  cardNames: string[];
}

/**
 * 注册「造成伤害时」增伤 before-hook(裸衣/界裸衣 两处逐字重复的实现收敛):
 * 前导守卫全过 → `{ kind: 'modify', atom: {...atom, amount: (amount ?? 0) + 1} }`。
 * 守卫链(与参考实现逐字一致):
 *   ① atom.source === ownerId——只增伤自己为来源的伤害;
 *   ② (atom.amount ?? 0) > 0——零/负伤害不触发;
 *   ③ owner 存在于 players 且 tags 含 opts.tag;
 *   ④ atom.cardId 为 string 且 cardMap 中卡牌 name ∈ opts.cardNames。
 *
 * 用法(裸衣式):
 * ```ts
 * const unreg = registerDamageBonusHook(state, skill.id, ownerId, {
 *   tag: '裸衣/bonus',
 *   cardNames: ['杀', '决斗'],
 * });
 * ```
 *
 * @returns unloader(registerBeforeHook 原样透传)。
 */
export function registerDamageBonusHook(
  state: GameState,
  skillId: string,
  ownerId: number,
  opts: DamageBonusHookOptions,
): () => void {
  return registerBeforeHook(state, skillId, ownerId, '造成伤害时', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const self = ctx.state.players[ownerId];
    if (!self?.tags.includes(opts.tag)) return;
    const cardId = atom.cardId;
    if (typeof cardId !== 'string') return;
    const card = ctx.state.cardMap[cardId];
    if (!card) return;
    if (!opts.cardNames.includes(card.name)) return;
    return {
      kind: 'modify',
      atom: { ...ctx.atom, amount: (atom.amount ?? 0) + 1 } as typeof ctx.atom,
    };
  });
}

// ────────────────────────── 「判定牌生效后」判定牌捕获 after-hook ──────────────────────────

/**
 * 注册「判定牌生效后」判定牌捕获 hook(通用骨架,双雄/屯田/悲歌/界落英 同款守卫链),
 * 前导守卫全过才进入 handler:
 *   ① selfJudgeOnly !== false 时要求 atom.player === ownerId——仅捕获"自己的判定";
 *      传 false 则不限判定归属(界落英场景:他人的判定才触发,归属守卫写在 handler 里);
 *   ② atom.judgeType === judgeType——技能专属判定,不误伤其他判定流程;
 *   ③ currentJudgeCardId 命中且 cardMap 有此牌,否则放行。
 *
 * 传入 handler 的 judgeCard 遵循既有约定(与 双雄/屯田 注释同款):
 * 判定牌生效后仍在结算帧牌区顶(frameCards 末尾)、尚未入弃牌堆,且可能是
 * 改判(鬼才/鬼道)后的最终牌;handler 要拿走它必须走「移动牌」/「收取判定牌」
 * atom(直接 mutate frame 会漏视图投影),不拿则由 runJudgeFlow 收尾正常移入弃牌堆。
 *
 * 用法(双雄式:judgeType 匹配 + 拿走判定牌):
 * ```ts
 * registerJudgeCardHook(state, skill.id, ownerId, '双雄', async (ctx, judgeCard) => {
 *   await applyAtom(ctx.state, {
 *     type: '移动牌',
 *     cardId: judgeCard.id,
 *     from: { zone: '处理区' },
 *     to: { zone: '手牌', player: ownerId },
 *   });
 * });
 * ```
 *
 * @param opts.selfJudgeOnly 默认 true(仅捕获自己的判定);false = 不限制判定归属。
 */
export function registerJudgeCardHook(
  state: GameState,
  skillId: string,
  ownerId: number,
  judgeType: string,
  handler: (ctx: AtomAfterContext<AtomOfName<'判定牌生效后'>>, judgeCard: Card) => Promise<void>,
  opts: { selfJudgeOnly?: boolean } = {},
): void {
  registerAfterHook(state, skillId, ownerId, '判定牌生效后', async (ctx) => {
    const atom = ctx.atom;
    if (opts.selfJudgeOnly !== false && atom.player !== ownerId) return;
    if (atom.judgeType !== judgeType) return;
    const judgeCardId = currentJudgeCardId(ctx.state);
    const judgeCard = judgeCardId ? ctx.state.cardMap[judgeCardId] : undefined;
    if (!judgeCard) return;
    await handler(ctx, judgeCard);
  });
}
