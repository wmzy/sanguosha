// 志继(姜维·觉醒技):准备阶段,若你没有手牌,你须回复1点体力或摸两张牌,
// 然后减1点体力上限,并永久获得技能"观星"。
//
// 分析(步骤1):
//   类型:觉醒技 | 时机:准备阶段(「阶段开始」atom,phase='准备' 的 after-hook)
//   触发条件:ownerId 无手牌 + 未觉醒过(player.vars['志继/awakened'])
//   流程(强制二选一,然后减上限 + 加技能):
//     1. 请求回应(二选一:回复1点体力 / 摸两张牌)— 强制选择
//     2a. 选回复 → 回复体力(target=owner, amount=1,不超过上限;满血跳过)
//     2b. 选摸牌 → 摸牌(player=owner, count=2)
//     3. 设上限(player=owner, amount=maxHealth-1)— 减1点体力上限
//     4. 添加技能(player=owner, skillId='观星')
//   觉醒标记:player.vars['志继/awakened'](后缀不含 usedThisTurn,不被「回合结束」清理)
//
//   钩子:「阶段开始」(phase='准备')after-hook(atom.player===ownerId)→ 条件满足 → 二选一 → 执行。
//
// 本文件同时导出 createZhijiSkill 工厂(志继族共享实现),界志继 复用之,
// 仅注入 描述/询问 requestType/触发阶段 差异参数(觉醒标记与选择键共享
// '志继/awakened'、'志继/choice'——同一角色只会拥有一版志继)。
import type { FrontendAPI, GameState, Skill, SkillModule } from '../types';
import { applyAtom } from '../core/apply';
import { registerAfterHook } from '../core/skill';
import { isAwakened, markAwakened } from '../rules/vars-keys';
import { defineConfirmAction, registerChoiceRespond } from '../util/skillRuntime';

const CHOICE_KEY = '志继/choice';
const AWAKENED_KEY = '志继/awakened';

/** 志继族(觉醒技)差异参数 */
export interface ZhijiOptions {
  description: string;
  /** 二选一询问的 requestType(标 '志继/choose' / 界 '界志继/choose',键空间隔离) */
  chooseRt: string;
  /** 可触发阶段(标版仅 '准备';界版为 '准备' 与 '回合结束'——引擎"结束阶段"=phase='回合结束') */
  triggerPhases: readonly string[];
}

/** 志继觉醒主逻辑(标/界逐字相同):觉醒标记防重入 → 强制二选一 → 减1体力上限 → 获得"观星"。 */
async function awakenZhiji(state: GameState, ownerId: number, chooseRt: string): Promise<void> {
  // 觉醒技:整局一次
  if (isAwakened(state.players[ownerId]?.vars, AWAKENED_KEY)) return;
  const self = state.players[ownerId];
  if (!self?.alive) return;
  // 触发条件:无手牌
  if (self.hand.length > 0) return;

  // 标记已觉醒(在读条件后立即设,防重入)
  markAwakened(state, ownerId, AWAKENED_KEY);

  // 1. 二选一(强制)
  delete state.localVars[CHOICE_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: chooseRt,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '志继:摸两张牌,还是回复1点体力?',
      confirmLabel: '摸两张牌',
      cancelLabel: '回复1点体力',
    },
    defaultChoice: false,
    timeout: 30,
  });
  const choice = state.localVars[CHOICE_KEY] as string | undefined;

  // 2. 执行选择
  if (choice === 'draw') {
    await applyAtom(state, { type: '摸牌', player: ownerId, count: 2 });
  } else {
    // 回复1点(不超过上限;已满血则跳过)
    const cur = state.players[ownerId].health;
    const max = state.players[ownerId].maxHealth;
    const amount = Math.min(1, Math.max(0, max - cur));
    if (amount > 0) {
      await applyAtom(state, { type: '回复体力', target: ownerId, amount });
    }
  }

  // 3. 减1点体力上限(设上限 amount = maxHealth - 1;减至0则角色死亡)
  const newMax = state.players[ownerId].maxHealth - 1;
  await applyAtom(state, { type: '设上限', player: ownerId, amount: newMax });

  // 4. 永久获得"观星"
  await applyAtom(state, { type: '添加技能', player: ownerId, skillId: '观星' });
}

/** 志继族共享实现:标版志继与界志继仅 描述/询问键/触发阶段 不同,觉醒流程逐字一致。 */
export function createZhijiSkill(opts: ZhijiOptions) {
  return {
    createSkill(id: string, ownerId: number): Skill {
      return {
        id,
        ownerId,
        name: '志继',
        description: opts.description,
      };
    },

    onInit(skill: Skill, state: GameState): (() => void) | undefined {
      const ownerId = skill.ownerId;

      // ── respond:姜维二选一(摸两张牌 / 回复1点体力)──
      // choice=true → 摸两张牌;choice=false → 回复1点体力
      registerChoiceRespond(state, skill.id, ownerId, opts.chooseRt, CHOICE_KEY, 'draw', 'heal', {
        mismatchError: '当前不是志继选择',
      });

      // ── 阶段开始 after-hook:志继主逻辑(触发阶段由 opts.triggerPhases 决定)──
      // 防重入:AWAKENED_KEY 在 awakenZhiji 入口即设,准备阶段触发后
      // 即使结束阶段无手牌也不会再触发(界版两时机共用同一标记)。
      registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
        const atom = ctx.atom;
        if (atom.type !== '阶段开始') return;
        if (!opts.triggerPhases.includes(atom.phase)) return;
        if (atom.player !== ownerId) return;
        await awakenZhiji(ctx.state, ownerId, opts.chooseRt);
      });

      return () => {};
    },

    onMount(_skill: Skill, api: FrontendAPI): (() => void) | undefined {
      defineConfirmAction(api, 'respond', {
        label: '志继',
        title: '志继:摸两张牌,还是回复1点体力?',
        confirmLabel: '摸两张牌',
        cancelLabel: '回复1点体力',
      });
      return undefined;
    },
  };
}

const OPTIONS: ZhijiOptions = {
  description: '觉醒技:准备阶段且无手牌时,回复1体力或摸2牌,减1体力上限并永久获得"观星"',
  chooseRt: '志继/choose',
  triggerPhases: ['准备'],
};

export const { createSkill, onInit, onMount } = createZhijiSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
