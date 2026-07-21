// 界破军(界徐盛·被动技,OL 界限突破官方逐字):
//   当你使用【杀】指定目标后,你可以将其至多X张牌移出游戏直到回合结束(X为其体力值)。
//   你使用的【杀】对手牌区与装备区内牌数皆不大于你的角色造成的伤害+1。
//
// 与标 破军 的区别:
//   - 标版:当你于出牌阶段使用【杀】指定目标后,你可以将其至多X张牌移出游戏直到回合结束。
//   - 界版:① 触发阶段不限出牌阶段(描述删去"于出牌阶段",意为只要"使用杀"即可触发,
//     实际仍受杀的使用时机约束——只能在出牌阶段主动出杀);② 新增"增伤效果":对手牌数与
//     装备数皆≤自己的角色,杀的伤害+1。
//
// 实现(模式 A 触发型 + before-hook 增伤):
//   ① 主效果(指定目标 after-hook):
//      - 触发条件:atom.source === ownerId(徐盛使用的杀)+ cardId 对应的牌名为'杀'(转化杀的
//        影子卡 name 也是'杀')。
//      - 询问发动;确认后从 target 手牌+装备区选 1~X 张牌(X = target 当前体力值)。
//      - 通过 移出至暂存区 atom 把这些牌暂存到 target.vars['界破军/移出']。
//   ② 增伤效果(造成伤害 before-hook):
//      - 触发条件:atom.source === ownerId + cardId 对应的牌名为'杀'(同一张杀的伤害)。
//      - 校验:target.hand.length ≤ self.hand.length 且 target 装备数 ≤ self 装备数。
//      - 命中:return { kind:'modify', atom: {...atom, amount: atom.amount+1} }。
//   ③ 回合结束 after-hook:遍历所有玩家,对 vars['界破军/移出'] 非空者调用 归还暂存牌 atom。
//
// 限制与边界:
//   - X = target.health(若 target health 为 0 或负,跳过;濒死目标不触发破军)
//   - target 须在 指定目标 时仍存活(杀结算时可能因前一目标死亡而中断,但 指定目标 是先逐个声明)
//   - 移出 0 张等价于不发动(confirm 询问的"不发动"分支)
//   - 增伤效果在造成伤害前即时校验,反映移出后的牌区状态(如目标已被破军搬空,更易触发+1)
//   - 归还时机:徐盛的回合结束(破军只在徐盛回合出杀时触发,故 turn 一定是徐盛的)
//   - 归还目标已死亡:牌进弃牌堆(由 归还暂存牌 atom 处理)
//
// 跨 atom 通信:
//   - target.vars['界破军/移出']:被破军移出的牌列表(per-target),由 移出至暂存区 写、归还暂存牌 读
//   - localVars:四个询问的结果(confirm/cardIds),由 respond 写、主流程读
//
// 命名:文件名/loader key/character skill name 均为 '界破军'(避开标破军冲突,标破军尚未实现);
//   内部 Skill.name = '破军'(OL 官方技能名,玩家可见)。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  Card,
  EquipSlot,
  FrontendAPI,
  GameState,
  GameView,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom, pushFrame, popFrame, topFrame } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook, type SkillModule } from '../skill';

const SKILL_ID = '界破军';
const DISPLAY_NAME = '破军';
/** target.vars 键:被破军移出的牌列表(per-target) */
const EXILE_VARS_KEY = '界破军/移出';

/** 询问 requestTypes */
const RT_ASK_USE = `${SKILL_ID}/askUse`; // 发动?
const RT_ASK_CARDS = `${SKILL_ID}/askCards`; // 选目标的 1~X 张牌

/** localVars 键 */
const LV_USE = `${SKILL_ID}/use`; // boolean
const LV_CARDS = `${SKILL_ID}/cards`; // string[]

