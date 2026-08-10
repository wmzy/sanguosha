// 奋激(界周泰·吴·触发技,OL hero/210 官方逐字):
//   "当一名角色的手牌被弃置或获得后,你可以失去1点体力令其摸两张牌。"
//
// 时机:弃置 after-hook + 获得 after-hook。
//   - 弃置 atom:一名角色的手牌被弃置后(atom.player 是被弃置者=目标);装备区弃置不触发。
//     主动弃牌(技能代价,atom.voluntary=true)不触发——如贯石斧/制衡/天香等代价弃牌。
//   - 获得 atom:一名角色的手牌被获得后(atom.from 是失去牌的人=目标);装备区被获得不触发。
//     注意获得 atom 的 player 是获得者;官方规则令失去手牌的人摸牌,故目标取 atom.from。
//     无 from(牌凭空产生,如摸牌)不触发。
//   弃置目标 = atom.player;获得目标 = atom.from。
//
// 流程:
//   1. 触发目标 = atom.player(弃置)或 atom.from(获得);任意角色,含周泰自己。
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
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook, registerBeforeHook } from '../core/skill';
import type { SkillModule } from '../types';

const CONFIRM_RT_PREFIX = '奋激/confirm';
/** before-hook 快照键:弃置 atom 中来自手牌的 cardId(apply 后手牌已清空,须在 apply 前快照) */
const DISCARD_HAND_KEY = '奋激/弃置手牌快照';
/** before-hook 快照键:获得 atom 中被获得的牌是否来自 from 手牌 */
const OBTAIN_HAND_KEY = '奋激/获得手牌快照';

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
      if (!rt?.startsWith(CONFIRM_RT_PREFIX)) return '当前不是奋激询问';
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
        title: `是否发动奋激?(失去1点体力令 ${st.players[target]?.name ?? `P${target}`} 摸两张牌)`,
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

  // ── 弃置 before-hook:快照被弃置牌中来自手牌的 cardId ──
  //   官方"当一名角色的手牌被弃置后"——仅手牌弃置触发,装备区弃置不触发。
  //   after-hook 时手牌已被清空,故在 before-hook(apply 前)快照手牌交集。
  const unloadDiscardBefore = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '弃置',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '弃置') return;
      if (typeof atom.player !== 'number') return;
      const player = ctx.state.players[atom.player];
      if (!player) return;
      ctx.state.localVars[DISCARD_HAND_KEY] = atom.cardIds.filter((id) =>
        player.hand.includes(id),
      );
    },
  );

  // ── 弃置 after-hook:一名角色的手牌被弃置后 ──
  const unloadDiscard = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '弃置',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '弃置') return;
      if (typeof atom.player !== 'number') return;
      // 主动弃牌(玩家自己选择弃牌作为技能代价)不触发奋激
      if ((atom as { voluntary?: boolean }).voluntary === true) {
        delete ctx.state.localVars[DISCARD_HAND_KEY];
        return;
      }
      // 仅手牌弃置触发(官方"当一名角色的手牌被弃置")
      const handCards = ctx.state.localVars[DISCARD_HAND_KEY] as string[] | undefined;
      delete ctx.state.localVars[DISCARD_HAND_KEY];
      if (!handCards || handCards.length === 0) return;
      await tryFenji(ctx, atom.player);
    },
  );

  // ── 获得 before-hook:快照被获得的牌是否来自手牌 ──
  //   官方"当一名角色的手牌被获得后"——仅手牌被获得触发,装备区被获得不触发。
  //   after-hook 时牌已转移,故在 before-hook(apply 前)快照。
  const unloadObtainBefore = registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '获得',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '获得') return;
      if (atom.from === undefined) return;
      const fromP = ctx.state.players[atom.from];
      ctx.state.localVars[OBTAIN_HAND_KEY] = fromP?.hand.includes(atom.cardId) ?? false;
    },
  );

  // ── 获得 after-hook:一名角色的手牌被获得后 ──
  // 官方规则:令失去手牌的人摸牌。获得 atom 的 player 是获得者,from 是被获得者(失去牌的人)。
  // 无 from(牌凭空产生,如摸牌)不触发——那是获得者凭空获得,无人失去牌。
  const unloadObtain = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '获得',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.type !== '获得') return;
      if (atom.from === undefined || typeof atom.from !== 'number') {
        delete ctx.state.localVars[OBTAIN_HAND_KEY];
        return;
      }
      const fromHand = ctx.state.localVars[OBTAIN_HAND_KEY] as boolean | undefined;
      delete ctx.state.localVars[OBTAIN_HAND_KEY];
      if (!fromHand) return; // 非手牌获得不触发(官方"当一名角色的手牌被获得")
      await tryFenji(ctx, atom.from);
    },
  );

  return () => {
    unloadAction();
    unloadDiscardBefore();
    unloadDiscard();
    unloadObtainBefore();
    unloadObtain();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 被动触发:无主动 action / 无主动 prompt,前端不渲染主动控件
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
