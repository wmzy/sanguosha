// 鞬出(庞德·群雄·被动技):当你使用【杀】指定一名角色为目标后,
// 你可以弃置其一张牌,若弃置的牌为装备牌,其不能使用【闪】;
// 若弃置的牌不为装备牌,其获得此【杀】。
//
// 实现(四段式):
//   1. 指定目标 after hook(source===ownerId, card 是杀, 目标有牌):
//        询问庞德"是否发动鞬出" → 若发动 → 询问目标弃一张牌(pickTargetCard,目标自选)。
//        弃置所选牌后,按类型分支(opts.classify):
//          · 'block'(标版=装备牌):加禁闪标签(询问闪 before hook 消费,强制命中)。
//          · 'gain'(标版=非装备牌):记 localVars[opts.gainKey][target]=杀cardId
//            (成为目标 before hook + 移动牌 after hook 消费:目标获得此杀,此杀不生效)。
//   2. 成为目标 before hook(target 在获得杀名单):
//        cancel(此杀对该目标不生效,跳过询问闪/造成伤害)。**不在此移动杀牌**——
//        杀.execute 收尾(第三阶段)会无条件 移动牌(杀 处理区→弃牌堆),
//        若在此前移到目标手牌,收尾仍会 push 进弃牌堆 → 牌同时出现在手牌与弃牌堆(状态损坏)。
//        故采用"延迟拿取"(同 奸雄):等杀牌被收尾移入弃牌堆的瞬间再转给目标。
//   3. 移动牌 after hook(杀牌 处理区→弃牌堆 且在获得杀名单):
//        移动牌(杀 弃牌堆→目标手牌)= 目标"获得此杀"。清名单。
//   4. 询问闪 before hook(source===ownerId 且 target 有禁闪标签):
//        去标签 + cancel(跳过询问闪 → 处理区无闪 → 造成伤害,强制命中)。
//
// 标签/localVars 生命周期:阶段1(指定目标)产出,阶段2(成为目标/询问闪/收尾)消费并清除——
//   天然按单次杀结算。杀技能零感知鞬出。
//
// 目标自选弃牌:详细规则效果①"(目标选择弃置手牌还是装备)"及备注"博弈性——目标可以选择"
//   明确由目标决定弃手牌(此杀不命中且目标获得杀)还是装备(强制命中)。庞德仅决定是否发动。
//
// 本文件同时导出 createJianchuSkill 工厂(鞬出族共享实现),界鞬出 复用之:
// 四段式骨架/全座次 respond/目标自选弃牌 逐字共享,仅 键前缀/文案/弃牌分类/禁闪附加效果
// 经 opts 注入(标版按"装备/非装备"分类,界版按"基本/非基本"分类并加出杀次数+1)。
import type {
  Card,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAfterHook, registerBeforeHook } from '../core/skill';
import {
  currentRequestType,
  askConfirm,
  defineConfirmAction,
  registerRespondForAllSeats,
} from '../util/skillRuntime';

const TAG = '鞬出/禁闪';
const CONFIRM = '鞬出/confirmed';
const PICK = '鞬出/选牌'; // 选牌询问的 requestType
/** target→杀cardId 映射:目标选了非装备牌,应"获得此杀"(成为目标 + 移动牌 hook 消费) */
const GAIN = '鞬出/获得杀';

/** 鞬出族(被动技)差异参数 */
export interface JianchuOptions {
  description: string;
  /** 禁闪标签('鞬出/禁闪'/'界鞬出/禁闪') */
  tag: string;
  /** 确认询问 requestType('鞬出/confirm'/'界鞬出/confirm') */
  confirmRt: string;
  /** 确认结果 localVars key */
  confirmedKey: string;
  /** 选牌询问 requestType */
  pickRt: string;
  /** 选牌面板标题 */
  pickTitle: string;
  /** 获得杀名单 localVars key */
  gainKey: string;
  /** respond 兜底错误文案('当前不是鞬出回应'/'当前不是界鞬出回应') */
  respondFallbackError: string;
  /** 指定目标时清除上次杀残留的禁闪标签(标版有;界版无)。 */
  cleanResidualTag?: boolean;
  /** 弃牌分类:'block'=禁闪(不能抵消);'gain'=目标获得此杀。
   *  标版按 装备/非装备 分类;界版按 基本/非基本 分类。 */
  classify: (discardedCard: Card | undefined) => 'block' | 'gain';
  /** 禁闪分支附加效果(界版:本回合出杀次数+1)。 */
  onBlock?: (state: GameState, ownerId: number, target: number) => Promise<void>;
  /** onMount 确认弹窗标题 */
  mountTitle: string;
  /** 界版附加初始化(出杀上限 provider),返回 unloader。 */
  extraInit?: (state: GameState, ownerId: number) => () => void;
}

