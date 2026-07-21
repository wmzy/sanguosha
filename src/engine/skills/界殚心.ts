// 界殚心(界郭皇后·被动技,OL 界限突破官方逐字):
//   当你受到伤害后,你可摸 X 张牌,然后修改"矫诏"(X 为你修改"矫诏"的次数)。
//
// 界限突破(相对标殚心 郭皇后):
//   1. 标殚心:受伤后,可以摸一张牌或修改"矫诏"(二选一)。
//   2. 界殚心:受伤后,可摸 X 张牌并修改"矫诏"(二合一;X = 已修改"矫诏"的次数)。
//
// 实现要点:
//   - 修改次数累计: player.vars['界殚心/修改次数'](永久跨回合,死亡时随玩家状态消失)
//   - 造成伤害 after hook: target === ownerId + amount > 0 → 询问是否发动
//   - 玩家确认 → 摸 count 张牌(count = 当前修改次数)→ 修改次数 +1
//   - X = 修改次数(读取 BEFORE 本次修改),故首次受伤 X=0(摸 0 张,仅修改),后续累加
//   - "修改矫诏"效果本身未在文档中明确,本实现按文档逐字仅做计数(see 界矫诏.ts)
//
// 命名: 文件名/loader key/character skill name 均为 '界殚心'(避开标殚心冲突);
//   内部 Skill.name = '殚心'(OL 官方技能名,玩家可见)。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界殚心';
const DISPLAY_NAME = '殚心';

/** 请求回应类型:是否发动殚心 */
const CONFIRM_RT = `${SKILL_ID}/confirm`;
/** localVars key:玩家选择(布尔) */
const CONFIRMED_KEY = `${SKILL_ID}/confirmed`;
/** player.vars key:已修改"矫诏"的累计次数(number,跨回合永久) */
const MOD_COUNT_KEY = `${SKILL_ID}/修改次数`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description: '当你受到伤害后,你可摸X张牌,然后修改"矫诏"(X为你修改"矫诏"的次数)',
  };
}

/** 当前修改"矫诏"的累计次数(默认 0)。 */
function modCount(state: GameState, ownerId: number): number {
  const v = state.players[ownerId]?.vars[MOD_COUNT_KEY];
  return typeof v === 'number' ? v : 0;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:玩家在「殚心/confirm」询问下的选择(choice=true/false)
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as unknown as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不需要回应';
      if (atom.requestType !== CONFIRM_RT) return '当前不是殚心询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      st.localVars[CONFIRMED_KEY] = params.choice === true;
    },
  );

  // ── 造成伤害 after:受伤后询问是否发动殚心
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; amount?: number };
    if (atom.target !== ownerId) return;
    const amount = atom.amount ?? 0;
    if (amount <= 0) return;
    if (!ctx.state.players[ownerId]?.alive) return;

    // 询问是否发动(可选)
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '殚心:是否发动?(摸X张牌并修改"矫诏",X为已修改次数)',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });

    const confirmed = ctx.state.localVars[CONFIRMED_KEY] === true;
    delete ctx.state.localVars[CONFIRMED_KEY];
    if (!confirmed) return;

    // 摸 X 张牌(X = 当前修改次数,即修改前的次数)
    const x = modCount(ctx.state, ownerId);
    if (x > 0) {
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: x });
    }

    // 修改"矫诏":累计次数 +1
    const nextCount = x + 1;
    ctx.state.players[ownerId].vars[MOD_COUNT_KEY] = nextCount;
    await applyAtom(ctx.state, {
      type: '回合用量',
      player: ownerId,
      key: MOD_COUNT_KEY,
      value: nextCount,
    });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动殚心?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
