// 截辎(界徐晃·触发技,OL 现行界版):
//   当一名角色跳过摸牌阶段后,你可以选择一名角色,若其手牌数全场最少且没有"辎",
//   其获得"辎"标记,否则其摸一张牌。有"辎"的角色于其摸牌阶段结束时移除"辎",
//   然后执行一个额外的摸牌阶段。
//
// 与标版差异:标版仅"一名其他角色跳过摸牌阶段后,你摸一张牌"(极简版)。
//   界版实现完整的"辎"标记系统 + 额外摸牌阶段机制,且:
//   - 触发对象:标版"其他角色",界版"一名角色"(含自己,无"其他"限定)
//   - 效果:标版"你摸一张牌",界版"选目标 → 加'辎'或令其摸一张牌"
//   - 额外机制:"辎"标记 + 摸牌阶段结束时的额外摸牌阶段
//
// 触发检测(沿用标版的 skipPhase 检测模式):
//   "跳过摸牌阶段"在引擎中由 skipPhase 实现(兵粮寸断/神速/巧变等):
//     skipPhase 在 阶段开始(摸牌) 的 before-hook 中 applyAtom(阶段结束,摸牌) + cancel。
//   cancel 导致 阶段开始(摸牌) 的 apply/after-hook 不执行;而 阶段结束(摸牌) 仍执行。
//   正常摸牌阶段:阶段开始(摸牌) apply 成功 → after-hook 执行 → 摸牌2张 → 阶段结束(摸牌)。
//
//   故检测策略:
//   1) 阶段开始(摸牌) after-hook:标记 normalDrawPhase=player(仅正常开始时执行;被跳过时不执行)
//   2) 阶段结束(摸牌) after-hook:两个分支:
//      A) 正常结束(normalDrawPhase === player):若有"辎" → 移除 + 执行额外摸牌阶段
//      B) 被跳过(normalDrawPhase !== player):触发 截辎(owner 选目标)
//
// 额外摸牌阶段的执行(关键设计,避免双重 出牌窗口 循环):
//   不能在 阶段结束(摸牌) after-hook 中再 applyAtom(阶段结束,摸牌)——会触发 回合管理 的
//   after-hook 启动第二个 出牌窗口 循环(双重 pending 损坏状态)。
//   改用"半程"执行:applyAtom(阶段开始, 摸牌) + applyAtom(摸牌, count=2),
//   不再 applyAtom(阶段结束, 摸牌) —— 让外层 回合管理 的 after-hook 自然推进到 出牌。
//   - 阶段开始(摸牌) 会触发 英姿/好施 等的 before-hook(其 usedThisTurn 防重入,不会二次发动)
//   - 完成后必须清除 normalDrawPhase 标记:额外 阶段开始(摸牌) 把它重设为 phasePlayer,
//     若不清除,下次该玩家摸牌阶段被跳过时会误判为"正常开始"(检测失效)
//
// "辎"标记:
//   - 唯一 id='辎',加在目标玩家 marks 上;若有则不再加(官方条件"没有辎")
//   - 无 duration:持久,于其下个摸牌阶段结束时显式移除
//   - 玩家死亡后 marks 随之失效(本技能所有路径均检测 alive,不会对死人触发)
//
// 非锁定技:描述以"当...你可以"开头,非"锁定技",故 hooks 受 界铁骑/义绝 压制影响。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Mark,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

/** localVars key:最近一个正常开始的摸牌阶段所属玩家 */
const NORMAL_KEY = '截辎/normalDrawPhase';
/** "辎"标记 id(加在目标玩家 marks 上,唯一实例) */
const ZI_MARK_ID = '辎';
/** localVars key:owner 是否发动 截辎 */
const CONFIRM_KEY = '截辎/confirmed';
/** localVars key:owner 选择的目标 */
const TARGET_KEY = '截辎/target';
/** requestType:发动询问 */
const CONFIRM_RT = '截辎/confirm';
/** requestType:选目标 */
const CHOOSE_TARGET_RT = '截辎/chooseTarget';

/** 玩家是否拥有"辎"标记 */
function hasZi(state: GameState, player: number): boolean {
  return state.players[player]?.marks.some((m) => m.id === ZI_MARK_ID) ?? false;
}

