// 界鞬出(界庞德·群雄·被动技):当你使用【杀】指定目标后,你可以弃置其一张牌,
// 若弃置的牌是:基本牌,其获得此【杀】;非基本牌,其不能抵消此【杀】,
// 你本回合使用【杀】的限制次数+1。
//
// 与标版鞬出(鞬出.ts)的差异:
//   - 标版按"装备/非装备"分类(装备→禁闪,非装备→获得杀)
//   - 界版按"基本/非基本"分类(基本→获得杀,非基本→禁闪 + 本回合出杀次数+1)
//   界版新增"非基本→出杀次数+1"效果,故须独立界版文件,不修改标版。
//
// 实现(四段式,基本骨架同标版鞬出,差异点已注明):
//   1. 指定目标 after hook(source===ownerId, card 是杀, 目标有牌):
//        询问界庞德"是否发动鞬出" → 若发动 → 询问目标弃一张牌(pickTargetCard,目标自选)。
//        弃置所选牌后,按类型分支:
//          · 基本牌:记 localVars['界鞬出/获得杀'][target]=杀cardId
//            (成为目标 before hook + 移动牌 after hook 消费:目标获得此杀,此杀不生效)。
//          · 非基本牌(装备/锦囊):加 '界鞬出/禁闪' 标签(询问闪 before hook 消费,强制命中)
//            + 本回合出杀上限 +1(turn.vars['界鞬出/quotaBonus'] 累计 +
//            registerSlashMaxProvider 返回该值)。
//   2. 成为目标 before hook(target 在获得杀名单):
//        cancel(此杀对该目标不生效,跳过询问闪/造成伤害)。**不在此移动杀牌**——
//        杀.execute 收尾(第三阶段)会无条件 移动牌(杀 处理区→弃牌堆),
//        若在此前移到目标手牌,收尾仍会 push 进弃牌堆 → 牌同时出现在手牌与弃牌堆(状态损坏)。
//        故采用"延迟拿取"(同 奸雄 / 标版鞬出):等杀牌被收尾移入弃牌堆的瞬间再转给目标。
//   3. 移动牌 after hook(杀牌 处理区→弃牌堆 且在获得杀名单):
//        移动牌(杀 弃牌堆→目标手牌)= 目标"获得此杀"。清名单。
//   4. 询问闪 before hook(source===ownerId 且 target 有 '界鞬出/禁闪' 标签):
//        去标签 + cancel(跳过询问闪 → 处理区无闪 → 造成伤害,强制命中)。
//
// 出杀次数+1 实现策略:用 registerSlashMaxProvider 注册一个 provider,返回值 =
//   state.turn.vars['界鞬出/quotaBonus'](number,本回合内累计的非基本牌加成次数)。
//   回合结束 turn.vars 自动清空 → 加成自动失效,符合"本回合"语义。
//   杀.execute 末尾仍调用 incSlashUsed(已用次数 +1),配合 slashMax = 基础1+Σ提供者,
//   自然得到"剩余次数 = 上限 - 已用"。
//
// 标签/localVars 生命周期:阶段1(指定目标)产出,阶段2(成为目标/询问闪/收尾)消费并清除——
//   天然按单次杀结算。杀技能零感知界鞬出。
//
// 目标自选弃牌:官方 FAQ 与标版鞬出同理——目标决定弃基本牌(此杀不命中且目标获得杀)
//   还是非基本牌(强制命中且本回合+1 杀次数)。界庞德仅决定是否发动。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';
import { registerSlashMaxProvider } from '../slash-quota';

const TAG = '界鞬出/禁闪';
const CONFIRM = '界鞬出/confirmed';
const PICK = '界鞬出/选牌';
/** target→杀cardId 映射:目标选了基本牌,应"获得此杀"(成为目标 + 移动牌 hook 消费) */
const GAIN = '界鞬出/获得杀';
/** 本回合出杀次数加成(number):每发动一次"非基本→禁闪"则 +1。回合结束随 turn.vars 清空。 */
const QUOTA_BONUS = '界鞬出/quotaBonus';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '鞬出',
    description:
      '使用杀指定目标后,可弃其一张牌:基本牌则其获得此杀;非基本牌则其不能抵消此杀且本回合出杀次数+1',
  };
}

