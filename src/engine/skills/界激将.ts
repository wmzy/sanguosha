// 界激将(界刘备·主公技):
//   主公技,其他蜀势力角色可以在你需要时使用或打出【杀】(视为由你使用或打出);
//   每回合限一次,其他蜀势力角色于其回合外使用、打出或替你使用或打出【杀】时,
//   其可以令你摸一张牌。
//
// OL 官方:
//   "主公技,其他蜀势力角色可以在你需要时使用或打出【杀】(视为由你使用或打出);
//    每回合限一次,其他蜀势力角色于其回合外使用、打出或替你使用或打出【杀】时,
//    其可以令你摸一张牌。"
//
// 与标激将区别:
//   - 标激将:仅主动技形式(主公 dispatch → 蜀角色出杀/不出,不出则主公摸1)。
//   - 界激将:① 沿用标激将主动技机制;② 新增被动触发——蜀角色于其回合外用杀
//     (使用/打出/替你使用),其可令主公摸1张(每回合限一次,选择权在该蜀角色)。
//
// 实现要点:
//   - 主动技 'use' 部分:镜像标激将机制(useCardAndTarget '界激将/出杀' + runUseFlow(none)),
//     ownerId===0(主公固定0号位)门槛不变;damageType 由 cardMap 自动传导(火杀/雷杀不丢)。
//   - 新增 after-hook(指定目标):蜀角色 source 回合外用杀指定目标 → 询问是否令主公摸1。
//     · "使用/替你使用杀" 均会触发 指定目标 atom(杀 use 流程必经),覆盖主路径。
//     · "打出杀"(南蛮入侵/决斗 被询问杀后把杀移入处理区)不走指定目标,故另挂
//       询问杀 after-hook:atom.target(打出方)为蜀角色且回合外且确实打出杀 → 触发摸牌。
//     · "每回合限一次":用 state.turn.vars[PER_TURN_VAR](两条 hook 共享,同一回合只摸一次)。
//   - 跨座次 respond 注册(镜像标激将):全座次注册,按 pending 内容三分支:
//     · 询问杀(主公 seat):响应型代打出(杀/respondKill 逐个询问,杀留处理区);
//     · 界激将/出杀(蜀角色 seat):主动型代使用(选杀+指定 killTarget → capture);
//     · 界激将/drawChoice(蜀角色 seat):被动触发(是否令主公摸1)。
//   - 独立界版文件,注册键 '界激将'(与标激将键隔离,不修改标激将)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../index';
import { runUseFlow } from '../card-effect/use-card';
import { registerAction, registerAfterHook, hasBlockingPending, type SkillModule } from '../skill';
import { inAttackRange } from '../distance';