/** 全场存活玩家最小手牌数;无存活玩家时返回 Infinity */
function minHandCount(state: GameState): number {
  let min = Infinity;
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.hand.length < min) min = p.hand.length;
  }
  return min;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '截辎',
    description:
      '当一名角色跳过摸牌阶段后,你可以选择一名角色:若其手牌数全场最少且没有"辎",其获得"辎"标记,否则其摸一张牌。有"辎"的角色于其摸牌阶段结束时移除"辎"并执行一个额外的摸牌阶段',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond action:处理 截辎 的 confirm / chooseTarget 两种询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== CONFIRM_RT && rt !== CHOOSE_TARGET_RT) return '当前不是截辎询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === CHOOSE_TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
      }
    },
  );

  // ── 阶段开始(摸牌) after-hook:标记正常开始的摸牌阶段 ──
  //   skipPhase 在 before-hook cancel 阶段开始 → 本 after-hook 不执行 → 标记不设置
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type: string; phase: string; player: number };
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '摸牌') return;
    ctx.state.localVars[NORMAL_KEY] = atom.player;
  });

  // ── 阶段结束(摸牌) after-hook:两个分支 ──
  registerAfterHook(state, skill.id, ownerId, '阶段结束', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type: string; phase: string; player: number };
    if (atom.type !== '阶段结束') return;
    if (atom.phase !== '摸牌') return;

    const phasePlayer = atom.player;
    const startedNormally = ctx.state.localVars[NORMAL_KEY] === phasePlayer;
    delete ctx.state.localVars[NORMAL_KEY];

    if (startedNormally) {
      // 分支 A:正常摸牌阶段结束 → 检查"辎"标记
      if (!hasZi(ctx.state, phasePlayer)) return;
      if (!ctx.state.players[phasePlayer]?.alive) return;

      // 移除"辎"标记
      await applyAtom(ctx.state, {
        type: '去标记',
        player: phasePlayer,
        markId: ZI_MARK_ID,
      });

      // 执行额外的摸牌阶段(半程:阶段开始(摸牌) + 摸牌;不再 阶段结束)
      // 阶段开始(摸牌) 会触发 英姿/好施 等 before-hook(其 usedThisTurn 防重入不会二次发动)
      await applyAtom(ctx.state, {
        type: '阶段开始',
        player: phasePlayer,
        phase: '摸牌',
      });
      await applyAtom(ctx.state, { type: '摸牌', player: phasePlayer, count: 2 });

      // 清除 NORMAL_KEY:上面 阶段开始(摸牌) 的 after-hook 把它重设为 phasePlayer,
      // 若不清除,下次该玩家摸牌阶段被 skipPhase 跳过时会误判为"正常开始"。
      delete ctx.state.localVars[NORMAL_KEY];
      return;
    }

    // 分支 B:摸牌阶段被跳过 → 触发 截辎(owner 可选)
    if (!ctx.state.players[ownerId]?.alive) return;

    // 询问 owner 是否发动 截辎
    delete ctx.state.localVars[CONFIRM_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动截辎?(选择一名角色:若其手牌数全场最少且没有"辎",其获得"辎"标记,否则其摸一张牌)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars[CONFIRM_KEY]) return;

    // 询问 owner 选目标(任意存活角色:可为自己/跳过者/其他)
    delete ctx.state.localVars[TARGET_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CHOOSE_TARGET_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '截辎:选择一名角色(手牌全场最少且没"辎"→获得"辎";否则其摸一张牌)',
        min: 1,
        max: 1,
        filter: (view: GameView, t: number) => view.players[t]?.alive === true,
      },
      timeout: 20,
    });
    const target = ctx.state.localVars[TARGET_KEY] as number | undefined;
    delete ctx.state.localVars[TARGET_KEY];
    if (typeof target !== 'number') return;
    if (!ctx.state.players[target]?.alive) return;

    // 结算:若 target 手牌数全场最少 且 没有"辎" → 加"辎";否则 target 摸一张牌
    const minCount = minHandCount(ctx.state);
    const targetHand = ctx.state.players[target].hand.length;
    if (targetHand === minCount && !hasZi(ctx.state, target)) {
      const ziMark: Mark = { id: ZI_MARK_ID, scope: target };
      await applyAtom(ctx.state, { type: '加标记', player: target, mark: ziMark });
    } else {
      await applyAtom(ctx.state, { type: '摸牌', player: target, count: 1 });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '截辎',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '截辎',
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });
}
