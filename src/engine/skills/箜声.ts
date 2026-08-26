// 箜声(周妃·吴·被动技):准备阶段,你可以将任意张牌置于你的武将牌上。
//   结束阶段,你获得"箜声"牌中的非装备牌,然后令一名角色使用剩余"箜声"牌并失去1点体力。
//
// 模式 A(被动触发·阶段技):两个 after-hook 都挂在「阶段开始」上,按 phase 分支:
//   - phase='准备':询问是否置牌 → 选牌 → 移出至暂存区(置于武将牌上,即移出游戏)。
//   - phase='回合结束':归还暂存牌(非装备牌获得到手牌)→ 若有装备牌,令一名角色使用之
//     (给予→装备,含旧装备替换+技能挂载)→ 该角色失去1点体力。
//
// 箜声牌存储:owner.vars['箜声/牌'](cardId 列表,引擎权威)。由 移出至暂存区 写入,
//   归还暂存牌 清空。良姻通过读取此 key 得到"箜声牌数"X。
//
// 关键点:
//   - 置牌用 移出至暂存区(source=target=owner,varsKey='箜声/牌'):这是引擎的
//     "移出游戏"通用机制,会触发良姻(挂在其 after-hook 上)。
//   - 结束阶段先用 归还暂存牌 把全部箜声牌取回手牌(=获得非装备牌);
//     再把其中的装备牌给予目标并装备之(=使用剩余牌)。
//   - 装备自带技能(以 card.name 为 skillId 且在技能声明注册表中)需手动 添加技能/
//     移除技能——直接 applyAtom(装备) 不会自动加载技能(与 直谏/界直言 一致)。
//   - 装备替换:目标同槽已有装备时,先 移除技能+卸下+弃置 旧装备,再装备新牌。
//   - 箜声牌每回合在结束阶段全部处理(非装备获得、装备使用),不跨回合持久。
//   - requestType 前缀必须等于技能 id('箜声'):前端 resolvePendingRespond 按前缀路由。
import type {
  EquipSlot,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import { hasSkillModule } from './registry';
import type { SkillModule } from '../types';

/** owner.vars key:箜声牌 cardId 列表(与良姻共享) */
const KONGSHENG_KEY = '箜声/牌';

const CONFIRM_RT = '箜声/confirm'; // 准备阶段:是否置牌
const SELECT_RT = '箜声/select'; // 准备阶段:选牌
const TARGET_RT = '箜声/target'; // 结束阶段:选使用装备的角色

const CONFIRMED_KEY = '箜声/confirmed';
const SELECT_KEY = '箜声/selected';
const TARGET_KEY = '箜声/target';

/** 读取 owner 的箜声牌列表 */
function kongshengCards(state: GameState, player: number): string[] {
  return (state.players[player].vars[KONGSHENG_KEY] as string[] | undefined) ?? [];
}

/** 装备牌 subtype → 装备栏位(与 装备 atom 的 inferSlot 一致) */
function slotOf(card: { subtype?: string } | undefined): EquipSlot | null {
  switch (card?.subtype) {
    case '武器':
      return '武器';
    case '防具':
      return '防具';
    case '进攻马':
      return '进攻马';
    case '防御马':
      return '防御马';
    case '宝物':
      return '宝物';
    default:
      return null;
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '箜声',
    description:
      '准备阶段,你可以将任意张牌置于你的武将牌上;结束阶段,你获得其中的非装备牌,然后令一名角色使用剩余牌并失去1点体力',
  };
}

/** 准备阶段:询问置牌 → 选牌 → 移出至暂存区(置于武将牌上)。 */
async function performKongshengPrepare(
  state: GameState,
  ownerId: number,
): Promise<void> {
  const self = state.players[ownerId];
  if (!self?.alive) return;
  if (self.hand.length === 0) return; // 无牌可置

  // 1) 是否发动
  delete state.localVars[CONFIRMED_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CONFIRM_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '是否发动箜声?(将任意张牌置于武将牌上)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
    defaultChoice: false,
    timeout: 15,
  });
  if (!state.localVars[CONFIRMED_KEY]) {
    delete state.localVars[CONFIRMED_KEY];
    return;
  }
  delete state.localVars[CONFIRMED_KEY];

  // 2) 选牌(任意张手牌)
  delete state.localVars[SELECT_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: SELECT_RT,
    target: ownerId,
    prompt: {
      type: 'useCard',
      title: '箜声:选择要置于武将牌上的牌',
      cardFilter: { filter: () => true, min: 1, max: self.hand.length },
    },
    timeout: 30,
  });
  const selected = state.localVars[SELECT_KEY] as string[] | undefined;
  delete state.localVars[SELECT_KEY];
  if (!selected || selected.length === 0) return;

  // 3) 置于武将牌上(移出游戏)——触发良姻(挂在其 after-hook)
  await applyAtom(state, {
    type: '移出至暂存区',
    source: ownerId,
    target: ownerId,
    cardIds: selected,
    varsKey: KONGSHENG_KEY,
  });
}

