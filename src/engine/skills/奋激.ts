// 奋激(界周泰·吴·触发技,OL hero/210 官方逐字):
//   "当一名角色的手牌被弃置或获得后,你可以失去1点体力令其摸两张牌。"
//
// 时机:弃置 after-hook + 获得 after-hook。
//   - 弃置 atom:一名角色的手牌/装备被弃置后(atom.player 是被弃置者)。
//   - 获得 atom:一名角色获得一张牌后(atom.player 是获得者)。
//   两个 hook 都以 atom.player 作为"被弃置/获得的角色的座次"——即奋激目标。
//
// 流程:
//   1. 触发目标 = atom.player(任意角色,含周泰自己)。
//   2. 周泰本人被询问是否发动(requestType 含目标座次,以隔离多目标并行触发)。
//   3. 确认发动 → applyAtom(失去体力, 周泰, 1) → 若周泰存活则 applyAtom(摸牌, 目标, 2)。
//      周泰失去体力可能进入濒死(由系统规则 runDyingFlow 处理;不屈可救)。
//      若周泰因此死亡,后续摸牌不执行(目标无收益)。
//
// 关键点:
//   - 任意角色触发(含自己)——"一名角色"无势力/敌我限制。
//   - 一次性弃置/获得多张牌 → 单个 atom → 单次询问,不重复触发。
//   - 多个弃置/获得 atom 串行触发,各自独立询问。
//   - 触发后立即询问(在 after-hook 内同步 await),按 atom 顺序处理。
//
// 防递归:本技能只触发 弃置/获得,自身"失去体力/摸牌"不触发本技能。
import type {
  AtomAfterContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const CONFIRM_RT_PREFIX = '奋激/confirm';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '奋激',
    description: '当一名角色的手牌被弃置或获得后,你可以失去1点体力令其摸两张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:周泰本人回应是否发动奋激 ──
  // 询问 target=ownerId(周泰本人),pending slot 落在 ownerId 座次。
  const unloadAction = registerAction(
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
      if (!rt || !rt.startsWith(CONFIRM_RT_PREFIX)) return '当前不是奋激询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType ?? '';
      if (rt.startsWith(CONFIRM_RT_PREFIX)) {
        st.localVars[rt] = params.choice === true || params.confirmed === true;
      }
    },
  );

  // 触发目标 = atom.player;询问周泰是否失去1点体力令其摸2张牌
  async function tryFenji(ctx: AtomAfterContext, target: number): Promise<void> {
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;
    if (!st.players[target]?.alive) return;

    const rt = `${CONFIRM_RT_PREFIX}/${target}`;
    delete st.localVars[rt];
    await applyAtom(st, {
      type: '请求回应',
      requestType: rt,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `是否发动奋激?(失去1点体力令 P${target} 摸两张牌)`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 10,
    });
    const confirmed = st.localVars[rt] as boolean | undefined;
    delete st.localVars[rt];
    if (!confirmed) return;

    // 失去1点体力(可能进入濒死;不屈可救)
    await applyAtom(st, { type: '失去体力', target: ownerId, amount: 1 });
    // 周泰存活才令目标摸牌(若周泰失血致死,目标无收益)
    if (!st.players[ownerId]?.alive) return;
    if (st.players[target]?.alive) {
      await applyAtom(st, { type: '摸牌', player: target, count: 2 });
    }
  }

  // ── 弃置 after-hook:一名角色的手牌/装备被弃置后 ──
  const unloadDiscard = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '弃置',
    async (ctx: AtomAfterContext) => {
      const atom = ctx.atom as { type?: string; player?: number };
      if (atom.type !== '弃置') return;
      if (typeof atom.player !== 'number') return;
      await tryFenji(ctx, atom.player);
    },
  );

  // ── 获得 after-hook:一名角色获得一张牌后 ──
  const unloadObtain = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '获得',
    async (ctx: AtomAfterContext) => {
      const atom = ctx.atom as { type?: string; player?: number };
      if (atom.type !== '获得') return;
      if (typeof atom.player !== 'number') return;
      await tryFenji(ctx, atom.player);
    },
  );

  return () => {
    unloadAction();
    unloadDiscard();
    unloadObtain();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 被动触发:无主动 action / 无主动 prompt,前端不渲染主动控件
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
