// 强袭(典韦·主动技,标版官方逐字):
//   出牌阶段限两次,你可以失去1点体力或弃置一张武器牌,
//   对一名本回合内未以此法指定过的其他角色造成1点伤害。
//
// 模式 B(主动技):registerAction 'use'。
//   参数:{ cost: 'hp' | 'discard', target: number, cardId?: string }
//   - cost 'hp':失去 1 点体力(失去体力,非伤害——不触发防具/反馈)。
//   - cost 'discard':弃一张武器牌(手牌或装备区武器)。
//   - 对 target 造成 1 点伤害(来源为典韦,强制伤害,不可被闪抵消)。
//
// 实现要点:
//   - 计数限两次:player.vars['强袭/usedThisTurn'] 存数字(1/2),沿用 /usedThisTurn 后缀
//     由「回合结束」atom 自动清空。每次发动 +1,通过「回合用量」atom 同步 view.turnUsage。
//   - 目标去重:player.vars['强袭/targets/usedThisTurn'] 存已指定目标数组(本回合),
//     后缀 /usedThisTurn → 回合结束自动清空。每次发动后追加本次目标,通过「回合用量」
//     atom 同步 view.turnUsage 供前端 targetFilter 过滤已指定目标。
//   - 官方未提距离限制,故不再校验目标是否在攻击范围内。
//
// 本文件同时导出 createQiangxiSkill 工厂(强袭族共享实现),界强袭 复用之,
// 仅注入 代价类型(hp=失去体力 / damage=受到伤害)/文案/键名差异(键空间按技能 id 隔离)。
import type { Card, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { popFrame, pushFrame } from '../core/frame';
import { runDamageFlow } from '../flows/damage';
import { defaultPlayActive } from '../rules/action-active';
import { setPlayerVarUsage } from '../rules/turn-usage';
import { registerAction, hasBlockingPending } from '../core/skill';
import type { SkillModule } from '../types';

const MAX_USES = 2;

/** 强袭族差异参数(标/界共享实现,差异全部显式注入)。 */
export interface QiangxiOptions {
  /** 技能 id(= 键空间前缀:计数/目标去重 vars、结算帧标签;标 '强袭' / 界 '界强袭') */
  skillId: string;
  /** 玩家可见技能名(标/界均为 '强袭',OL 官方技能名) */
  displayName: string;
  description: string;
  /** 体力代价 token(标 'hp'=失去体力,非伤害 / 界 'damage'=受到1点伤害,真实伤害事件) */
  hpCostToken: 'hp' | 'damage';
  /** 体力代价分支的 paramVariants 文案 */
  hpCostVariantLabel: string;
  /** selectTarget 询问标题 */
  targetTitle: string;
  /** 体力代价结算(标:失去体力 atom / 界:runDamageFlow 自伤,触发反馈/奸雄等) */
  payHpCost: (st: GameState, from: number) => Promise<void>;
  /** validate 文案(标/界历史措辞不同,逐字保留) */
  phaseError: string;
  blockingError: string;
  deadError: string;
  costParamError: string;
}

/** 是否为武器牌 */
function isWeaponCard(card: { type?: string; subtype?: string } | undefined): boolean {
  return !!card && card.type === '装备牌' && card.subtype === '武器';
}

/** 强袭族共享实现:标强袭与界强袭仅 代价类型/文案/键名 不同,流程与 atom 序列逐字一致。 */
export function createQiangxiSkill(opts: QiangxiOptions) {
  // 键名遵循 `${SKILL_ID}/…` 局部技能名模板约定(turnUsage 投影 key 静态契约)。
  const SKILL_ID = opts.skillId;
  /** 数字计数(1/2);沿用 /usedThisTurn 后缀由「回合结束」atom 自动清空。 */
  const COUNT_KEY = `${SKILL_ID}/usedThisTurn`;
  /** 本回合已以此法指定过的目标数组;后缀 /usedThisTurn → 回合结束自动清空。 */
  const TARGETS_KEY = `${SKILL_ID}/targets/usedThisTurn`;

  /** 本回合已发动次数(0/1/2)。 */
  function usesThisTurn(state: GameState, ownerId: number): number {
    const v = state.players[ownerId]?.vars[COUNT_KEY];
    return typeof v === 'number' ? v : 0;
  }

  /** 本回合已以此法指定过的目标列表。 */
  function usedTargets(state: GameState, ownerId: number): number[] {
    const v = state.players[ownerId]?.vars[TARGETS_KEY];
    return Array.isArray(v) ? (v as number[]) : [];
  }

  function createSkill(id: string, ownerId: number): Skill {
    return {
      id,
      ownerId,
      name: opts.displayName,
      description: opts.description,
    };
  }

  function onInit(skill: Skill, state: GameState): () => void {
    const ownerId = skill.ownerId;
    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (st: GameState, params: Record<string, Json>) => {
        if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
        if (st.phase !== '出牌') return opts.phaseError;
        if (hasBlockingPending(st)) return opts.blockingError;
        if (usesThisTurn(st, ownerId) >= MAX_USES) return '本阶段强袭已达上限(2次)';
        const self = st.players[ownerId];
        if (!self?.alive) return opts.deadError;

        const cost = params.cost;
        if (cost !== opts.hpCostToken && cost !== 'discard') return opts.costParamError;
        const target = params.target;
        if (typeof target !== 'number') return '需要指定目标';
        if (target === ownerId) return '不能以自己为目标';
        if (!st.players[target]?.alive) return '目标不合法';
        // 关键去重:本回合已以此法指定过的目标不可再指定
        if (usedTargets(st, ownerId).includes(target)) return '本回合已对此角色发动过强袭';
        // 无距离限制:官方未对此法提距离限制,目标可为任意其他角色

        if (cost === 'discard') {
          const cardId = params.cardId;
          if (typeof cardId !== 'string') return '弃武器需要 cardId';
          const card = st.cardMap[cardId];
          if (!isWeaponCard(card)) return '不是武器牌';
          const inHand = self.hand.includes(cardId);
          const inEquip = self.equipment['武器'] === cardId;
          if (!inHand && !inEquip) return '武器不在手牌或装备区';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const from = ownerId;
        const target = params.target as number;
        const cost = params.cost as string;

        // 计数 +1(setPlayerVarUsage 同步设 vars + 回合用量 atom 投影 view,防 dispatch 重入)。
        // 必须在第一个 await 之前设置,以防 dispatch 重入(见制衡.ts 注释)。
        const nextCount = usesThisTurn(st, from) + 1;
        await setPlayerVarUsage(st, from, COUNT_KEY, nextCount);

        // 目标去重:记录本次指定的目标(同步设 vars + 回合用量 atom 投影 view)
        const nextTargets = [...usedTargets(st, from), target];
        await setPlayerVarUsage(st, from, TARGETS_KEY, nextTargets);

        await pushFrame(st, SKILL_ID, from, { ...params });

        // 代价
        if (cost === opts.hpCostToken) {
          // 标版官方:"失去1点体力"——非伤害事件,不触发防具/反馈;
          // 界版官方:"受到1点伤害"——真实伤害事件(触发反馈/奸雄/防具等)。
          await opts.payHpCost(st, from);
          // 代价可能进入濒死(无人救援则死亡):典韦死亡则不再造成伤害(官方 FAQ),
          // 但仍需弹出本次技能结算帧。
          if (!st.players[from]?.alive) {
            await popFrame(st);
            return;
          }
        } else {
          const cardId = params.cardId as string;
          // 装备区武器先卸下(清距离 vars + 回手),再弃置;手牌武器直接弃置。
          if (st.players[from].equipment['武器'] === cardId) {
            await applyAtom(st, { type: '卸下', player: from, slot: '武器' });
          }
          await applyAtom(st, { type: '弃置', player: from, cardIds: [cardId], voluntary: true });
        }

        // 对 target 造成 1 点伤害(来源为典韦,强制伤害,不可被闪抵消)
        await runDamageFlow(st, from, target, 1);
        await popFrame(st);
      },
    );
    return () => {};
  }

  function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
    api.defineAction('use', {
      label: opts.displayName,
      style: 'danger',
      prompt: {
        type: 'selectTarget',
        title: opts.targetTitle,
        description: '本阶段限两次;每名角色每回合仅能被指定一次',
        targetFilter: {
          min: 1,
          max: 1,
          filter: (view, target) => {
            const me = view.currentPlayerIndex;
            if (target === me) return false;
            const tp = view.players.find((pl) => pl.index === target);
            if (!tp || tp.alive === false) return false;
            // 关键:过滤掉本回合已以此法指定过的目标(前端 UI 提示,后端 validate 独立校验)
            const used = view.players[me]?.turnUsage?.[TARGETS_KEY];
            const usedList = Array.isArray(used) ? (used as number[]) : [];
            if (usedList.includes(target)) return false;
            return true;
          },
        },
        // 代价二选一(官方「失去/受到1点体力或伤害 或 弃置一张武器牌」):提交时除 target 外必须带 cost。
        // 枚举层(无头客户端/AI)按变体展开生成可执行 action;弃武器分支还需补 cardId(武器牌)。
        // cost 取值与引擎 validate 同源(opts.hpCostToken)——写错会让该代价分支提交即被拒。
        paramVariants: [
          { label: opts.hpCostVariantLabel, params: { cost: opts.hpCostToken } },
          {
            label: '弃一张武器牌(先选中武器牌)',
            params: { cost: 'discard' },
            // 需要一张武器牌(手牌或装备区):浏览器取选中的武器牌/自己的装备区武器,
            // 无头枚举按「每个武器牌 × 每个合法目标」展开 —— 否则提交缺 cardId 恒被拒。
            cardFilter: (c: Card) => isWeaponCard(c),
          },
        ],
      },
      activeWhen: (ctx) => {
        if (!defaultPlayActive(ctx)) return false;
        const used = ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.[COUNT_KEY];
        return (typeof used === 'number' ? used : 0) < MAX_USES;
      },
    });
    return () => {};
  }

  return { createSkill, onInit, onMount };
}

const OPTIONS: QiangxiOptions = {
  skillId: '强袭',
  displayName: '强袭',
  description:
    '出牌阶段限两次:失去1点体力或弃一张武器牌,对一名本回合未以此法指定过的其他角色造成1点伤害',
  hpCostToken: 'hp',
  hpCostVariantLabel: '失去1点体力',
  targetTitle: '强袭:选择一名本回合未以此法指定过的角色(失去1点体力或弃武器,对其造成1点伤害)',
  payHpCost: async (st, from) => {
    await applyAtom(st, { type: '失去体力', target: from, amount: 1 });
  },
  phaseError: '不是出牌阶段',
  blockingError: '当前有未回应的询问',
  deadError: '已死亡',
  costParamError: 'cost 必须为 hp 或 discard',
};

export const { createSkill, onInit, onMount } = createQiangxiSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
