// 荐降(蒯越蒯良·魏·被动技,官方 hero/404 逐字):
//   "当你成为其他角色使用牌的目标后，你可以令手牌数最少的一名角色摸一张牌。"
//
// 机制(被动 after-hook on '成为目标后'):
//   - 触发条件:atom.target === ownerId 且 atom.source !== ownerId(其他角色使用牌)。
//     "成为...使用牌的目标"= 成为目标后 时机;source===self 时(自用桃/自用装备)不触发。
//   - 可选发动:confirm 询问。
//   - 效果:令手牌数最少的一名角色(含自己,"一名角色"未限定"其他")摸一张牌;
//     并列最少时 choosePlayer 询问,选定后该角色摸 1 张。
//
// 关键点:
//   - 一个 respond action 按 requestType 分支(confirm / choose),避免 actionKey 冲突。
//   - 时序:成目标后(荐降)先于 生效前/询问闪,故 confirm 在闪之前回应。
import type {
  FrontendAPI,
  GameView,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import type { SkillModule } from '../types';

const CONFIRM_RT = '荐降/confirm';
const CHOOSE_RT = '荐降/choose';
const CONFIRMED_KEY = '荐降/confirmed';
const TARGET_KEY = '荐降/target';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '荐降',
    description: '当你成为其他角色使用牌的目标后，你可以令手牌数最少的一名角色摸一张牌',
  };
}

/** 全场存活角色中手牌数最少者(含自己);返回候选座次数组 */
function minHandPlayers(state: GameState): number[] {
  let minCount = Infinity;
  const candidates: number[] = [];
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.hand.length < minCount) {
      minCount = p.hand.length;
      candidates.length = 0;
      candidates.push(p.index);
    } else if (p.hand.length === minCount) {
      candidates.push(p.index);
    }
  }
  return candidates;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // respond:处理 confirm / choose 两种询问
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt !== CONFIRM_RT && rt !== CHOOSE_RT) return '当前不是荐降询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === CHOOSE_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
      }
    },
  );

  // 成为目标后:自己成为其他角色使用牌的目标 → 可选令最少手牌者摸一张
  registerAfterHook(state, skill.id, ownerId, '成为目标后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    if (atom.source === ownerId) return; // 仅"其他角色"
    if (!ctx.state.players[ownerId]?.alive) return;

    // 询问是否发动
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '荐降:是否令手牌数最少的一名角色摸一张牌?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;
    delete ctx.state.localVars[CONFIRMED_KEY];

    // 找手牌数最少的存活角色(含自己)
    const candidates = minHandPlayers(ctx.state);
    if (candidates.length === 0) return;

    let target: number;
    if (candidates.length === 1) {
      target = candidates[0];
    } else {
      // 并列最少:询问选择
      delete ctx.state.localVars[TARGET_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CHOOSE_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '荐降:选择手牌数最少的一名角色(摸一张牌)',
          min: 1,
          max: 1,
          candidates,
          filter: (_view: GameView, t: number) => candidates.includes(t),
        },
        timeout: 15,
      });
      const chosen = ctx.state.localVars[TARGET_KEY] as number | undefined;
      delete ctx.state.localVars[TARGET_KEY];
      if (typeof chosen !== 'number') return;
      target = chosen;
    }

    if (ctx.state.players[target]?.alive) {
      await applyAtom(ctx.state, { type: '摸牌', player: target, count: 1 });
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '荐降',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '荐降',
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
