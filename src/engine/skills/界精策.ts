// 界精策(界郭淮·魏·被动技,OL 界限突破官方逐字):
//   "你每于回合内使用一种花色的手牌,本回合的手牌上限便+1;
//    每个出牌阶段结束时,你可以摸X张牌
//    (X为你本回合使用过牌的类型数)。"
//
// 与标版 郭淮·精策(未实现)的区别:仅文字润色("每个"出牌阶段 vs "出牌阶段"),
// 机制完全相同。标版未实现,故独立创建界版文件(避免与未来可能的标版共用一个文件
// 限制后续差异调整)。
//
// 实现(两段联动,共享"本回合使用过的牌"记录):
//   - 子句1(手牌上限加成,被动锁定):监听「移动牌」(自己手牌→处理区) 与「装备」
//     (自己手牌→装备区) 两个 atom,记录使用过的花色集合。每新增一种花色,把
//     state.turn.vars['手牌上限/bonus:<ownerId>'] 更新为不同花色数。
//     hand-limit.ts 的默认公式 = health + bonus,自动消费此 key(无需覆盖型 provider)。
//   - 子句2(出牌阶段结束触发):监听「阶段结束」(phase='出牌', player=自己),
//     询问是否发动 → 摸 X 张牌(X=本回合使用过的牌类型数;类型=基本牌/锦囊牌/装备牌)。
//
// "使用"的界定(参考克己.ts 的 移动牌 after-hook 思路):
//   - 移动牌: 自己手牌 → 处理区(杀/闪/桃/酒/锦囊等,主动使用或被动打出)
//   - 装备:   自己手牌 → 装备区(装备牌使用,经独立 atom,不走 移动牌)
//   两者共同覆盖"使用一种花色的手牌"的全部情形。
//
// 时机约束:
//   - 子句1 仅在 owner 自己回合内累积(state.currentPlayerIndex === ownerId):
//     "回合内"在描述中默认指自己回合(手牌上限也只在自己弃牌阶段被读取)。
//   - 子句2 自然只在 owner 自己的出牌阶段结束时触发(阶段结束 atom 的 player=ownerId)。
//
// 状态生命周期:
//   所有计数存在 turn.vars(key 含 `界精策/` 前缀,带玩家下标),由「回合结束」atom
//   统一清空 state.turn.vars = {},天然每回合重置,无需手动清理。
//
// 命名:文件名/loader key/character skill name 均为 '界精策'(避开标精策冲突);
//   内部 Skill.name = '精策'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界精策';
const DISPLAY_NAME = '精策';

/** turn.vars key 前缀:本回合 owner 使用过的花色集合(string[]);后缀 <ownerId>。 */
const USED_SUITS_PREFIX = `${SKILL_ID}/usedSuits:`;
/** turn.vars key 前缀:本回合 owner 使用过的牌类型集合(string[]);后缀 <ownerId>。 */
const USED_TYPES_PREFIX = `${SKILL_ID}/usedTypes:`;
/** localVars key:摸牌询问的确认结果(respond 写,before 读) */
const CONFIRMED_VAR = `${SKILL_ID}/confirmed`;
/** 请求回应 requestType */
const CONFIRM_REQUEST = `${SKILL_ID}/confirm`;

/** 三国杀的牌类型(基本牌/锦囊牌/装备牌) */
type CardType = '基本牌' | '锦囊牌' | '装备牌';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '本回合每使用一种新花色手牌,手牌上限+1;出牌阶段结束时,可以摸X张牌(X为本回合使用过牌的类型数)',
  };
}

// ─── 状态读写工具 ──────────────────────────────────────────────

function usedSuits(state: GameState, ownerId: number): string[] {
  const v = state.turn.vars[USED_SUITS_PREFIX + ownerId];
  return Array.isArray(v) ? (v as string[]) : [];
}

function usedTypes(state: GameState, ownerId: number): string[] {
  const v = state.turn.vars[USED_TYPES_PREFIX + ownerId];
  return Array.isArray(v) ? (v as string[]) : [];
}