/** 结束阶段:获得非装备牌 → 令一名角色使用装备牌 → 该角色失去1点体力。 */
async function performKongshengEnd(
  state: GameState,
  ownerId: number,
): Promise<void> {
  if (!state.players[ownerId]?.alive) return;
  const cards = kongshengCards(state, ownerId);
  if (cards.length === 0) return;

  // 分类:装备牌(将被使用)/ 非装备牌(将被获得)
  const equipIds = cards.filter((id) => state.cardMap[id]?.type === '装备牌');

  // 获得全部箜声牌到手牌(归还暂存牌 = 获得非装备牌;装备牌稍后给予目标)
  // 归还触发"移入游戏"→ 良姻 after-hook,但良姻本回合已触发(准备阶段移出时),不再触发。
  await applyAtom(state, {
    type: '归还暂存牌',
    player: ownerId,
    varsKey: KONGSHENG_KEY,
  });

  if (equipIds.length === 0) return; // 无装备牌:非装备牌已获得,无需使用/失体力
  if (!state.players[ownerId]?.alive) return; // 极端:获得牌触发死亡

  // 选一名角色使用剩余(装备)牌
  delete state.localVars[TARGET_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: TARGET_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: '箜声:令一名角色使用剩余(装备)牌并失去1点体力',
      min: 1,
      max: 1,
      filter: (_view, t) => state.players[t]?.alive === true,
    },
    timeout: 30,
  });
  const target = state.localVars[TARGET_KEY] as number | undefined;
  delete state.localVars[TARGET_KEY];
  if (typeof target !== 'number' || !state.players[target]?.alive) return;

  // 逐张装备牌:给予目标 → 装备(含旧装备替换 + 技能挂载)
  for (const cardId of equipIds) {
    if (!state.players[ownerId]?.alive) break;
    if (!state.players[ownerId].hand.includes(cardId)) continue; // 安全:牌已不在手牌
    // 给予目标(目标!=自己时);目标==自己时牌已在手牌
    if (target !== ownerId) {
      await applyAtom(state, {
        type: '给予',
        cardId,
        from: ownerId,
        to: target,
      });
    }
    const card = state.cardMap[cardId];
    const slot = slotOf(card);
    if (!slot) continue;
    // 替换同槽旧装备(逻辑同 界直言/装备通用)
    const current = state.players[target].equipment[slot];
    if (current) {
      const oldCard = state.cardMap[current];
      if (oldCard?.name && hasSkillModule(oldCard.name)) {
        await applyAtom(state, {
          type: '移除技能',
          player: target,
          skillId: oldCard.name,
        });
      }
      await applyAtom(state, { type: '卸下', player: target, slot });
      await applyAtom(state, {
        type: '移动牌',
        cardId: current,
        from: { zone: '手牌', player: target },
        to: { zone: '弃牌堆' },
      });
    }
    await applyAtom(state, { type: '装备', player: target, cardId });
    if (card?.name && hasSkillModule(card.name)) {
      await applyAtom(state, {
        type: '添加技能',
        player: target,
        skillId: card.name,
      });
    }
  }

  // 该角色失去1点体力
  if (state.players[target]?.alive) {
    await applyAtom(state, { type: '失去体力', target, amount: 1 });
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // 阶段开始 after-hook:按 phase 分支到 准备/结束 逻辑
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (ctx.state.currentPlayerIndex !== ownerId) return;
    if (atom.phase === '准备') {
      await performKongshengPrepare(ctx.state, ownerId);
    } else if (atom.phase === '回合结束') {
      await performKongshengEnd(ctx.state, ownerId);
    }
  });

  // respond:处理 confirm / select / target 三步回应(均由周妃本人回应)
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as { requestType?: string }).requestType;
      if (rt === CONFIRM_RT) {
        return null;
      }
      if (rt === SELECT_RT) {
        // 客户端契约:useCard 型 pending 只发 {cardId};{}=不置于武将牌上。
        const raw: unknown = params.cardIds ?? params.cardId;
        const ids = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : undefined;
        if (!ids || ids.length === 0) return null; // 放弃 → 消费端按未置牌结束
        return null;
      }
      if (rt === TARGET_RT) {
        const t = params.target;
        if (typeof t !== 'number') return '需要选择一名角色';
        return null;
      }
      return '当前不是箜声询问';
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (
        slot?.atom as { requestType?: string } | undefined
      )?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] =
          params.choice === true || params.confirmed === true;
      } else if (rt === SELECT_RT) {
        const raw: unknown = params.cardIds ?? params.cardId;
        const ids = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : undefined;
        if (ids && ids.length > 0) st.localVars[SELECT_KEY] = ids;
      } else if (rt === TARGET_RT) {
        const t = params.target;
        if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 箜声为阶段触发技(由 阶段开始 hook 被动触发),无主动 action 按钮需要声明
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
