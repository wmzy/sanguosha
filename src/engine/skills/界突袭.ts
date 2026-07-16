// 界突袭(界张辽·阶段替换技):摸牌阶段,你可以选择一至两项中的一项执行:
//   1.放弃摸牌,改为获得至多两名其他角色的各一张手牌(获得的牌随机,不展示);
//   2.令一名其他角色摸一张牌,然后你摸一张牌。
//
// 与标版突袭的差异:标版只有选项1(放弃摸牌偷牌);界版新增选项2(令其摸牌+自摸一张)
//   作为偷牌的替代方案。两项只能择一执行(FAQ:只能选择一至两项中的一项)。
//   两个选项均替换默认摸牌(摸2张)——选项1放弃摸牌改为偷牌,选项2以"其摸1+你摸1"
//   替代默认摸牌。
//
// 模式:摸牌阶段开始时(阶段开始 before hook)询问是否发动;
//   发动 → 选择选项1或选项2 → 执行对应效果 → 跳过默认摸牌;
//   不发动 / 无有效目标 / 未选到有效目标 → 走默认摸牌(摸2张)。
//
// 跳过默认摸牌的手法同兵粮寸断:applyAtom(阶段结束, 摸牌) 把阶段推进到出牌,
//   再 return {kind:'cancel'} 取消本次 阶段开始(摸牌),使 回合管理 的 after hook
//   (自动摸2张)不再执行。
//
// 内部标签/localVars/requestType 键名保持原前缀 '突袭/xxx'(不改为 '界突袭/xxx')。
import type {
  AtomBeforeContext,
  FrontendAPI,
  GameView,
  GameState,
  HookResult,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';

const TRIGGER_RT = '突袭/trigger';
const OPTION_RT = '突袭/option';
const SELECT_RT = '突袭/select';
const SELECT_ONE_RT = '突袭/selectOne';
const TRIGGERED_KEY = '突袭/triggered';
const OPTION_KEY = '突袭/optionChoice';
const TARGETS_KEY = '突袭/targets';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界突袭',
    description: '摸牌阶段择一:放弃摸牌获得至多两名角色各一张手牌,或令一名角色摸牌后你摸一张',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // respond:处理 trigger/option/select/selectOne 四类询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (
        rt !== TRIGGER_RT &&
        rt !== OPTION_RT &&
        rt !== SELECT_RT &&
        rt !== SELECT_ONE_RT
      ) {
        return '当前不是突袭回应';
      }
      return null;
    },
    async (s, params) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
      if (rt === TRIGGER_RT) {
        s.localVars[TRIGGERED_KEY] = params.choice === true;
      } else if (rt === OPTION_RT) {
        // choice=true → 选项1(偷牌);choice=false/缺省 → 选项2(给牌+自摸)
        s.localVars[OPTION_KEY] = params.choice === true ? 1 : 2;
      } else if (rt === SELECT_RT) {
        // 兼容 targets(数组)与 target(单数)
        const targets = (params.targets as number[] | undefined) ??
          (typeof params.target === 'number' ? [params.target] : undefined);
        s.localVars[TARGETS_KEY] = targets ?? [];
      } else if (rt === SELECT_ONE_RT) {
        const target =
          typeof params.target === 'number'
            ? params.target
            : Array.isArray(params.targets)
              ? (params.targets[0] as number | undefined)
              : undefined;
        s.localVars[TARGETS_KEY] = target !== undefined ? [target] : [];
      }
    },
  );

  // 阶段开始(摸牌) before:询问是否突袭,发动则执行选项1或2并跳过默认摸牌
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '摸牌') return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // 发动条件:存在其他存活角色(选项2 至少需要一个其他角色)
      const hasOtherAlive = ctx.state.players.some(
        (p, i) => i !== ownerId && p.alive,
      );
      if (!hasOtherAlive) return; // 无其他角色 → 默认摸牌

      // 询问是否发动突袭
      delete ctx.state.localVars[TRIGGERED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: TRIGGER_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动突袭?(摸牌阶段择一执行)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars[TRIGGERED_KEY] !== true) return; // 不发动 → 默认摸牌

      // 选项1 可用性:存在有手牌的其他角色(选项2 只需其他存活角色,已由 hasOtherAlive 保证)
      const hasStealTarget = ctx.state.players.some(
        (p, i) => i !== ownerId && p.alive && p.hand.length > 0,
      );

      let option: 1 | 2;
      if (!hasStealTarget) {
        // 无偷牌目标 → 只能选选项2
        option = 2;
      } else {
        // 选择选项1(偷牌)或选项2(给牌+自摸)
        delete ctx.state.localVars[OPTION_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: OPTION_RT,
          target: ownerId,
          prompt: {
            type: 'confirm',
            title:
              '突袭:选择一项——1.获得至多两名其他角色各一张手牌;2.令一名其他角色摸一张牌,然后你摸一张牌',
            confirmLabel: '选项1·获得手牌',
            cancelLabel: '选项2·令其摸牌',
          },
          defaultChoice: false,
          timeout: 15,
        });
        option = ctx.state.localVars[OPTION_KEY] === 1 ? 1 : 2;
      }

      if (option === 1) {
        // ── 选项1:放弃摸牌,获得至多两名其他角色各一张手牌(与标版一致)──
        delete ctx.state.localVars[TARGETS_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: SELECT_RT,
          target: ownerId,
          prompt: {
            type: 'choosePlayer',
            title: '突袭:选择至多两名角色(各获得一张手牌)',
            min: 1,
            max: 2,
            filter: (view: GameView, target: number) =>
              target !== ownerId &&
              view.players[target]?.alive === true &&
              (view.players[target]?.handCount ?? 0) > 0,
          },
          timeout: 15,
        });

        const rawTargets = ctx.state.localVars[TARGETS_KEY] as number[] | undefined;
        const targets = Array.isArray(rawTargets)
          ? rawTargets.filter(
              (t) =>
                t !== ownerId &&
                ctx.state.players[t]?.alive === true &&
                ctx.state.players[t].hand.length > 0,
            )
          : [];

        // 未选到有效目标 → 回退默认摸牌(不 cancel)
        if (targets.length === 0) return;

        // 各获得一张随机手牌
        for (const target of targets) {
          const tp = ctx.state.players[target];
          if (!tp || !tp.alive || tp.hand.length === 0) continue;
          const idx = Math.floor(Math.random() * tp.hand.length);
          const cardId = tp.hand[idx];
          await applyAtom(ctx.state, { type: '获得', player: ownerId, cardId, from: target });
        }
      } else {
        // ── 选项2:令一名其他角色摸一张牌,然后你摸一张牌 ──
        delete ctx.state.localVars[TARGETS_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: SELECT_ONE_RT,
          target: ownerId,
          prompt: {
            type: 'choosePlayer',
            title: '突袭:选择一名其他角色(其摸一张牌,然后你摸一张牌)',
            min: 1,
            max: 1,
            filter: (view: GameView, target: number) =>
              target !== ownerId && view.players[target]?.alive === true,
          },
          timeout: 15,
        });

        const rawTargets = ctx.state.localVars[TARGETS_KEY] as number[] | undefined;
        const target = Array.isArray(rawTargets) ? rawTargets[0] : undefined;
        // 未选到有效目标 → 回退默认摸牌(不 cancel)
        if (
          target === undefined ||
          target === ownerId ||
          !ctx.state.players[target]?.alive
        ) {
          return;
        }

        // 令目标摸一张牌,然后自己摸一张牌(顺序:目标先,自己后)
        await applyAtom(ctx.state, { type: '摸牌', player: target, count: 1 });
        await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
      }

      // 跳过默认摸牌:推进到出牌阶段,并 cancel 本次摸牌阶段开始
      await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '摸牌' });
      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界突袭',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动突袭?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