/** 让目标从自己的手牌/装备区选一张牌弃置(博弈:基本→获得杀不命中,非基本→禁闪命中+出杀+1)。 */
async function askTargetToDiscard(
  state: GameState,
  target: number,
  killCardId: string,
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

  delete state.localVars[PICK];
  await applyAtom(state, {
    type: '请求回应',
    requestType: '界鞬出/选牌',
    target,
    prompt: {
      type: 'pickTargetCard',
      title: '界鞬出:选择弃置的一张牌(基本牌→获得此杀;非基本牌→不能抵消且对方本回合出杀+1)',
      target,
      equipment,
      judge: [],
      handCount,
    },
    defaultChoice: defaultZone as unknown as Json,
    timeout: 20,
  });

  const result = state.localVars[PICK] as
    | { zone: string; cardId: string | null; handIndex: number | null }
    | undefined;
  delete state.localVars[PICK];

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
  if (discardedCard?.type === '基本牌') {
    // 基本牌:目标获得此杀——记入获得杀名单,成为目标 + 移动牌 hook 消费
    const gainMap = (state.localVars[GAIN] as Record<number, string> | undefined) ?? {};
    gainMap[target] = killCardId;
    state.localVars[GAIN] = gainMap;
  } else {
    // 非基本牌(装备/锦囊):目标不能抵消此杀 + 本回合出杀次数+1
    await applyAtom(state, { type: '加标签', player: target, tag: TAG });
    const cur = (state.turn.vars[QUOTA_BONUS] as number | undefined) ?? 0;
    state.turn.vars[QUOTA_BONUS] = cur + 1;
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 出杀上限提供者:返回本回合已累计的"非基本→+1"加成次数 ──
  // 与 registerAction/registerBeforeHook 同构:state-bound 注册,随 unload 清理。
  // 加成值存于 turn.vars,回合结束自动清零(天然满足"本回合"语义)。
  const unloadProvider = registerSlashMaxProvider(state, ownerId, (st, player) => {
    if (player !== ownerId) return 0;
    const bonus = st.turn.vars[QUOTA_BONUS];
    return typeof bonus === 'number' ? bonus : 0;
  });

  // ── respond:被询问时回应(界庞德确认 / 目标选牌)──
  // 界庞德确认只发生在 ownerId 座次,但目标可能是任意玩家——dispatch 按
  // (skillId, ownerId, actionType) 精确查 action,故把 respond 注册到每个座次
  // (以 skillId='界鞬出' 隔离,不与他技冲突)。各座次用独立闭包绑定 seatId。
  const unloaders: Array<() => void> = [unloadProvider];
  for (const p of state.players) {
    const seatId = p.index;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as { type?: string; requestType?: string };
        if (atom.type !== '请求回应') return '当前不是请求回应';
        if (atom.requestType === '界鞬出/confirm') return null; // 界庞德确认:任意 choice
        if (atom.requestType === '界鞬出/选牌') {
          // 目标自选弃牌:校验所选牌在目标自己的区域内
          const me = st.players[seatId];
          if (!me) return '玩家不存在';
          const zone = params.zone;
          if (zone === 'equipment') {
            if (typeof params.cardId !== 'string') return 'cardId required';
            if (!Object.values(me.equipment).includes(params.cardId)) return '该牌不在你的装备区';
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
        return '当前不是界鞬出回应';
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(seatId);
        const requestType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
        if (requestType === '界鞬出/confirm') {
          st.localVars[CONFIRM] = params.choice === true || params.confirmed === true;
        } else if (requestType === '界鞬出/选牌') {
          st.localVars[PICK] = {
            zone: params.zone,
            cardId: params.cardId ?? null,
            handIndex: params.handIndex ?? null,
          };
        }
      },
    );
    unloaders.push(u);
  }

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
    // 目标必须至少有一张牌可弃(手牌或装备)——无牌则不触发(同标版鞬出 FAQ)
    const hasCards =
      targetPlayer.hand.length > 0 || Object.keys(targetPlayer.equipment).length > 0;
    if (!hasCards) return;

    // 询问界庞德是否发动鞬出("你可以"——可选)
    delete ctx.state.localVars[CONFIRM];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '界鞬出/confirm',
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '鞬出:是否弃置目标一张牌?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars[CONFIRM]) return;

    // 目标自选弃一张牌
    await askTargetToDiscard(ctx.state, target, atom.cardId);
  });

  // ── 成为目标 before:目标在获得杀名单 → cancel(此杀对该目标不生效)──
  // 不在此移动杀牌——杀.execute 收尾会无条件把杀牌 处理区→弃牌堆,直接拿走会造成
  // 牌同时出现在手牌与弃牌堆(状态损坏,见 奸雄/标版鞬出)。改由下方 移动牌 after hook 延迟拿取。
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
      const gainMap = ctx.state.localVars[GAIN] as Record<number, string> | undefined;
      if (!gainMap || !(target in gainMap)) return;
      // 此杀不生效:cancel 成为目标 → 杀.execute 跳过该目标的询问闪/造成伤害
      return { kind: 'cancel' };
    },
  );

  // ── 移动牌 after:杀牌被收尾移入弃牌堆时,转给获得杀的目标(延迟拿取)──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const gainMap = ctx.state.localVars[GAIN] as Record<number, string> | undefined;
    if (!gainMap) return;
    const atom = ctx.atom;
    if (atom.to?.zone !== '弃牌堆') return;
    // 找到等着获得此杀牌的目标
    const targetEntry = Object.entries(gainMap).find(([, cid]) => cid === atom.cardId);
    if (!targetEntry) return;
    const target = Number(targetEntry[0]);
    delete gainMap[target];
    if (Object.keys(gainMap).length === 0) delete ctx.state.localVars[GAIN];
    if (!ctx.state.players[target]?.alive) return;
    // 该杀牌刚被父结算(杀.execute 收尾)移入弃牌堆——转给目标手牌(= 获得此杀)
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: atom.cardId!,
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
      if (!player?.tags.includes(TAG)) return;
      // 清标签(仅本次杀有效)+ cancel 询问闪 → 处理区无闪 → 造成伤害
      await applyAtom(ctx.state, { type: '去标签', player: target, tag: TAG });
      return { kind: 'cancel' };
    },
  );

  return () => {
    unloaders.forEach((u) => u());
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '鞬出',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '鞬出:是否弃置目标一张牌?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
