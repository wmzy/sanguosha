// 激将(刘备·主公技):
//   主公技,其他蜀势力角色可以在你需要时代替你使用或打出【杀】(视为由你使用或打出)。
//
// 两种触发场景(官方"你需要时"):
//   1. 主动使用(use):出牌阶段,主公请求一名蜀势力角色代替使用一张【杀】(指定 killTarget)。
//   2. 响应打出(respond):主公被询问杀时(决斗/南蛮入侵等需要打出【杀】的场景),
//      主公发动激将,按座次逐个询问其他蜀势力角色是否打出一张【杀】(视为主公打出)。
//      第一个出杀的蜀角色:杀牌进处理区 → 调用方(决斗/南蛮入侵)检查处理区有杀 = 已出。
//      全部拒绝:处理区无杀 = 未出(主公承受原结算)。
//
// respond 注册(全座次,按 pending 内容分支,一个座次仅一个 respond):
//   - 代打出(atom.type==='询问杀', 主公 seat):主公被询问杀时,逐个请求蜀角色经
//     '杀/respondKill'(复用 杀.respond)把杀牌移入处理区,调用方(决斗/南蛮)检查
//     处理区判断已出。全部拒绝 → 主公承受原结算。
//   - 代使用(requestType==='激将/出杀', 蜀角色 seat):主动激将时,蜀角色选杀+
//     指定 killTarget,use execute 读 localVars['激将/出杀选择'] → runUseFlow(none)
//     走完整杀结算,damageType 由 cardMap 自动传导(火杀/雷杀不丢)。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../index';
import { runUseFlow } from '../core/card-effect/use-card';
import { registerAction, hasBlockingPending, declareAlternativeResponse } from '../core/skill';
import { inAttackRange } from '../rules/distance';