/**
 * 记录一张牌的使用,更新花色与类型集合。
 * 返回是否有变化(用于决定是否需要刷新手牌上限加成)。
 */
function recordCardUse(state: GameState, ownerId: number, card: { suit?: string; type?: string } | undefined): boolean {
  if (!card?.suit || !card?.type) return false;
  let changed = false;

  // 花色集合
  const suits = usedSuits(state, ownerId);
  if (!suits.includes(card.suit)) {
    suits.push(card.suit);
    state.turn.vars[USED_SUITS_PREFIX + ownerId] = suits as unknown as Json;
    changed = true;
  }

  // 类型集合
  const types = usedTypes(state, ownerId);
  if (!types.includes(card.type)) {
    types.push(card.type as CardType);
    state.turn.vars[USED_TYPES_PREFIX + ownerId] = types as unknown as Json;
    changed = true;
  }

  return changed;
}

/**
 * 同步手牌上限加成到 turn.vars['手牌上限/bonus:<ownerId>']。
 * hand-limit.ts 的默认公式会消费此 key(health + bonus)。
 */
function syncHandLimitBonus(state: GameState, ownerId: number): void {
  const bonus = usedSuits(state, ownerId).length;
  if (bonus > 0) {
    state.turn.vars[`手牌上限/bonus:${ownerId}`] = bonus;
  } else {
    delete state.turn.vars[`手牌上限/bonus:${ownerId}`];
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:被询问「是否摸X张」时回应,写 localVars 标记结果 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st, _params) => {
      const slot = st.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const requestType = (slot.atom as unknown as Record<string, unknown>).requestType as string;
      if (requestType !== CONFIRM_REQUEST) return '当前不是精策确认';
      return null;
    },
    async (st, params) => {
      st.localVars[CONFIRMED_VAR] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 移动牌 after:自己手牌 → 处理区 = 使用了一张非装备牌 ──
  // 覆盖主动使用(杀.use 等)与被动打出(闪.respond、杀.respond 决斗等)
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    if (atom.from.zone !== '手牌' || atom.from.player !== ownerId) return;
    if (atom.to.zone !== '处理区') return;
    // 仅在自己回合内累积("回合内"指自己回合)
    if (ctx.state.currentPlayerIndex !== ownerId) return;
    const card = ctx.state.cardMap[atom.cardId];
    if (!recordCardUse(ctx.state, ownerId, card)) return;
    syncHandLimitBonus(ctx.state, ownerId);
  });

  // ── 装备 after:自己手牌 → 装备区 = 使用了一张装备牌 ──
  registerAfterHook(state, skill.id, ownerId, '装备', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    if (ctx.state.currentPlayerIndex !== ownerId) return;
    const card = ctx.state.cardMap[atom.cardId];
    if (!recordCardUse(ctx.state, ownerId, card)) return;
    syncHandLimitBonus(ctx.state, ownerId);
  });

  // ── 阶段结束 after:出牌阶段结束时询问摸 X 张 ──
  registerAfterHook(state, skill.id, ownerId, '阶段结束', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段结束') return;
    if (atom.phase !== '出牌') return;
    if (atom.player !== ownerId) return;
    if (!ctx.state.players[ownerId]?.alive) return;

    const X = usedTypes(ctx.state, ownerId).length;
    if (X === 0) return; // 未使用过任何牌,无可摸

    // 询问是否发动
    delete ctx.state.localVars[CONFIRMED_VAR];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_REQUEST,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `精策:是否摸 ${X} 张牌?(本回合已使用 ${X} 种类型的牌)`,
        confirmLabel: '摸牌',
        cancelLabel: '不摸',
      },
      defaultChoice: false,
      timeout: 15,
    });
    // 玩家选不摸 / 超时(defaultChoice=false) → 跳过
    if (!ctx.state.localVars[CONFIRMED_VAR]) return;

    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: X });
  });

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 被动技:无主动 action / 无询问 prompt 由前端固定控件渲染,前端不渲染交互控件。
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
