// 突袭(张辽·阶段替换技):
//   官方:"摸牌阶段,你可以改为获得至多两名角色的各一张手牌。"
//
// 模式:摸牌阶段开始时(阶段开始 before hook)询问是否发动;
//   发动 → 选 1~2 名有手牌的其他角色(至多两名) → 各获得其一张随机手牌(不展示)
//     → 跳过默认摸牌;
//   不发动 / 无有效目标 → 走默认摸牌(摸2张)。
// 注:官方"角色"虽未明写"其他",但获得自己手牌无意义,实现按规则排除自己。
//
// 跳过默认摸牌的手法同兵粮寸断:applyAtom(阶段结束, 摸牌) 把阶段推进到出牌,
//   再 return {kind:'cancel'} 取消本次 阶段开始(摸牌),使 回合管理 的 after hook
//   (自动摸2张)不再执行。
//
// 本文件同时导出突袭族共享助手(registerTuxiRespond/tuxiAskSelectTargets/tuxiStealCards):
// 标版/界版的 respond action(trigger confirm + select 写 localVars)逐字相同,
// 选目标询问与偷牌循环同构,仅 localVars/requestType 键前缀不同('突袭' vs '界突袭',
// 同对局两版本共存时键空间隔离)——键前缀作参数。界突袭.ts 消费这些助手。
import type { FrontendAPI, GameView, GameState, HookResult, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction } from '../core/skill';
import { pickRandom } from '../util/rng';
import {
  askConfirm,
  requireRequestType,
  registerPhaseStartHook,
  defineConfirmAction,
} from '../util/skillRuntime';

const PREFIX = '突袭';
const TRIGGER_RT = `${PREFIX}/trigger`;
const TRIGGERED_KEY = `${PREFIX}/triggered`;

/**
 * 注册突袭族 respond action:处理 trigger(confirm)与 select(choosePlayer)两类询问,
 * 把回应写入 localVars(键由 prefix 派生)。标版/界版逐字相同,仅键前缀不同。
 */
export function registerTuxiRespond(
  state: GameState,
  skillId: string,
  ownerId: number,
  prefix: string,
): void {
  const TRIGGER_RT = `${prefix}/trigger`;
  const SELECT_RT = `${prefix}/select`;
  const TRIGGERED_KEY = `${prefix}/triggered`;
  const TARGETS_KEY = `${prefix}/targets`;
  registerAction(
    state,
    skillId,
    ownerId,
    'respond',
    (s): string | null =>
      requireRequestType(s, ownerId, [TRIGGER_RT, SELECT_RT], {
        mismatchError: '当前不是突袭回应',
      }).error,
    async (s, params) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === TRIGGER_RT) {
        s.localVars[TRIGGERED_KEY] = params.choice === true;
      } else if (rt === SELECT_RT) {
        // dispatch 入口已统一补齐 targets/target 两种形状(core/index.ts normalizeTargetShape),直接读 targets
        s.localVars[TARGETS_KEY] = (params.targets) ?? [];
      }
    },
  );
}

/**
 * 询问选择 1~max 名有手牌的其他角色(choosePlayer),返回经引擎侧有效性过滤的目标
 * (排除自己/死亡/无手牌);未选到有效目标返回 []。
 */
export async function tuxiAskSelectTargets(
  state: GameState,
  ownerId: number,
  opts: { prefix: string; title: string; max: number },
): Promise<number[]> {
  const SELECT_RT = `${opts.prefix}/select`;
  const TARGETS_KEY = `${opts.prefix}/targets`;
  delete state.localVars[TARGETS_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: SELECT_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: opts.title,
      min: 1,
      max: opts.max,
      filter: (view: GameView, target: number) =>
        target !== ownerId &&
        view.players[target]?.alive === true &&
        (view.players[target]?.handCount ?? 0) > 0,
    },
    timeout: 15,
  });
  const rawTargets = state.localVars[TARGETS_KEY] as number[] | undefined;
  return Array.isArray(rawTargets)
    ? rawTargets.filter(
        (t) =>
          t !== ownerId &&
          state.players[t]?.alive === true &&
          state.players[t].hand.length > 0,
      )
    : [];
}

/** 各获得 targets 每人一张随机手牌(不展示;死亡/无手牌者跳过)。 */
export async function tuxiStealCards(
  state: GameState,
  ownerId: number,
  targets: number[],
): Promise<void> {
  for (const target of targets) {
    const tp = state.players[target];
    if (!tp || !tp.alive || tp.hand.length === 0) continue;
    const cardId = pickRandom(state, tp.hand);
    if (cardId === undefined) continue;
    await applyAtom(state, { type: '获得', player: ownerId, cardId, from: target });
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '突袭',
    description: '摸牌阶段,你可以改为获得至多两名角色的各一张手牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理 trigger(confirm) 与 select(choosePlayer) 两类询问
  registerTuxiRespond(state, skill.id, ownerId, PREFIX);

  // 阶段开始(摸牌) before:询问是否突袭,发动则偷牌并跳过默认摸牌
  registerPhaseStartHook(
    state,
    skill.id,
    ownerId,
    '摸牌',
    async (ctx): Promise<HookResult | void> => {
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 发动条件:存在其他有手牌的存活角色
      const hasValidTarget = ctx.state.players.some(
        (p, i) => i !== ownerId && p.alive && p.hand.length > 0,
      );
      if (!hasValidTarget) return; // 无目标 → 默认摸牌

      // 询问是否发动突袭
      const triggered = await askConfirm(ctx.state, TRIGGER_RT, ownerId, {
        confirmedKey: TRIGGERED_KEY,
        title: '是否发动突袭?(放弃摸牌,获得至多两名角色各一张手牌)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
        defaultChoice: false,
        timeout: 10,
      });
      if (!triggered) return; // 不发动 → 默认摸牌

      // 选择 1~2 名有手牌的其他角色;未选到有效目标 → 回退默认摸牌(不 cancel)
      const targets = await tuxiAskSelectTargets(ctx.state, ownerId, {
        prefix: PREFIX,
        title: '突袭:选择至多两名角色(各获得一张手牌)',
        max: 2,
      });
      if (targets.length === 0) return;

      // 各获得一张随机手牌
      await tuxiStealCards(ctx.state, ownerId, targets);

      // 跳过默认摸牌:推进到出牌阶段,并 cancel 本次摸牌阶段开始
      await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '摸牌' });
      return { kind: 'cancel' };
    },
    { requireCurrentPlayer: true },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  defineConfirmAction(api, 'respond', { label: '突袭', title: '是否发动突袭?' });
}
