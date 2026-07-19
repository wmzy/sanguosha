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
// 模式 B(主动技变体):
//   - use:主公在出牌阶段注册(主动激将)。
//   - respond:主公在询问杀 pending 时注册(响应激将)。
//   - 蜀角色回应出杀时,复用自身 '杀' 技能的 respond action(requestType='杀/respondKill'
//     触发)把杀牌移入处理区,无需为蜀角色额外注册激将 respond(同挑衅/借刀杀人 复用模式)。
import type { GameState, FrontendAPI, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, hasBlockingPending } from '../skill';

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

      // 请求回应:目标选择出杀
      await applyAtom(state, {
        type: '请求回应',
        requestType: '杀/respondKill',
        target,
        prompt: { type: 'confirm', title: '主公激将:是否出杀?' },
        timeout: 15,
      });

      // 检查处理区:有杀 = 出了杀
      const killCardId = frameCards(state).find((id) => {
        const c = state.cardMap[id];
        return c?.name === '杀';
      });

      if (killCardId) {
        // 出了杀:杀进弃牌堆,执行杀效果
        await applyAtom(state, {
          type: '移动牌',
          cardId: killCardId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
        if (typeof killTarget === 'number') {
          await applyAtom(state, {
            type: '指定目标',
            source: target,
            target: killTarget,
            cardId: killCardId,
          });
          await applyAtom(state, { type: '询问闪', target: killTarget, source: target });
          const dodgeCardId = frameCards(state).find((id) => {
            const c = state.cardMap[id];
            return c?.name === '闪';
          });
          if (dodgeCardId) {
            await applyAtom(state, {
              type: '移动牌',
              cardId: dodgeCardId,
              from: { zone: '处理区' },
              to: { zone: '弃牌堆' },
            });
          } else {
            await applyAtom(state, {
              type: '造成伤害',
              target: killTarget,
              amount: 1,
              source: target,
              cardId: killCardId,
            });
          }
        }
      }
      // 官方:不出杀时无效果(原引擎补充规则"主公摸1张"已移除)
      await popFrame(state);
    },
  );

  // ── respond:响应型激将(主公被询问杀时,请求蜀角色代打出) ──
  // 当前 pending 是询问杀 + target=主公 → 激将.respond → 逐个询问蜀势力角色出杀。
  // 流程同护驾(respond 模式),但复用 '杀/respondKill' requestType:
  //   1. 主公被询问杀(询问杀 atom,pending slot target=主公)
  //   2. 主公 dispatch 激将.respond(dispatch 找到询问杀 slot,pause 它)
  //   3. 激将.respond execute:
  //      a. 按座次顺序逐个询问其他蜀势力角色是否打出杀(请求回应 requestType='杀/respondKill')
  //      b. 第一个出杀的角色:杀牌移入处理区(视为主公打出)
  //      c. 全部拒绝:处理区无杀(主公承受原结算)
  //   4. execute 完成 → dispatch 自动 resolve 询问杀 slot → 调用方检查处理区
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      // 必须有询问杀 pending,target 是主公
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '询问杀') return '当前不是出杀窗口';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      // 主公技:仅主公位可用
      if (ownerId !== 0) return '仅主公可用';
      // 必须有其他蜀势力存活角色(有手牌)
      const hasShuAllies = st.players.some(
        (p) =>
          p.alive &&
          p.index !== ownerId &&
          p.faction === '蜀' &&
          p.hand.length > 0,
      );
      if (!hasShuAllies) return '没有可出杀的蜀势力角色';
      return null;
    },
    async (st: GameState, _params: Record<string, Json>): Promise<void> => {
      // 按座次顺序逐个询问蜀势力角色
      const numPlayers = st.players.length;
      for (let offset = 1; offset < numPlayers; offset++) {
        const allyIdx = (ownerId + offset) % numPlayers;
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
            title: `激将:主公(${st.players[ownerId]?.name ?? `P${ownerId}`})需要杀,是否打出一张杀?`,
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
    },
  );

  return () => {};
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
      if ((slot.atom as { type: string }).type !== '询问杀') return false;
      if (slot.target !== ctx.perspectiveIdx) return false;
      // 势力检查由后端 validate 处理(GameView 不暴露 faction)
      return true;
    },
  });
  return () => {};
}
