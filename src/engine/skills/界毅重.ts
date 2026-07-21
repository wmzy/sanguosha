// 界毅重(界于禁·魏·锁定技,OL 界限突破 hero/756 逐字):
//   锁定技,体力值大于等于你的角色的黑色【杀】对你无效;
//   手牌数小于等于你的角色无法响应你的黑色【杀】。
//
// 双重效果(均为锁定技,before-hook 自动生效):
//
// ① 受到黑杀时(防御侧):来源体力 ≥ 自己体力 → 黑杀对自己无效
//    时机:「检测有效性」before-hook(与仁王盾同位)
//    条件:atom.target === ownerId && source.health >= ownerId.health
//          && cardMap[cardId].name === '杀' && cardMap[cardId].color === '黑'
//    效果:{ kind: 'cancel' } → 杀.execute 据 false 跳过该目标(不询问闪、不伤害)
//
// ② 使用黑杀时(攻击侧):目标手牌数 ≤ 自己 → 目标无法响应(不能出闪)
//    时机:「询问闪」before-hook(在询问目标出闪前 cancel,目标无闪进处理区 → 杀直接命中)
//    条件:atom.source === ownerId && target.hand.length <= ownerId.hand.length
//          && frame 内当前杀为黑色
//    效果:{ kind: 'cancel' } → 跳过询问闪,杀直接命中
//
// 黑色判定:cardMap[cardId].color === '黑'(♠/♣ 为黑;♥/♦ 为红)。
//   转化杀(武圣红牌当杀等)按其影子卡的 color 判定;若影子卡为无色,则不视为黑杀。
//
// 关键点:
//   - "体力值大于等于你":来源的当前体力 ≥ 自己的当前体力(满血比较,含回复/伤害后的实时值)
//   - "手牌数小于等于你":目标的当前手牌数 ≤ 自己的当前手牌数
//   - 两条均为锁定技,无条件自动触发(无需玩家选择)
//   - 与仁王盾区别:仁王盾只挡黑杀(无条件),界毅重 ① 还需体力条件;② 是攻击侧效果
//
// 命名:文件名/loader key/character skill name 均为 '界毅重'(避开标版毅重冲突);
//   内部 Skill.name = '毅重'(OL 官方技能名,玩家可见)。
import type { AtomBeforeContext, FrontendAPI, GameState, HookResult, Skill } from '../types';
import { registerBeforeHook, type SkillModule } from '../skill';

const SKILL_ID = '界毅重';
const DISPLAY_NAME = '毅重';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '锁定技,体力值大于等于你的角色的黑色【杀】对你无效;手牌数小于等于你的角色无法响应你的黑色【杀】',
  };
}

/** 当前结算帧正在结算的【杀】牌 id(从 frame.params.cardId 读,与杀.execute pushFrame 一致) */
function currentSlashCardId(state: GameState): string | undefined {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  if (!frame) return undefined;
  const id = frame.params['cardId'];
  return typeof id === 'string' ? id : undefined;
}

/** 是否为黑色【杀】(转化杀按影子卡 color 判定;无色不算黑杀) */
function isBlackSlash(state: GameState, cardId: string | undefined): boolean {
  if (!cardId) return false;
  const card = state.cardMap[cardId];
  if (!card) return false;
  if (card.name !== '杀') return false;
  return card.color === '黑';
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── ① 检测有效性 before-hook:高体力角色黑杀对自己无效 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '检测有效性',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { source?: number; target?: number; cardId?: string };
      if (atom.target !== ownerId) return;
      const source = atom.source;
      if (source === undefined) return;
      // 来源体力 ≥ 自己 → 黑杀无效
      const sourceHp = ctx.state.players[source]?.health ?? 0;
      const myHp = ctx.state.players[ownerId]?.health ?? 0;
      if (sourceHp < myHp) return;
      if (!isBlackSlash(ctx.state, atom.cardId)) return;
      return { kind: 'cancel' };
    },
  );

  // ── ② 询问闪 before-hook:目标手牌 ≤ 自己 → 目标无法响应(跳过询问闪)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '询问闪',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { source?: number; target?: number };
      if (atom.source !== ownerId) return;
      const target = atom.target;
      if (target === undefined) return;
      // 自己用的杀必须是黑色(从结算帧 cardId 读)
      if (!isBlackSlash(ctx.state, currentSlashCardId(ctx.state))) return;
      // 目标手牌 ≤ 自己 → 无法响应
      const targetHand = ctx.state.players[target]?.hand.length ?? 0;
      const myHand = ctx.state.players[ownerId]?.hand.length ?? 0;
      if (targetHand > myHand) return;
      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 锁定技,无主动 action 需声明
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
