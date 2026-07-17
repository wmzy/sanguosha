// 博图(界吕蒙·吴·一般技,OL hero/306 现行版 2020 新增):
//   "每轮限X次(X为存活角色数且至多为3),回合结束时,若本回合置入弃牌堆的牌中
//    包含四种花色,你可以执行一个额外的回合。"
//
// 机制:
//   1. 花色追踪:回合开始 after-hook 记录弃牌堆基线长度 turn.vars['博图/base']。
//      回合结束 before-hook 扫描 discardPile.slice(base),检查是否含 ♠♥♣♦ 四花色。
//      (用快照而非逐 atom hook:能覆盖所有置入弃牌堆的路径——弃置/拼点/移动牌/判定,
//       且基线随「回合结束」atom 自动随 turn.vars 清空重置。)
//   2. 每轮限X次:player.vars['博图/lastRound'] + ['博图/count']。
//      轮次变化时重置 count;X = min(存活角色数, 3)。
//   3. 额外回合:参考 界凿险/放权——回合结束 before-hook:cancel 正常回合结束 →
//      手动 clearPerTurnState(否则 apply 不执行,状态残留)→ 亲自启动 ownerId 额外回合。
//      before 先于 回合管理 after-hook(findNextAlive),cancel 后下家不启动。
//      额外回合结束:count 已 +1,达 X 或不满足花色 → 不再 cancel → 正常推进座次。
//
// 关键点:
//   - 主动询问:满足条件时询问吕蒙是否执行额外回合;确认才 cancel+启动。
//   - 死亡/不满足条件 → 放行正常回合结束(不 cancel)。
//   - clearPerTurnState 复刻「回合结束」atom 的 per-turn 清理(cancel 后 apply 不执行)。
//   - 「置入弃牌堆」=本回合新进弃牌堆的牌,含使用/打出/弃置/拼点/被拆等所有路径。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook, type SkillModule } from '../skill';

const BASE_VAR = '博图/base'; // turn.vars:本回合弃牌堆基线长度
const LAST_ROUND_KEY = '博图/lastRound'; // player.vars:计数所在轮次
const COUNT_KEY = '博图/count'; // player.vars:本轮已发动次数
const CONFIRM_RT = '博图/confirm';
const CONFIRMED_KEY = '博图/confirmed';

/** 复刻「回合结束」atom 的 per-turn 清理(cancel 回合结束后 atom.apply 不执行,需手动清理)。
 *  与 回合结束.ts apply 保持一致:清空 turn.vars、清所有玩家 duration='turn' 标记、
 *  清 /usedThisTurn|/healed|/givenCount|/givenTargets vars。 */
function clearPerTurnState(state: GameState): void {
  state.turn.vars = {};
  for (const p of state.players) {
    p.marks = p.marks.filter((m) => m.duration !== 'turn');
    p.vars = Object.fromEntries(
      Object.entries(p.vars).filter(
        ([k]) =>
          !k.endsWith('/usedThisTurn') &&
          !k.endsWith('/healed') &&
          !k.endsWith('/givenCount') &&
          !k.endsWith('/givenTargets'),
      ),
    );
  }
}

/** 亲自启动 player 的一个完整回合:回合开始 → 准备阶段开始 → 准备阶段结束。
 *  回合管理的阶段推进 after-hook 据此自动走完该玩家的判定/摸牌/出牌/弃牌/回合结束。 */
async function startTurn(state: GameState, player: number): Promise<void> {
  await applyAtom(state, { type: '回合开始', player });
  await applyAtom(state, { type: '阶段开始', player, phase: '准备' });
  await applyAtom(state, { type: '阶段结束', player, phase: '准备' });
}

/** 存活角色数 */
function aliveCount(state: GameState): number {
  return state.players.filter((p) => p.alive).length;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '博图',
    description:
      '每轮限X次(X为存活角色数至多3),回合结束时若本回合弃牌堆含四种花色,可执行一个额外回合',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:吕蒙确认是否执行额外回合 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== CONFIRM_RT) return '当前不是博图确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 回合开始 after-hook:记录本回合弃牌堆基线长度 ──
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number };
    if (atom.type !== '回合开始') return;
    if (atom.player !== ownerId) return;
    ctx.state.turn.vars[BASE_VAR] = ctx.state.zones.discardPile.length;
  });

  // ── 回合结束 before-hook:博图主逻辑(额外回合)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '回合结束',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number };
      if (atom.type !== '回合结束') return;
      if (atom.player !== ownerId) return;
      const st = ctx.state;
      const self = st.players[ownerId];
      if (!self?.alive) return; // 死亡 → 放行正常回合结束

      // 每轮计数:轮次变化则重置
      const round = st.turn.round;
      if (self.vars[LAST_ROUND_KEY] !== round) {
        self.vars[LAST_ROUND_KEY] = round;
        self.vars[COUNT_KEY] = 0;
      }
      const x = Math.min(aliveCount(st), 3);
      const used = (self.vars[COUNT_KEY] as number | undefined) ?? 0;
      if (used >= x) return; // 达本轮上限 → 放行

      // 花色检查:本回合新进弃牌堆的牌是否含四花色
      const base = st.turn.vars[BASE_VAR] as number | undefined;
      if (typeof base !== 'number') return;
      // 重洗可能令弃牌堆变短;此时基线失效,保守视为不满足(本回合不再发动)
      if (st.zones.discardPile.length < base) return;
      const newCardIds = st.zones.discardPile.slice(base);
      const suits = new Set(
        newCardIds
          .map((id) => st.cardMap[id]?.suit)
          .filter((s): s is '♠' | '♥' | '♣' | '♦' => s === '♠' || s === '♥' || s === '♣' || s === '♦'),
      );
      if (!(suits.has('♠') && suits.has('♥') && suits.has('♣') && suits.has('♦'))) return;

      // 询问是否执行额外回合
      delete st.localVars[CONFIRMED_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '博图:本回合弃牌堆已含四种花色,是否执行一个额外回合?',
          description: `每轮限 ${x} 次(已用 ${used} 次)`,
          confirmLabel: '执行额外回合',
          cancelLabel: '不执行',
        },
        defaultChoice: false,
        timeout: 20,
      });
      const confirmed = st.localVars[CONFIRMED_KEY] as boolean | undefined;
      delete st.localVars[CONFIRMED_KEY];
      if (!confirmed) return; // 不发动 → 放行正常回合结束

      // 计数 +1(永久 vars,不被 clearPerTurnState 清理)
      st.players[ownerId].vars[COUNT_KEY] = used + 1;

      // cancel 回合结束 → 手动清理 per-turn 状态 → 亲自启动额外回合
      clearPerTurnState(st);
      st.currentPlayerIndex = ownerId;
      await startTurn(st, ownerId);

      return { kind: 'cancel' };
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 被动触发,无主动 action
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