/** 询问上下文(由主流程写、respond validate 读) */
const CTX_TARGET = `${SKILL_ID}/ctx/target`;
const CTX_X = `${SKILL_ID}/ctx/x`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '当你使用【杀】指定目标后,你可以将其至多X张牌移出游戏直到回合结束(X为其体力值)。你使用的【杀】对手牌区与装备区内牌数皆不大于你的角色造成的伤害+1',
  };
}

/** 玩家装备区内的牌数 */
function equipCount(p: { equipment: Partial<Record<EquipSlot, string>> }): number {
  return Object.values(p.equipment).filter((id): id is string => !!id).length;
}

/** 玩家"场上"的总牌数(手牌+装备) */
function totalCardCount(p: { hand: string[]; equipment: Partial<Record<EquipSlot, string>> }): number {
  return p.hand.length + equipCount(p);
}

/** 玩家所有可被破军的牌(手牌+装备),用于选牌面板展示 */
function targetCardIds(p: { hand: string[]; equipment: Partial<Record<EquipSlot, string>> }): string[] {
  return [
    ...p.hand,
    ...Object.values(p.equipment).filter((id): id is string => !!id),
  ];
}

/** 判断 cardId 是否对应"杀"牌(转化杀的影子卡 name 也是'杀') */
function isSlashCard(state: GameState, cardId: string | undefined): boolean {
  if (!cardId) return false;
  const card = state.cardMap[cardId];
  return !!card && card.name === '杀';
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:统一处理两种询问(发动/选牌) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== RT_ASK_USE && rt !== RT_ASK_CARDS) {
        return '当前不是界破军回应';
      }

      if (rt === RT_ASK_USE) {
        // choice=true/false
        return null;
      }
      // RT_ASK_CARDS: {cardIds: string[]},长度 1~X,均在目标手牌或装备区
      const cardIds = params.cardIds;
      if (!Array.isArray(cardIds)) return '需要选择牌';
      const promptTarget = st.localVars[CTX_TARGET] as number | undefined;
      const promptX = st.localVars[CTX_X] as number | undefined;
      if (typeof promptTarget !== 'number') return '询问上下文异常';
      const targetPlayer = st.players[promptTarget];
      if (!targetPlayer) return '目标不存在';
      const equipSet = new Set(
        Object.values(targetPlayer.equipment).filter((id): id is string => !!id),
      );
      for (const id of cardIds) {
        if (typeof id !== 'string') return 'cardIds 必须为字符串数组';
        if (!targetPlayer.hand.includes(id) && !equipSet.has(id)) return '牌不在目标区域';
      }
      // 长度 1~X(至少 1 张,至多 X 张)
      if (cardIds.length < 1) return '至少选择 1 张牌';
      if (typeof promptX === 'number' && cardIds.length > promptX) {
        return `至多选择 ${promptX} 张牌`;
      }
      // 不能重复
      if (new Set(cardIds).size !== cardIds.length) return '不能重复选牌';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as Record<string, unknown> | undefined)?.['requestType'] as
        | string
        | undefined;
      if (rt === RT_ASK_USE) {
        st.localVars[LV_USE] = params.choice === true;
      } else if (rt === RT_ASK_CARDS) {
        st.localVars[LV_CARDS] = params.cardIds;
      }
    },
  );

  // ── 主效果:指定目标 after-hook ──
  registerAfterHook(state, skill.id, ownerId, '指定目标', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; source?: number; target?: number; cardId?: string };
    if (atom.type !== '指定目标') return;
    if (atom.source !== ownerId) return; // 徐盛使用的杀
    if (!isSlashCard(ctx.state, atom.cardId)) return; // 仅杀触发
    const target = atom.target;
    if (typeof target !== 'number') return;
    const targetPlayer = ctx.state.players[target];
    if (!targetPlayer?.alive) return;
    // 自己对自己不触发(理论上杀不能指定自己,保险起见)
    if (target === ownerId) return;

    // X = target 当前体力值(<=0 时跳过)
    const X = targetPlayer.health;
    if (X <= 0) return;
    // 目标须有牌可移
    if (totalCardCount(targetPlayer) === 0) return;

    await pushFrame(ctx.state, SKILL_ID, ownerId, {});
    try {
      // ── 1. 询问发动 ──
      delete ctx.state.localVars[LV_USE];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: RT_ASK_USE,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动破军?(将 ${targetPlayer.name} 至多 ${X} 张牌移出游戏直到回合结束)`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 15,
      });
      if (ctx.state.localVars[LV_USE] !== true) return;

      // ── 2. 询问选 1~X 张牌 ──
      // 重新读取(防御 pending 期间状态变化)
      const targetNow = ctx.state.players[target];
      if (!targetNow?.alive) return;
      const Xnow = Math.min(X, targetNow.health);
      if (Xnow <= 0) return;
      const available = targetCardIds(targetNow);
      if (available.length === 0) return;

      delete ctx.state.localVars[LV_CARDS];
      ctx.state.localVars[CTX_TARGET] = target;
      ctx.state.localVars[CTX_X] = Xnow;
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: RT_ASK_CARDS,
        target: ownerId,
        prompt: {
          type: 'distribute',
          mode: 'select',
          title: `破军:选择 ${targetNow.name} 的 1~${Xnow} 张牌移出游戏(可从手牌或装备区)`,
          // 静态列出目标当前所有牌(供前端展示;真实面杀手牌为暗牌,前端可渲染牌背)
          cardIds: available,
          minTotal: 1,
          maxTotal: Xnow,
        },
        timeout: 30,
      });

      const pickedRaw = ctx.state.localVars[LV_CARDS];
      const picked = Array.isArray(pickedRaw) ? (pickedRaw as string[]) : [];
      if (picked.length === 0) return; // 未选牌(不应发生,validate 已挡)

      // ── 3. 通过 移出至暂存区 atom 把牌暂存到 target.vars ──
      await applyAtom(ctx.state, {
        type: '移出至暂存区',
        source: ownerId,
        target,
        cardIds: picked,
        varsKey: EXILE_VARS_KEY,
      });
    } finally {
      await popFrame(ctx.state);
    }
  });

  // ── 增伤效果:造成伤害 before-hook ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as {
        type?: string;
        source?: number;
        target?: number;
        cardId?: string;
        amount?: number;
      };
      if (atom.type !== '造成伤害') return;
      if (atom.source !== ownerId) return; // 徐盛造成的伤害
      if (!isSlashCard(ctx.state, atom.cardId)) return; // 仅杀伤害
      const target = atom.target;
      if (typeof target !== 'number') return;
      if (target === ownerId) return; // 自残不触发(理论上杀伤害来源是自己、目标是他人)
      const targetPlayer = ctx.state.players[target];
      const selfPlayer = ctx.state.players[ownerId];
      if (!targetPlayer || !selfPlayer) return;
      // 条件:target 手牌数 ≤ self 手牌数 且 target 装备数 ≤ self 装备数
      if (targetPlayer.hand.length > selfPlayer.hand.length) return;
      if (equipCount(targetPlayer) > equipCount(selfPlayer)) return;
      // 命中:伤害 +1
      const amount = typeof atom.amount === 'number' ? atom.amount : 0;
      return {
        kind: 'modify',
        atom: { ...ctx.atom, amount: amount + 1 } as unknown as typeof ctx.atom,
      };
    },
  );

  // ── 回合结束 after-hook:归还所有破军移出的牌 ──
  registerAfterHook(state, skill.id, ownerId, '回合结束', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number };
    if (atom.type !== '回合结束') return;
    if (atom.player !== ownerId) return; // 仅徐盛回合结束(破军只在徐盛回合触发)
    // 遍历所有玩家,归还其 vars 中破军移出的牌
    for (let i = 0; i < ctx.state.players.length; i++) {
      const p = ctx.state.players[i];
      if (!p) continue;
      const exiled = p.vars[EXILE_VARS_KEY];
      if (Array.isArray(exiled) && exiled.length > 0) {
        await applyAtom(ctx.state, { type: '归还暂存牌', player: i, varsKey: EXILE_VARS_KEY });
      }
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '破军',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