// localVars keys(界激将新增被动触发)
const REQUEST_TYPE = '界激将/drawChoice';
const CONFIRMED_VAR = '界激将/confirmed';
// 每回合限一次标记:存 state.turn.vars(回合结束 atom 清空 turn.vars → 自动复位)
const PER_TURN_VAR = '界激将/triggered';
// use(代使用)路径的 localVars 键 / requestType 常量(对齐 标激将/乱武 风格)
const USE_REQUEST_TYPE = '界激将/出杀';
const USE_CHOICE_VAR = '界激将/出杀选择';
const USE_KILL_TARGET_VAR = '界激将/killTarget';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界激将',
    description:
      '主公技:蜀势力角色可代你使用或打出杀;每回合限一次,蜀角色回合外用杀时可令你摸1张',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const offs: Array<() => void> = [];

  // ── use:主动激将(沿用标激将机制) ──
  offs.push(
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
        // 主公技:仅主公位(座次 0)可用
        const isLord = ownerId === 0;
        // 目标合法:不是自己 + 存活 + 蜀势力
        const targetIdx = params.target as number | undefined;
        const targetExists = typeof targetIdx === 'number' && !!state.players[targetIdx];
        const target = targetExists ? state.players[targetIdx] : null;
        const targetNotSelf = targetIdx !== ownerId;
        const targetAlive = target?.alive === true;
        const targetShu = target?.faction === '蜀';
        // killTarget 校验:可选,若提供则需存活且≠target
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
        return ok ? null : '现在不能使用界激将';
      },
      async (state: GameState, params: Record<string, Json>) => {
        const from = ownerId;
        const target = params.target as number;
        const killTarget = params.killTarget as number | undefined;
        await pushFrame(state, '界激将', from, { ...params });

        // 存 killTarget 供 respond(出杀分支)权威校验必含目标;结算后清理
        if (typeof killTarget === 'number') {
          state.localVars[USE_KILL_TARGET_VAR] = killTarget;
        }

        // 请求回应:蜀角色选一张杀 + 指定目标(固定=killTarget),经 界激将/出杀 respond
        const killTargetName =
          typeof killTarget === 'number' ? state.players[killTarget]?.name ?? '?' : '?';
        await applyAtom(state, {
          type: '请求回应',
          requestType: USE_REQUEST_TYPE,
          target,
          prompt: {
            type: 'useCardAndTarget',
            title: `界激将:对 ${killTargetName} 使用一张杀`,
            cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
            targetFilter: {
              min: 1,
              max: 1,
              filter: (_v, t: number) =>
                typeof killTarget === 'number' ? t === killTarget : t !== target,
            },
          },
          timeout: 15,
        });

        const choice = state.localVars[USE_CHOICE_VAR] as
          | { cardId: string; targets: number[] }
          | undefined;
        delete state.localVars[USE_CHOICE_VAR];
        delete state.localVars[USE_KILL_TARGET_VAR];

        // 官方:出杀 → 走完整杀结算(runUseFlow→杀.resolveSlash),
        //      damageType 由 cardMap 自动传导(火杀/雷杀不再丢);
        //      不出杀无效果(同标激将)。界激将的摸牌仅由被动触发 hook 负责,
        //      不在主动激将拒绝时摸牌(否则主公可反复激将刷牌)。
        if (choice?.cardId && Array.isArray(choice.targets) && choice.targets.length > 0) {
          await runUseFlow(state, target, choice.cardId, choice.targets, '杀');
        }
        await popFrame(state);
      },
    ),
  );

  // ── 指定目标 after hook:蜀角色回合外用杀 → 询问是否令主公摸1张 ──
  offs.push(
    registerAfterHook(
      state,
      skill.id,
      ownerId,
      '指定目标',
      async (ctx): Promise<void> => {
        // 主公技:仅刘备为主公(座次 0)时生效
        if (ownerId !== 0) return;
        const atom = ctx.atom;
        const sourceIdx = atom.source;
        if (typeof sourceIdx !== 'number') return;
        // 必须是其他蜀势力角色(非主公刘备本人)
        if (sourceIdx === ownerId) return;
        const source = ctx.state.players[sourceIdx];
        if (!source?.alive) return;
        if (source.faction !== '蜀') return;
        // 必须是 杀(检测 cardMap,兼容武圣等转化后的杀卡)
        const cardId = atom.cardId;
        if (!cardId) return;
        const card = ctx.state.cardMap[cardId];
        if (!card || card.name !== '杀') return;
        // 必须是该蜀角色"回合外"(当前回合不是其本人回合)
        if (ctx.state.currentPlayerIndex === sourceIdx) return;
        // 主公需存活(否则无人摸牌)
        const lord = ctx.state.players[ownerId];
        if (!lord?.alive) return;
        // 每回合限一次(本回合已触发过则跳过)
        if (ctx.state.turn.vars[PER_TURN_VAR] === true) return;

        // 标记本回合已触发(同步写 turn.vars 防止 hook 重入;turn.vars 由回合结束自动清空)
        ctx.state.turn.vars[PER_TURN_VAR] = true;
        await applyAtom(ctx.state, {
          type: '回合用量',
          player: ownerId,
          key: PER_TURN_VAR,
          value: true,
        });

        // 询问蜀角色是否令主公摸1张(描述"可以"=可选;选择权在该蜀角色)
        delete ctx.state.localVars[CONFIRMED_VAR];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: REQUEST_TYPE,
          target: sourceIdx,
          prompt: {
            type: 'confirm',
            title: `界激将:是否令${lord.name}摸一张牌?`,
            confirmLabel: '令主公摸牌',
            cancelLabel: '不发动',
          },
          defaultChoice: false,
          timeout: 30,
        });

        if (ctx.state.localVars[CONFIRMED_VAR] === true) {
          // 蜀角色选择发动 → 主公(刘备)摸 1 张
          await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
        }
      },
    ),
  );

  // ── 询问杀 after hook:蜀角色回合外「打出」杀(南蛮入侵/决斗)→ 询问是否令主公摸1张 ──
  //   使用杀走 runUseFlow→「指定目标」(由上面的 hook 覆盖);打出杀(被询问后把杀移入
  //   处理区)不走「指定目标」,故另挂「询问杀」after-hook。
  //   · atom.target = 被询问出杀者(打出方);须确认其确实打出了一张杀(处理区有杀——
  //     调用方的 consumePlayedSlashes 在本 after-hook 之后才清理,故 frameCards 仍含杀)。
  //   · 与「指定目标」hook 共享 PER_TURN_VAR,同一回合只摸一次(同一张杀不可能同时触发
  //     使用与打出两条路径,且 PER_TURN_VAR 防止多次触发)。
  //   · 代打出(主公被询问杀,蜀盟友代打)时 atom.target=主公=ownerId,被早期 return 跳过
  //     (本 hook 仅覆盖蜀角色本人直接打出的路径)。
  offs.push(
    registerAfterHook(
      state,
      skill.id,
      ownerId,
      '询问杀',
      async (ctx): Promise<void> => {
        if (ownerId !== 0) return;
        const atom = ctx.atom;
        // 打出方 = 被询问者(询问杀 atom.target)
        const askedIdx = atom.target;
        if (typeof askedIdx !== 'number') return;
        if (askedIdx === ownerId) return; // 主公本人不算"其他蜀角色"
        const asked = ctx.state.players[askedIdx];
        if (!asked?.alive) return;
        if (asked.faction !== '蜀') return;
        // 必须是蜀角色"回合外"
        if (ctx.state.currentPlayerIndex === askedIdx) return;
        // 必须实际打出了一张杀(询问杀 resolve 后杀牌仍在处理区)
        const playedKill = frameCards(ctx.state).some(
          (id) => ctx.state.cardMap[id]?.name === '杀',
        );
        if (!playedKill) return;
        const lord = ctx.state.players[ownerId];
        if (!lord?.alive) return;
        // 每回合限一次(与「指定目标」hook 共享 PER_TURN_VAR)
        if (ctx.state.turn.vars[PER_TURN_VAR] === true) return;

        ctx.state.turn.vars[PER_TURN_VAR] = true;
        await applyAtom(ctx.state, {
          type: '回合用量',
          player: ownerId,
          key: PER_TURN_VAR,
          value: true,
        });

        delete ctx.state.localVars[CONFIRMED_VAR];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: REQUEST_TYPE,
          target: askedIdx,
          prompt: {
            type: 'confirm',
            title: `界激将:是否令${lord.name}摸一张牌?`,
            confirmLabel: '令主公摸牌',
            cancelLabel: '不发动',
          },
          defaultChoice: false,
          timeout: 30,
        });

        if (ctx.state.localVars[CONFIRMED_VAR] === true) {
          await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
        }
      },
    ),
  );

  // ── respond:注册到全座次,按 pending 内容分支 ────────────────
  //   atom.type==='询问杀'(主公 seat):响应型激将——逐个请求蜀角色代打出杀
  //     (代打出:杀牌进处理区供调用方(决斗/南蛮)检查,复用 杀/respondKill)
  //   atom.requestType==='界激将/出杀'(蜀角色 seat):主动激将——选杀+指定 killTarget(代使用)
  //     (代使用:走 runUseFlow 完整杀结算,damageType 自动传导)
  //   atom.requestType==='界激将/drawChoice'(蜀角色 seat):被动触发——是否令主公摸1张
  //   一个座次仅能有一个 respond action(registerAction 按座次去重),故合并到同一注册。
  for (const pl of state.players) {
    const seat = pl.index;
    offs.push(
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
          if (atom.requestType === USE_REQUEST_TYPE) {
            const cardId = params.cardId as string | undefined;
            const targets = params.targets as number[] | undefined;
            if (typeof cardId !== 'string') return '请选择一张杀';
            if (!Array.isArray(targets) || targets.length === 0) return '请选择目标';
            const self = st.players[seat];
            if (!self?.hand.includes(cardId)) return '牌不在手牌中';
            if (st.cardMap[cardId]?.name !== '杀') return '只能使用杀';
            // 必含主公指定的 killTarget(权威,前端 targetFilter 仅提示)
            const killTarget = st.localVars[USE_KILL_TARGET_VAR] as number | undefined;
            if (typeof killTarget === 'number' && !targets.includes(killTarget))
              return '必须包含激将指定的目标';
            // 每个目标须在蜀角色攻击范围内(镜像 杀.canUse 距离校验)
            for (const t of targets) {
              if (!inAttackRange(st, seat, t, cardId)) return '目标不在攻击范围内';
            }
            return null;
          }

          // ── 被动型(drawChoice):蜀角色是否令主公摸1张 ──
          if (atom.requestType === REQUEST_TYPE) {
            return null;
          }

          return '当前不是界激将询问';
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
                  title: `界激将:主公(${st.players[seat]?.name ?? `P${seat}`})需要杀,是否打出一张杀?`,
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
          if (atom?.requestType === USE_REQUEST_TYPE) {
            st.localVars[USE_CHOICE_VAR] = {
              cardId: params.cardId as string,
              targets: params.targets as number[],
            };
            return;
          }

          // ── 被动型(drawChoice):记录是否令主公摸牌 ──
          if (atom?.requestType === REQUEST_TYPE) {
            st.localVars[CONFIRMED_VAR] = params.choice === true || params.confirmed === true;
          }
        },
      ),
    );
  }

  return () => {
    for (const off of offs) off();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '界激将',
    style: 'primary',
    prompt: {
      type: 'choosePlayer',
      title: '界激将：选择一名蜀势力角色出杀',
      min: 1,
      max: 1,
    },
  });
  // respond:响应型激将(被询问杀时激活) / 主动型(蜀角色被请求出杀) / 被动型(是否令主公摸牌)
  api.defineAction('respond', {
    label: '界激将',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '界激将:令蜀势力角色替你打出杀?',
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
      // 主动型(代使用):蜀角色被请求 界激将/出杀
      if (atom.requestType === USE_REQUEST_TYPE) return true;
      // 被动型:蜀角色被请求是否令主公摸牌
      if (atom.requestType === REQUEST_TYPE) return true;
      return false;
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