/** 鞬出族共享实现:标版鞬出与界鞬出的四段式骨架逐字一致,差异全部经 opts 注入。 */
export function createJianchuSkill(opts: JianchuOptions) {
  return {
    createSkill(id: string, ownerId: number): Skill {
      return {
        id,
        ownerId,
        name: '鞬出',
        description: opts.description,
      };
    },

    onInit(skill: Skill, state: GameState): (() => void) | undefined {
      const ownerId = skill.ownerId;

      const unloaders: Array<() => void> = [];
      if (opts.extraInit) {
        unloaders.push(opts.extraInit(state, ownerId));
      }

      // ── respond:被询问时回应(庞德确认 / 目标选牌)──
      // 庞德确认只发生在 ownerId 座次,但目标可能是任意玩家——dispatch 按
      // (skillId, ownerId, actionType) 精确查 action,故把 respond 注册到每个座次
      // (以技能 id 隔离,不与他技冲突)。
      unloaders.push(
        ...registerRespondForAllSeats(
          state,
          skill.id,
          (st: GameState, seat: number, params: Record<string, Json>): string | null => {
            const slot = st.pendingSlots.get(seat);
            if (!slot) return '当前不需要回应';
            const atom = slot.atom as { type?: string };
            if (atom.type !== '请求回应') return '当前不是请求回应';
            const requestType = currentRequestType(st, seat);
            if (requestType === opts.confirmRt) return null; // 庞德确认:任意 choice
            if (requestType === opts.pickRt) {
              // 目标自选弃牌:校验所选牌在目标自己的区域内
              const me = st.players[seat];
              if (!me) return '玩家不存在';
              const zone = params.zone;
              if (zone === 'equipment') {
                if (typeof params.cardId !== 'string') return 'cardId required';
                if (!Object.values(me.equipment).includes(params.cardId))
                  return '该牌不在你的装备区';
                return null;
              }
              if (zone === 'hand') {
                if (typeof params.handIndex !== 'number') return 'handIndex required';
                if (params.handIndex < 0 || params.handIndex >= me.hand.length)
                  return 'handIndex 越界';
                return null;
              }
              return 'zone required (equipment|hand)';
            }
            return opts.respondFallbackError;
          },
          async (st: GameState, seat: number, params: Record<string, Json>): Promise<void> => {
            const requestType = currentRequestType(st, seat);
            if (requestType === opts.confirmRt) {
              st.localVars[opts.confirmedKey] =
                params.choice === true || params.confirmed === true;
            } else if (requestType === opts.pickRt) {
              // 目标自选弃牌结果(由 askTargetToDiscard 读取;键 = requestType 字面量)
              st.localVars[opts.pickRt] = {
                zone: params.zone,
                cardId: params.cardId ?? null,
                handIndex: params.handIndex ?? null,
              };
            }
          },
        ),
      );

      // ── 指定目标 after:自己出杀指定目标 → 询问是否发动 → 目标选牌弃置 ──
      registerAfterHook(state, skill.id, ownerId, '指定目标', async (ctx) => {
        const atom = ctx.atom;
        if (atom.source !== ownerId) return;
        if (atom.target === undefined) return;
        const target = atom.target;
        if (atom.cardId === undefined) return; // 无牌事件容错放过
        const card = ctx.state.cardMap[atom.cardId];
        if (card?.name !== '杀') return;
        const targetPlayer = ctx.state.players[target];
        if (!targetPlayer?.alive) return;
        // 目标必须至少有一张牌可弃(手牌或装备)——无牌则不触发(FAQ)
        const hasCards =
          targetPlayer.hand.length > 0 || Object.keys(targetPlayer.equipment).length > 0;
        if (!hasCards) return;

        // 清除上次杀可能残留的禁闪标签:标签本应"单次杀结算"由 询问闪 before-hook 消费,
        // 但若本杀结算被跳过(检测有效性被仁王盾/藤甲 cancel,或 成为目標 被空城等技能 cancel),
        // 询问闪未触发,标签会残留并串扰下一次对该目标的杀(误禁闪)。同 界烈弓,每次指定目标先清空残留。
        if (opts.cleanResidualTag && targetPlayer.tags.includes(opts.tag)) {
          await applyAtom(ctx.state, { type: '去标签', player: target, tag: opts.tag });
        }

        // 询问庞德是否发动鞬出("你可以"——可选)
        const confirmed = await askConfirm(ctx.state, opts.confirmRt, ownerId, {
          confirmedKey: opts.confirmedKey,
          title: '鞬出:是否弃置目标一张牌?',
          confirmLabel: '发动',
          cancelLabel: '不发动',
          defaultChoice: false,
          timeout: 15,
        });
        if (!confirmed) return;

        // 目标自选弃一张牌
        await askTargetToDiscard(ctx.state, ownerId, target, atom.cardId, opts);
      });

      // ── 成为目标 before:目标在获得杀名单 → cancel(此杀对该目标不生效)──
      // 不在此移动杀牌——杀.execute 收尾会无条件把杀牌 处理区→弃牌堆,直接拿走会造成
      // 牌同时出现在手牌与弃牌堆(状态损坏,见 奸雄)。改由下方 移动牌 after hook 延迟拿取。
      registerBeforeHook(
        state,
        skill.id,
        ownerId,
        '成为目标',
        async (ctx): Promise<HookResult | void> => {
          const atom = ctx.atom;
          if (atom.source !== ownerId) return;
          const target = atom.target;
          if (target === undefined) return;
          const gainMap = ctx.state.localVars[opts.gainKey] as Record<number, string> | undefined;
          if (!gainMap || !(target in gainMap)) return;
          // 此杀不生效:cancel 成为目标 → 杀.execute 跳过该目标的询问闪/造成伤害
          return { kind: 'cancel' };
        },
      );

      // ── 移动牌 after:杀牌被收尾移入弃牌堆时,转给获得杀的目标(延迟拿取)──
      registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
        const gainMap = ctx.state.localVars[opts.gainKey] as Record<number, string> | undefined;
        if (!gainMap) return;
        const atom = ctx.atom;
        if (atom.to?.zone !== '弃牌堆') return;
        // 找到等着获得此杀牌的目标
        const targetEntry = Object.entries(gainMap).find(([, cid]) => cid === atom.cardId);
        if (!targetEntry) return;
        const target = Number(targetEntry[0]);
        delete gainMap[target];
        if (Object.keys(gainMap).length === 0) delete ctx.state.localVars[opts.gainKey];
        if (!ctx.state.players[target]?.alive) return;
        // 该杀牌刚被父结算(杀.execute 收尾)移入弃牌堆——转给目标手牌(= 获得此杀)
        await applyAtom(ctx.state, {
          type: '移动牌',
          cardId: atom.cardId,
          from: { zone: '弃牌堆' },
          to: { zone: '手牌', player: target },
        });
      });

      // ── 询问闪 before:目标有禁闪标签 → 去标签 + cancel(强制命中)──
      registerBeforeHook(
        state,
        skill.id,
        ownerId,
        '询问闪',
        async (ctx): Promise<HookResult | void> => {
          const atom = ctx.atom;
          if (atom.source !== ownerId) return;
          const target = atom.target;
          if (target === undefined) return;
          const player = ctx.state.players[target];
          if (!player?.tags.includes(opts.tag)) return;
          // 清标签(仅本次杀有效)+ cancel 询问闪 → 处理区无闪 → 造成伤害
          await applyAtom(ctx.state, { type: '去标签', player: target, tag: opts.tag });
          return { kind: 'cancel' };
        },
      );

      return () => {
        unloaders.forEach((u) => u());
      };
    },

    onMount(_skill: Skill, api: FrontendAPI): void {
      defineConfirmAction(api, 'respond', {
        label: '鞬出',
        title: opts.mountTitle,
        style: 'default',
      });
    },
  };
}

