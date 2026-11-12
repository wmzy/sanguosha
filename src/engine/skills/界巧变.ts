// 界巧变(界张郃·主动技):
//   游戏开始时,你获得 2 枚"变"标记。
//   你可以弃置一张牌或移除 1 枚"变",跳过你的一个阶段(准备阶段和结束阶段除外):
//     - 跳过摸牌阶段:你可以获得至多两名角色各一张手牌
//     - 跳过出牌阶段:你可以移动场上的一张牌
//   结束阶段,若你的手牌数与之前你每回合结束阶段的手牌数均不相等,你获得 1 枚"变"。
//
// 与标版巧变的区别:
//   - 标版:每阶段必须弃一张手牌才能跳过,无"变"标记系统。
//   - 界版:引入"变"标记(开局 2 枚)。跳阶段的方式 = 弃一张手牌 **或** 移除 1 枚"变"。
//     结束阶段手牌数"独一无二"时再得 1 枚"变",标记可持续累积。
//   - 跳过弃牌阶段无附加效果(标版/界版一致)——旧实现曾错误添加"摸一张牌",已删除。
//
// 实现:
//   - 可跳阶段守卫、确认/弃牌询问、跳阶段收尾骨架、摸牌偷牌与出牌移动附加效果、
//     respond 处理均复用标版(巧变.ts 导出);requestType/localVars key/标题前缀
//     以技能名"界巧变"派生,与标版逐字同构。
//   - "变"标记存储:每枚 = 一个 mark,id 形如 `界巧变/变:N`(N=seq,参考 屯田 的"田")。
//     count = marks.filter(m => m.id.startsWith('界巧变/变:')).length。
//     加/减经 加标记/去标记 atom(view 自动同步)。
//   - 历史手牌数:player.vars['界巧变/历史手牌数'](number[],跨回合持久;
//     无 /usedThisTurn 等被 回合结束 atom 清理的后缀,故自动保留)。
//   - 游戏开始初始化(化身先例):'回合开始' after-hook,首次触发时给本玩家加 2 枚变。
//     主公首回合开始 ≈ 游戏开始,此时所有玩家实例同步初始化。
//   - before hook 挂在「阶段开始」(判定/摸牌/出牌/弃牌):
//       1) 询问是否发动。
//       2) 选择方式(弃牌 / 移除变)——只有一种可用时跳过此询问。
//       3) 按方式扣资源 + 按阶段附加效果(摸牌偷牌/出牌移动)。
//       4) 跳过当前阶段(直接型:阶段结束 推进 + cancel)。
//   - after hook 挂在「阶段开始」(phase='回合结束',即"结束阶段"):
//       检查手牌数是否与历史均不相等,是则 +1 变 + 记录历史。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply'
import { registerAction, registerBeforeHook, registerAfterHook } from '../core/skill';
import {
  askConfirmToSkipPhase,
  askDiscardCardForSkip,
  handleQiaobianRespond,
  qiaobianRequestTypes,
  runSkipPhaseBonus,
  skipPhaseInFrame,
  skippablePhaseOf,
} from './巧变';

const SKILL_NAME = '界巧变';

// ── requestType 常量(用于 请求回应 atom 的 requestType 字段) ──
const MODE_RT = `${SKILL_NAME}/mode`; // 选择发动方式:弃牌 or 移除变

// ── 跨 atom 通信(localVars,执行内瞬时) ──
const MODE_KEY = `${SKILL_NAME}/mode`; // '变' | 'discard'

// ── 持久状态(player.vars / marks) ──
/** 历史结束阶段手牌数:number[],跨回合持久(无 /usedThisTurn 等清理后缀) */
const HISTORY_KEY = '界巧变/历史手牌数';
/** 每枚"变"= 一个 mark,id 形如 `${BIAN_PREFIX}${seq}` */
const BIAN_PREFIX = '界巧变/变:';
/** 游戏开始初始化标记(localVars,per-owner,首次触发后置 true) */
const INIT_KEY = (ownerId: number) => `界巧变/init/${ownerId}`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_NAME,
    description:
      '游戏开始获得2枚"变"标记;弃一张牌或移除1枚"变"跳过阶段(摸牌:至多两名角色各获得一张手牌;出牌:移动场上的一张牌);结束阶段手牌数与历史均不相等则获得1枚"变"',
  };
}

// ── "变"标记读写辅助 ──

function bianCount(state: GameState, player: number): number {
  return state.players[player].marks.filter((m) => m.id.startsWith(BIAN_PREFIX)).length;
}

async function addBian(state: GameState, player: number): Promise<void> {
  await applyAtom(state, {
    type: '加标记',
    player,
    mark: { id: `${BIAN_PREFIX}${state.seq}`, scope: player },
  });
}

async function removeBian(state: GameState, player: number): Promise<void> {
  const marks = state.players[player].marks;
  const target = marks.find((m) => m.id.startsWith(BIAN_PREFIX));
  if (!target) return;
  await applyAtom(state, { type: '去标记', player, markId: target.id });
}