// use(代使用)路径的 localVars 键 / requestType 常量(对齐 乱武/借刀杀人 风格)
const REQUEST_TYPE = '激将/出杀';
const CHOICE_VAR = '激将/出杀选择';
const KILL_TARGET_VAR = '激将/killTarget';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '激将',
    description:
      '主公技,其他蜀势力角色可以在你需要时代替你使用或打出【杀】(视为由你使用或打出)',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── use:主动激将(出牌阶段,主公请求蜀角色代为使用杀指定 killTarget) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (state: GameState, params: Record<string, Json>) => {
      // 通用合法条件:自己回合 + 出牌阶段 + 无 pending + 存活 + 主公身份 + 目标合法
      const myTurn = state.currentPlayerIndex === ownerId;
      const inActPhase = state.phase === '出牌';
      const free = !hasBlockingPending(state);
      const self = state.players[ownerId];
      const selfAlive = self.alive === true;
      // 激将是主公技:仅主公位可用(以主公位 ownerId===0 为依据)
      const isLord = ownerId === 0;
      // 目标合法:不是自己 + 存活 + 蜀势力
      const targetIdx = params.target as number | undefined;
      const targetExists = typeof targetIdx === 'number' && !!state.players[targetIdx];
      const target = targetExists ? state.players[targetIdx] : null;
      const targetNotSelf = targetIdx !== ownerId;
      const targetAlive = target?.alive === true;
      const targetShu = target?.faction === '蜀';
      // killTarget 校验:可选,若提供则需存活
      const killTargetIdx = params.killTarget as number | undefined;
      const killTargetValid =
        killTargetIdx === undefined ||
        (state.players[killTargetIdx]?.alive === true && killTargetIdx !== targetIdx);
      const ok =
        myTurn &&
        inActPhase &&
        free &&
        selfAlive &&
        isLord &&
        targetExists &&
        targetNotSelf &&
        targetAlive &&
        targetShu &&
        killTargetValid;
      return ok ? null : '现在不能使用激将';
    },
    async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = params.target as number;
      const killTarget = params.killTarget as number | undefined;
      await pushFrame(state, '激将', from, { ...params });

      // 存 killTarget 供 respond(出杀分支)权威校验必含目标;结算后清理
      if (typeof killTarget === 'number') {
        state.localVars[KILL_TARGET_VAR] = killTarget;
      }

      // 请求回应:蜀角色选一张杀 + 指定目标(固定=killTarget),经 激将/出杀 respond
      const killTargetName =
        typeof killTarget === 'number' ? state.players[killTarget]?.name ?? '?' : '?';
      await applyAtom(state, {
        type: '请求回应',
        requestType: REQUEST_TYPE,
        target,
        prompt: {
          type: 'useCardAndTarget',
          title: `激将:对 ${killTargetName} 使用一张杀`,
          cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
          // killTarget 已知时固定该目标;未知时(退化场景)允许任一非自己目标
          targetFilter: {
            min: 1,
            max: 1,
            filter: (_v, t: number) =>
              typeof killTarget === 'number' ? t === killTarget : t !== target,
          },
        },
        timeout: 15,
      });

      const choice = state.localVars[CHOICE_VAR] as
        | { cardId: string; targets: number[] }
        | undefined;
      delete state.localVars[CHOICE_VAR];
      delete state.localVars[KILL_TARGET_VAR];

      // 官方:出杀 → 走完整杀结算(runUseFlow→杀.resolveSlash),
      //      damageType 由 cardMap 自动传导(火杀/雷杀不再丢失);
      //      不出杀无效果。
      if (choice?.cardId && Array.isArray(choice.targets) && choice.targets.length > 0) {
        await runUseFlow(state, target, choice.cardId, choice.targets, '杀');
      }

      await popFrame(state);
    },
  );

  // ── respond:注册到全座次,按 pending 内容分支 ────────────────
  //   atom.type==='询问杀'(主公 seat):响应型激将——逐个请求蜀角色代打出杀
  //     (代打出:杀牌进处理区供调用方(决斗/南蛮)检查,复用 杀/respondKill)
  //   requestType==='激将/出杀'(蜀角色 seat):主动激将——选杀+指定 killTarget(代使用)
  //     (代使用:走 runUseFlow 完整杀结算,damageType 自动传导)
  //   一个座次仅能有一个 respond action(registerAction 按座次去重),故合并到同一注册。
  const unloaders: Array<() => void> = [];
  unloaders.push(declareAlternativeResponse(state, ownerId, '询问杀'));
  for (const pl of state.players) {
    const seat = pl.index;
    unloaders.push(
      registerAction(
        state,
        skill.id,
        seat,
        'respond',
        (st: GameState, params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(seat);
          if (!slot) return '当前不需要回应';
          const atom = slot.atom as { type: string; requestType?: string };

          // ── 响应型(代打出):主公被询问杀 → 逐个请求蜀角色出杀 ──
          if (atom.type === '询问杀') {
            const self = st.players[seat];
            if (!self?.alive) return '玩家不存在或已死亡';
            // 主公技:仅主公位可用
            if (seat !== 0) return '仅主公可用';
            // 必须有其他蜀势力存活角色(有手牌)
            const hasShuAllies = st.players.some(
              (p) =>
                p.alive &&
                p.index !== seat &&
                p.faction === '蜀' &&
                p.hand.length > 0,
            );
            if (!hasShuAllies) return '没有可出杀的蜀势力角色';
            return null;
          }

          // ── 主动型(代使用):蜀角色选杀 + 指定 killTarget ──
          if (atom.requestType === REQUEST_TYPE) {
            const cardId = params.cardId as string | undefined;
            const targets = params.targets as number[] | undefined;
            if (typeof cardId !== 'string') return '请选择一张杀';
            if (!Array.isArray(targets) || targets.length === 0) return '请选择目标';
            const self = st.players[seat];
            if (!self?.hand.includes(cardId)) return '牌不在手牌中';
            if (st.cardMap[cardId]?.name !== '杀') return '只能使用杀';
            // 必含主公指定的 killTarget(权威,前端 targetFilter 仅提示)
            const killTarget = st.localVars[KILL_TARGET_VAR] as number | undefined;
            if (typeof killTarget === 'number' && !targets.includes(killTarget))
              return '必须包含激将指定的目标';
            // 每个目标须在蜀角色攻击范围内(镜像 杀.canUse 距离校验)
            for (const t of targets) {
              if (!inAttackRange(st, seat, t, cardId)) return '目标不在攻击范围内';
            }
            return null;
          }

          return '当前不是激将询问';
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          const slot = st.pendingSlots.get(seat);
          const atom = slot?.atom as { type: string; requestType?: string } | undefined;

          // ── 响应型(代打出):逐个请求蜀角色出杀,第一个出杀即止 ──
          if (atom?.type === '询问杀') {
            // 按座次顺序逐个询问蜀势力角色
            const numPlayers = st.players.length;
            for (let offset = 1; offset < numPlayers; offset++) {
              const allyIdx = (seat + offset) % numPlayers;
              const ally = st.players[allyIdx];
              if (!ally?.alive) continue;
              if (ally.faction !== '蜀') continue;
              if (ally.hand.length === 0) continue;

              // 询问该蜀势力角色是否打出杀(复用 '杀/respondKill' requestType,
              // 蜀角色通过自身 '杀' 技能 respond 把杀牌移入处理区,视为主公打出)
              await applyAtom(st, {
                type: '请求回应',
                requestType: '杀/respondKill',
                target: allyIdx,
                prompt: {
                  type: 'useCard',
                  title: `激将:主公(${st.players[seat]?.name ?? `P${seat}`})需要杀,是否打出一张杀?`,
                  cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
                },
                timeout: 15,
              });

              // 检查处理区:有杀 = 已出,激将结束(杀牌留在处理区供调用方检查)
              const killCardId = frameCards(st).find((id) => {
                const c = st.cardMap[id];
                return c?.name === '杀';
              });
              if (killCardId) return;
              // 该角色拒绝/无杀,继续询问下一个
            }
            // 全部拒绝:处理区无杀,execute 结束,主公承受原结算
            return;
          }

          // ── 主动型(代使用):记录蜀角色的出杀选择 ──
          if (atom?.requestType === REQUEST_TYPE) {
            st.localVars[CHOICE_VAR] = {
              cardId: params.cardId as string,
              targets: params.targets as number[],
            };
          }
        },
      ),
    );
  }

  return () => {
    for (const u of unloaders) u();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  // use:主动激将(出牌阶段选择蜀角色)
  api.defineAction('use', {
    label: '激将',
    style: 'primary',
    prompt: {
      type: 'choosePlayer',
      title: '激将:选择一名蜀势力角色出杀',
      min: 1,
      max: 1,
    },
  });
  // respond:响应型激将(被询问杀时激活)
  api.defineAction('respond', {
    label: '激将',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '激将:令蜀势力角色替你打出杀?',
      confirmLabel: '激将',
      cancelLabel: '不发动',
    },
    activeWhen: (ctx) => {
      const slot = ctx.view.pending;
      if (!slot) return false;
      if (slot.target !== ctx.perspectiveIdx) return false;
      const atom = slot.atom as { type: string; requestType?: string };
      // 响应型(代打出):主公被询问杀
      if (atom.type === '询问杀') return true;
      // 主动型(代使用):蜀角色被请求 激将/出杀
      if (atom.requestType === REQUEST_TYPE) return true;
      // 势力检查由后端 validate 处理(GameView 不暴露 faction)
      return false;
    },
  });
  return () => {};
}
