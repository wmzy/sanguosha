// 遗礼(陆绩·吴·被动技,OL hero/402 风林火山官方逐字):
//   "出牌阶段开始时,你可以失去1点体力或移除1枚'橘',然后令一名其他角色获得1枚'橘'。"
//
// 触发时机:阶段开始(出牌) after-hook(player===ownerId)。
//   在 回合管理 创建出牌窗口之前执行(阶段开始 atom 的 after-hook 链内阻塞),
//   故遗礼的三段询问在出牌窗口出现前完成,玩家回复后正常进入出牌。
//
// 流程(可选发动):
//   1. confirm:是否发动遗礼?(false → 跳过)
//   2. cost:选择代价(chooseOption)—
//        a) 失去 1 点体力(失去体力 atom)
//        b) 移除 1 枚橘(需有橘)
//        若仅一种可用(无橘时只能失去体力),跳过此询问直接采用。
//   3. target:选择一名其他存活角色获得 1 枚橘(choosePlayer)。
//
// 橘标记读写复用 怀橘.ts 的 juCount/addJu/removeJu(跨技能共享协议)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import { addJu, juCount, removeJu } from './怀橘';
import type { SkillModule } from '../types';

const SKILL_ID = '遗礼';

const CONFIRM_RT = `${SKILL_ID}/confirm`;
const COST_RT = `${SKILL_ID}/cost`;
const TARGET_RT = `${SKILL_ID}/target`;

/** localVars key:玩家各步选择(respond 写,after-hook 读) */
const CONFIRM_KEY = `${SKILL_ID}/confirmed`;
const COST_KEY = `${SKILL_ID}/costChoice`;
const TARGET_KEY = `${SKILL_ID}/chosenTarget`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description:
      '出牌阶段开始时,你可以失去1点体力或移除1枚橘,然后令一名其他角色获得1枚橘',
  };
}

/** 当前 pending 的 requestType(类型安全读取) */
function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as unknown as { requestType?: string }).requestType;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond action:处理 confirm / cost / target 三种询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const rt = currentRequestType(st, ownerId);
      if (rt !== CONFIRM_RT && rt !== COST_RT && rt !== TARGET_RT) {
        return '当前不是遗礼询问';
      }
      if (rt === CONFIRM_RT) return null; // confirm:任意 choice 均可

      if (rt === COST_RT) {
        const opt = params.option as string | undefined;
        if (opt !== 'loseHp' && opt !== 'removeJu') return '请选择代价(失去体力/移除橘)';
        if (opt === 'removeJu' && juCount(st, ownerId) <= 0) return '你没有橘标记可移除';
        return null;
      }

      // target:需提供一名其他存活角色
      const tgt =
        (params.target as number | undefined) ??
        (params.targets as number[] | undefined)?.[0];
      if (typeof tgt !== 'number') return '请选择一名其他角色';
      if (tgt === ownerId) return '不能选择自己';
      if (!st.players[tgt]?.alive) return '目标已死亡';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const rt = currentRequestType(st, ownerId);
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === COST_RT) {
        st.localVars[COST_KEY] = params.option;
      } else if (rt === TARGET_RT) {
        const tgt =
          (params.target as number | undefined) ??
          (params.targets as number[] | undefined)?.[0];
        if (typeof tgt === 'number') st.localVars[TARGET_KEY] = tgt;
      }
    },
  );

  // ── 阶段开始(出牌) after-hook:遗礼主流程 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx): Promise<void> => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '出牌') return;
    if (atom.player !== ownerId) return;
    const st = ctx.state;
    const me = st.players[ownerId];
    if (!me?.alive) return;

    // 至少需要一名其他存活角色可给予橘;否则不触发
    const others = st.players.filter((p) => p.alive && p.index !== ownerId);
    if (others.length === 0) return;

    // 1. 询问是否发动
    delete st.localVars[CONFIRM_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动遗礼?(失去1点体力或移除1枚橘,令一名其他角色获得1枚橘)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 20,
    });
    if (!st.localVars[CONFIRM_KEY]) {
      delete st.localVars[CONFIRM_KEY];
      return; // 不发动
    }
    delete st.localVars[CONFIRM_KEY];

    // 2. 选择代价
    const hasJu = juCount(st, ownerId) > 0;
    let cost: 'loseHp' | 'removeJu';
    if (hasJu) {
      // 两种代价可选 → 询问
      delete st.localVars[COST_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: COST_RT,
        target: ownerId,
        prompt: {
          type: 'chooseOption',
          title: '遗礼:选择代价',
          options: [
            { value: 'loseHp', label: '失去 1 点体力' },
            { value: 'removeJu', label: '移除 1 枚橘' },
          ],
        },
        timeout: 20,
      });
      const picked = st.localVars[COST_KEY] as 'loseHp' | 'removeJu' | undefined;
      delete st.localVars[COST_KEY];
      cost = picked === 'removeJu' ? 'removeJu' : 'loseHp';
    } else {
      // 无橘 → 只能失去体力
      cost = 'loseHp';
    }

    // 3. 选择目标(其他存活角色)
    const candidates = st.players.filter((p) => p.alive && p.index !== ownerId);
    delete st.localVars[TARGET_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: TARGET_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '遗礼:选择一名其他角色获得 1 枚橘',
        min: 1,
        max: 1,
        candidates: candidates.map((p) => p.index),
      },
      timeout: 20,
    });
    let target = st.localVars[TARGET_KEY] as number | undefined;
    delete st.localVars[TARGET_KEY];
    // 超时未选 → 默认选第一个其他存活角色(不放弃给予义务)
    if (typeof target !== 'number' || !st.players[target]?.alive || target === ownerId) {
      target = candidates[0].index;
    }

    // 4. 执行代价 + 给予橘
    if (cost === 'loseHp') {
      await applyAtom(st, { type: '失去体力', target: ownerId, amount: 1 });
    } else {
      await removeJu(st, ownerId);
    }
    if (st.players[target]?.alive) {
      await addJu(st, target);
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 被动技:无主动 use action;询问由 respond action 处理
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