/** 让目标从自己的手牌/装备区选一张牌弃置(博弈:标版 装备→禁闪命中/非装备→获得杀不命中;
 *  界版 基本→获得杀不命中/非基本→禁闪命中+出杀+1)。目标自选自弃,超时默认明牌优先。 */
async function askTargetToDiscard(
  state: GameState,
  ownerId: number,
  target: number,
  killCardId: string,
  opts: JianchuOptions,
): Promise<void> {
  const tp = state.players[target];
  if (!tp) return;
  const equipment = Object.entries(tp.equipment)
    .filter(([, id]) => typeof id === 'string')
    .map(([slot, id]) => ({ slot, cardId: id, cardName: state.cardMap[id]?.name ?? '?' }));
  const handCount = tp.hand.length;
  // 超时默认:明牌优先(装备首张),否则手牌[0]
  const defaultZone =
    equipment.length > 0
      ? { zone: 'equipment', cardId: equipment[0].cardId }
      : { zone: 'hand', handIndex: 0 };

  delete state.localVars[opts.pickRt];
  await applyAtom(state, {
    type: '请求回应',
    requestType: opts.pickRt,
    target,
    prompt: {
      type: 'pickTargetCard',
      title: opts.pickTitle,
      target,
      equipment,
      judge: [],
      handCount,
    },
    defaultChoice: defaultZone as unknown as Json,
    timeout: 20,
  });

  const result = state.localVars[opts.pickRt] as
    | { zone: string; cardId: string | null; handIndex: number | null }
    | undefined;
  delete state.localVars[opts.pickRt];

  const zone = result?.zone ?? defaultZone.zone;
  let discardId: string | undefined;
  if (zone === 'equipment') {
    discardId = result?.cardId ?? (defaultZone as { cardId?: string }).cardId;
  } else {
    // 手牌盲选(目标自选,后端按 handIndex 取)
    const idx = result?.handIndex ?? 0;
    discardId = tp.hand[idx] ?? tp.hand[0];
  }
  if (!discardId) return;

  // 弃置所选牌(装备技能卸载由系统规则 弃置 after hook 统一兜底)
  await applyAtom(state, { type: '弃置', player: target, cardIds: [discardId] });

  const discardedCard = state.cardMap[discardId];
  if (opts.classify(discardedCard) === 'block') {
    // 禁闪:目标不能抵消此杀(询问闪 before hook 消费并清除标签)
    await applyAtom(state, { type: '加标签', player: target, tag: opts.tag });
    // 界版附加:本回合出杀次数+1
    await opts.onBlock?.(state, ownerId, target);
  } else {
    // 获得杀:目标获得此杀——记入获得杀名单,成为目标 + 移动牌 hook 消费
    const gainMap = (state.localVars[opts.gainKey] as Record<number, string> | undefined) ?? {};
    gainMap[target] = killCardId;
    state.localVars[opts.gainKey] = gainMap;
  }
}

const OPTIONS: JianchuOptions = {
  description: '使用杀指定目标后,可弃其一张牌:装备牌则其不能出闪,非装备牌则其获得此杀',
  tag: TAG,
  confirmRt: '鞬出/confirm',
  confirmedKey: CONFIRM,
  pickRt: PICK,
  pickTitle: '鞬出:选择弃置的一张牌(装备→不能出闪;非装备→获得此杀不命中)',
  gainKey: GAIN,
  respondFallbackError: '当前不是鞬出回应',
  cleanResidualTag: true,
  classify: (card) => (card?.type === '装备牌' ? 'block' : 'gain'),
  mountTitle: '鞬出:是否弃置目标一张牌？',
};

export const { createSkill, onInit, onMount } = createJianchuSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;

// [requestType 迁移·不迁项] respond 校验里的 slot/atom 另用于 atom.type !== '请求回应'
// 守卫,保留手写 pendingSlots.get;requestType 读取已走 currentRequestType。
