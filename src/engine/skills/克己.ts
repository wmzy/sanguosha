// 克己(吕蒙·吴国):出牌阶段结束时,若你本回合未使用或打出过【杀】,
//   你可以跳过弃牌阶段(即此阶段不弃牌)。
//
// 实现:
//   1) 移动牌 after hook:监听【杀】从自己手牌进入处理区。
//      这同时覆盖「使用」(杀.use 主动出杀)与「打出」(杀.respond 应对决斗/南蛮入侵等)
//      两种情形——两者都会把杀牌从手牌移入处理区。
//      命中后置 turn.vars['克己/playedSlash'] = true;该 vars 随「回合结束」atom 自动清空,
//      天然每回合重置。
//   2) 阶段开始 before hook:弃牌阶段开始时,若本回合未出杀,询问是否发动克己;
//      确认 → 触发「阶段结束」(弃牌) 推进到回合结束,并 cancel 当前「阶段开始」(弃牌)。
//      回合管理的 阶段结束 after hook 检测到 state.phase 已偏离 '弃牌' → 跳过弃牌 pending 创建。
//      (与兵粮寸断/乐不思蜀「跳过阶段」同构,差异:克己条件由自身检测,非延时锦囊判定标签。)
//   3) respond action:玩家确认/取消 → 写 localVars['克己/confirmed']。
//
// 本文件同时导出 createKejiSkill 工厂(克己族共享实现),界克己 复用之,仅注入
// 键前缀/文案/出牌阶段限定守卫差异(键空间按技能 id 隔离;界版严格按官方"出牌阶段内"判定)。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Skill,
  SkillModule,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAfterHook } from '../core/skill';
import { askConfirm, defineConfirmAction, registerConfirmRespond, registerPhaseStartHook } from '../util/skillRuntime';

/** 克己族差异参数(标/界共享实现,差异全部显式注入)。 */
export interface KejiOptions {
  /** 技能 id(= vars/requestType 键空间前缀;标 '克己' / 界 '界克己') */
  skillId: string;
  /** 玩家可见技能名(标/界各自的 id) */
  displayName: string;
  description: string;
  /** 出牌阶段限定:界版严格按官方"出牌阶段内"判定(仅自己回合「出牌」阶段出杀才计数),
   *  标版整回合任一阶段出杀均计数。 */
  onlyPlayPhase: boolean;
  /** askConfirm 询问标题 */
  confirmTitle: string;
}

/** 克己族共享实现:标克己与界克己仅 键前缀/文案/出牌阶段守卫 不同,
 *  hook 注册顺序与 atom 序列逐字一致。 */
export function createKejiSkill(opts: KejiOptions) {
  // 键名遵循 `${SKILL_ID}/…` 局部技能名模板约定(turnUsage 投影 key 静态契约)。
  const SKILL_ID = opts.skillId;
  /** turn.vars key:本回合是否使用/打出过杀(移动牌 after 写,阶段开始 before 读)。
   *  随「回合结束」atom 的 state.turn.vars = {} 自动清空。 */
  const PLAYED_SLASH_VAR = `${SKILL_ID}/playedSlash`;
  /** localVars key:克己确认结果(respond 写,before 读) */
  const CONFIRMED_VAR = `${SKILL_ID}/confirmed`;
  /** 请求回应 requestType */
  const CONFIRM_REQUEST = `${SKILL_ID}/confirm`;

  function createSkill(id: string, ownerId: number): Skill {
    return {
      id,
      ownerId,
      name: opts.displayName,
      description: opts.description,
    };
  }

  function onInit(skill: Skill, state: GameState): () => void {
    const ownerId = skill.ownerId;

    // ── respond:被询问「是否发动克己」时回应,写 localVars 标记结果 ──
    registerConfirmRespond(state, skill.id, ownerId, CONFIRM_REQUEST, CONFIRMED_VAR, {
      mismatchError: `当前不是${opts.displayName}确认`,
    });

    // ── 移动牌 after hook:检测自己使用/打出的杀(手牌→处理区) ──
    registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
      const atom = ctx.atom;
      if (atom.from.zone !== '手牌' || atom.from.player !== ownerId) return;
      if (atom.to.zone !== '处理区') return;
      // 界版严格按官方"出牌阶段内"判定:仅在「出牌」阶段(自己回合)出杀才计数,
      // 出牌阶段外打出杀(如响应他人回合内的决斗/南蛮)不计入,不阻止克己;
      // 标版整回合任一阶段出杀均计数。
      // (他人回合内出杀本就不写入本玩家 vars——turn.vars 随其回合结束清空。)
      if (opts.onlyPlayPhase && ctx.state.phase !== '出牌') return;
      const card = ctx.state.cardMap[atom.cardId];
      if (card?.name === '杀') {
        ctx.state.turn.vars[PLAYED_SLASH_VAR] = true;
      }
    });

    // ── 阶段开始 before hook:弃牌阶段跳过 ──
    registerPhaseStartHook(state, skill.id, ownerId, '弃牌', async (ctx): Promise<HookResult | void> => {
      // 本回合使用或打出过杀 → 不满足发动条件
      if (ctx.state.turn.vars[PLAYED_SLASH_VAR]) return;

      // 询问是否发动克己(跳过弃牌阶段)
      // 玩家选不发动 / 超时(defaultChoice=false) → 不干预,正常进入弃牌阶段
      const confirmed = await askConfirm(ctx.state, CONFIRM_REQUEST, ownerId, {
        confirmedKey: CONFIRMED_VAR,
        title: opts.confirmTitle,
        confirmLabel: '跳过',
        cancelLabel: '不跳过',
        defaultChoice: false,
        timeout: 15,
      });
      if (!confirmed) return;

      // 跳过弃牌阶段:
      //   1) 触发「阶段结束」(弃牌) → 回合管理 after hook 把阶段推进到「回合结束」
      //   2) cancel 当前「阶段开始」(弃牌) —— state.phase 已是「回合结束」,
      //      回合管理 阶段结束 after hook 检测 phase !== '弃牌' → 不创建弃牌 pending
      await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '弃牌' });
      return { kind: 'cancel' };
    });

    return () => {};
  }

  function onMount(_skill: Skill, api: FrontendAPI): void {
    defineConfirmAction(api, 'respond', {
      label: opts.displayName,
      title: `${opts.displayName}:是否跳过弃牌阶段？`,
      confirmLabel: '跳过',
      cancelLabel: '不跳过',
    });
  }

  return { createSkill, onInit, onMount };
}

const OPTIONS: KejiOptions = {
  skillId: '克己',
  displayName: '克己',
  description: '出牌阶段结束时,若你本回合未使用或打出过【杀】,你可以跳过弃牌阶段',
  onlyPlayPhase: false,
  confirmTitle: '克己:本回合未出杀,是否跳过弃牌阶段?',
};

export const { createSkill, onInit, onMount } = createKejiSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