// ── 历史手牌数读写 ──

function getHistory(state: GameState, player: number): number[] {
  const v = state.players[player].vars[HISTORY_KEY];
  return Array.isArray(v) ? (v as number[]).filter((n): n is number => typeof n === 'number') : [];
}

function appendHistory(state: GameState, player: number, handCount: number): void {
  const history = getHistory(state, player);
  state.players[player].vars[HISTORY_KEY] = [...history, handCount];
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:界张郃本人对界巧变各询问的回应(标/界共用处理 + 界版 mode 询问) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      const valid = [...qiaobianRequestTypes(SKILL_NAME), MODE_RT];
      if (!valid.includes(rt)) return `当前不是${SKILL_NAME}询问`;
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === MODE_RT) {
        // params.choice === true → 移除 1 枚"变";否则弃一张手牌
        st.localVars[MODE_KEY] = params.choice === true ? '变' : 'discard';
        return;
      }
      handleQiaobianRespond(st, ownerId, SKILL_NAME, params);
    },
  );

  // ── 游戏开始初始化(化身先例):'回合开始' after-hook,首次触发加 2 枚"变" ──
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx) => {
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;
    if (st.localVars[INIT_KEY(ownerId)]) return;
    st.localVars[INIT_KEY(ownerId)] = true;
    await addBian(st, ownerId);
    await addBian(st, ownerId);
  });

  // ── 阶段开始 before hook:可跳过阶段的主逻辑 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<HookResult | void> => {
      const target = skippablePhaseOf(ctx, ownerId);
      if (!target) return;
      const { phase, self } = target;

      // 可用方式:弃手牌 / 移除变
      const canDiscard = self.hand.length > 0;
      const canUseBian = bianCount(ctx.state, ownerId) > 0;
      if (!canDiscard && !canUseBian) return; // 两种方式都不可 → 无法发动

      // 询问是否发动
      const confirmed = await askConfirmToSkipPhase(
        ctx,
        ownerId,
        SKILL_NAME,
        `是否发动${SKILL_NAME}?(跳过${phase}阶段)`,
      );
      if (!confirmed) return; // 不发动 → 阶段正常进行

      // 选择发动方式:两者都有时询问,只有一种时直接采用
      let mode: '变' | 'discard';
      if (canDiscard && canUseBian) {
        delete ctx.state.localVars[MODE_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: MODE_RT,
          target: ownerId,
          prompt: {
            type: 'confirm',
            title: `${SKILL_NAME}:以何种方式跳过${phase}阶段?`,
            description: '确认 = 移除1枚"变"标记;取消 = 弃置一张手牌',
            confirmLabel: '移除1枚变',
            cancelLabel: '弃置手牌',
          },
          defaultChoice: false,
          timeout: 10,
        });
        const chosen = ctx.state.localVars[MODE_KEY] as '变' | 'discard' | undefined;
        mode = chosen === '变' ? '变' : 'discard';
        delete ctx.state.localVars[MODE_KEY];
      } else if (canUseBian) {
        mode = '变'; // 无手牌只能用变
      } else {
        mode = 'discard'; // 无变只能弃牌
      }

      // 弃牌方式:必须能选到合法手牌;否则阶段正常进行
      let discardCardId: string | undefined;
      if (mode === 'discard') {
        discardCardId = await askDiscardCardForSkip(ctx, ownerId, SKILL_NAME, phase);
        if (!discardCardId || !self.hand.includes(discardCardId)) {
          return; // 无效选择 → 阶段正常进行
        }
      }

      return skipPhaseInFrame(
        ctx.state,
        ownerId,
        phase,
        SKILL_NAME,
        { phase, mode, discardCardId: discardCardId ?? null },
        async () => {
          // 扣资源
          if (mode === 'discard' && discardCardId) {
            await applyAtom(ctx.state, {
              type: '弃置',
              player: ownerId,
              cardIds: [discardCardId],
              voluntary: true,
            });
          } else {
            // mode === '变':移除 1 枚变标记
            await removeBian(ctx.state, ownerId);
          }

          // 按阶段附加效果
          await runSkipPhaseBonus(ctx, ownerId, SKILL_NAME, phase);
        },
      );
    },
  );

  // ── 阶段开始 after hook:结束阶段手牌数检查,符合条件 +1 "变" ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '回合结束') return; // "结束阶段" = phase '回合结束'
    const st = ctx.state;
    const self = st.players[ownerId];
    if (!self?.alive) return;

    const current = self.hand.length;
    const history = getHistory(st, ownerId);
    // "均不相等" = 与历史所有项都不相等(空历史为真空真)
    if (history.includes(current)) return;
    await addBian(st, ownerId);
    appendHistory(st, ownerId, current);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: SKILL_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动界巧变?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
