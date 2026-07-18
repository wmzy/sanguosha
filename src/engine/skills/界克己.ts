// 界克己(界吕蒙·吴国·界限突破):
//   OL 官方(hero/306)逐字:
//   "若你未于本回合出牌阶段使用或打出过【杀】,你可以跳过弃牌阶段。"
//
// 与标克己区别:
//   - 标版实现把"本回合"当作整回合任一阶段出过杀即计数,导致在出牌阶段外打出杀
//     (如响应延时锦囊/决斗/南蛮等)也会阻止克己——比官方更严格。
//   - 界版严格按官方"出牌阶段内"判定:仅在「出牌」阶段(且为自己回合)使用/打出杀
//     才计数;出牌阶段外打出杀不阻止克己。
//   - 独立界版文件,不修改标 克己.ts。vars 键用 '界克己/' 前缀与标版隔离。
//
// 实现:
//   1) 移动牌 after hook:监听【杀】从自己手牌进入处理区,且仅在「出牌」阶段记录。
//      这同时覆盖「使用」(杀.use 主动出杀)与「打出」(杀.respond 应对决斗/南蛮入侵等)。
//      命中后置 turn.vars['界克己/playedSlash'] = true;该 vars 随「回合结束」atom 自动清空,
//      天然每回合重置。
//   2) 阶段开始 before hook:弃牌阶段开始时,若本回合出牌阶段未出杀,询问是否发动界克己;
//      确认 → 触发「阶段结束」(弃牌) 推进到回合结束,并 cancel 当前「阶段开始」(弃牌)。
//   3) respond action:玩家确认/取消 → 写 localVars['界克己/confirmed']。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
  ZoneLoc,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';

/** turn.vars key:本回合【出牌阶段】是否使用/打出过杀。
 *  随「回合结束」atom 的 state.turn.vars = {} 自动清空。 */
const PLAYED_SLASH_VAR = '界克己/playedSlash';
/** localVars key:界克己确认结果(respond 写,before 读) */
const CONFIRMED_VAR = '界克己/confirmed';
/** 请求回应 requestType */
const CONFIRM_REQUEST = '界克己/confirm';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界克己',
    description: '若你未于本回合出牌阶段使用或打出过【杀】,你可以跳过弃牌阶段',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:被询问「是否发动界克己」时回应,写 localVars 标记结果 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (state, _params) => {
      const slot = state.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (slot.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== CONFIRM_REQUEST) return '当前不是界克己确认';
      return null;
    },
    async (state, params) => {
      state.localVars[CONFIRMED_VAR] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 移动牌 after hook:检测自己在「出牌」阶段使用/打出的杀(手牌→处理区) ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { cardId: string; from: ZoneLoc; to: ZoneLoc };
    if (atom.from.zone !== '手牌' || atom.from.player !== ownerId) return;
    if (atom.to.zone !== '处理区') return;
    // 严格按官方"出牌阶段内"判定:仅在「出牌」阶段(自己回合)出杀才计数。
    // 出牌阶段外打出杀(如响应他人回合内的决斗/南蛮)不计入,不阻止克己。
    // (另一玩家回合内出杀本就不写入本玩家 vars——turn.vars 随其回合结束清空。)
    if (ctx.state.phase !== '出牌') return;
    const card = ctx.state.cardMap[atom.cardId];
    if (card?.name === '杀') {
      ctx.state.turn.vars[PLAYED_SLASH_VAR] = true;
    }
  });

  // ── 阶段开始 before hook:弃牌阶段跳过 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type: string; player: number; phase: string };
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '弃牌') return;
      // 本回合【出牌阶段】使用或打出过杀 → 不满足发动条件
      if (ctx.state.turn.vars[PLAYED_SLASH_VAR]) return;

      // 询问是否发动界克己(跳过弃牌阶段)
      delete ctx.state.localVars[CONFIRMED_VAR];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_REQUEST,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '界克己:本回合出牌阶段未出杀,是否跳过弃牌阶段?',
          confirmLabel: '跳过',
          cancelLabel: '不跳过',
        },
        defaultChoice: false,
        timeout: 15,
      });
      // 玩家选不发动 / 超时(defaultChoice=false) → 不干预,正常进入弃牌阶段
      if (!ctx.state.localVars[CONFIRMED_VAR]) return;

      // 跳过弃牌阶段:
      //   1) 触发「阶段结束」(弃牌) → 回合管理 after hook 把阶段推进到「回合结束」
      //   2) cancel 当前「阶段开始」(弃牌) —— state.phase 已是「回合结束」,
      //      回合管理 阶段结束 after hook 检测 phase !== '弃牌' → 不创建弃牌 pending
      await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '弃牌' });
      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界克己',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '界克己:是否跳过弃牌阶段？',
      confirmLabel: '跳过',
      cancelLabel: '不跳过',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
