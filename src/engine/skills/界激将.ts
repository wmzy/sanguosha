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
//   - 主动技 'use' 部分:逐字复用标激将逻辑,ownerId===0(主公固定0号位)门槛不变。
//   - 新增 after-hook(指定目标):蜀角色 source 回合外用杀指定目标 → 询问是否令主公摸1。
//     · "使用/替你使用杀" 均会触发 指定目标 atom(杀 use 流程必经),覆盖主路径。
//     · "每回合限一次":用 state.turn.vars[PER_TURN_VAR](回合结束 atom 自动清空 turn.vars)。
//   - 跨座次 respond 注册:选择权在蜀角色(非主公),须为每个蜀角色座次注册 respond,
//     否则其 dispatch 找不到 action(同护驾/界救援 跨座次注册模式)。
//   - 独立界版文件,注册键 '界激将'(与标激将键隔离,不修改标激将)。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, registerAfterHook, hasBlockingPending, type SkillModule } from '../skill';

// localVars keys(界激将新增被动触发)
const REQUEST_TYPE = '界激将/drawChoice';
const CONFIRMED_VAR = '界激将/confirmed';
// 每回合限一次标记:存 state.turn.vars(回合结束 atom 清空 turn.vars → 自动复位)
const PER_TURN_VAR = '界激将/triggered';

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
        } else {
          // 不出:主公摸 1 张
          await applyAtom(state, { type: '摸牌', player: from, count: 1 });
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
      async (ctx: AtomAfterContext): Promise<void> => {
        // 主公技:仅刘备为主公(座次 0)时生效
        if (ownerId !== 0) return;
        const atom = ctx.atom as { source?: number; target?: number; cardId?: string };
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

  // ── 为所有其他蜀势力角色注册 respond(回应"是否令主公摸牌"询问)──
  // 选择权在蜀角色(其他蜀角色,非主公),respond 须注册到其座次,否则其 dispatch 找不到
  // action(默认 respond 只注册在 owner=刘备 座次)。同护驾/界救援 跨座次注册模式。
  for (const p of state.players) {
    const pid = p.index;
    if (pid === ownerId) continue;
    if (p.faction !== '蜀') continue;
    const off = registerAction(
      state,
      skill.id,
      pid,
      'respond',
      (st: GameState, _params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return '当前不需要回应';
        const a = slot.atom as Record<string, unknown>;
        if (a['type'] !== '请求回应') return '当前不需要回应';
        if (a['requestType'] !== REQUEST_TYPE) return '当前不是界激将询问';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        st.localVars[CONFIRMED_VAR] = params.choice === true || params.confirmed === true;
      },
    );
    offs.push(off);
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
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
