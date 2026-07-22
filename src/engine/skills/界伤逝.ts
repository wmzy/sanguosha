// 界伤逝(界张春华·被动技,OL hero/625 官方逐字):
//   "当你的手牌数小于X后,你可以将手牌摸至X张。(X为你已损失体力值)"
//
// 与标版 张春华·伤逝 描述一致,但标版未实现,故仍独立创建界版文件。
//
// 实现:after-hook 挂多个 atom,覆盖所有可能让"手牌 < X"条件成真的状态变更:
//   1. 造成伤害(target=春华):X = maxHealth - health 可能因受伤增加
//   2. 失去体力(target=春华):同上(闪电等无来源体力流失;或被绝情转化的伤害)
//   3. 弃置(player=春华):手牌数减少
//   4. 移动牌(from=春华手牌):打出/被偷/被拿等让手牌数减少
//
// 每次任意 hook 触发,统一调 checkTrigger(state, ownerId):
//   X = max(0, maxHealth - health); hand = hand.length
//   if (hand < X) 询问是否发动(confirm);确认则 摸牌(player=春华, count=X-hand)
//
// 关键点:
//   - 被动可选("你可以"),需 请求回应 询问。无次数限制。
//   - "摸至X张":count = X - hand,严格补齐到 X(不超过)。
//   - 牌堆不足:把 count 钳制到 deck+discardPile 总数,避免 摸牌.validate 抛错。
//   - 摸牌产生的 移动牌(牌堆→手牌)不会触发本技:from.zone='牌堆'≠'手牌',
//     故无重入。
//   - 春华在自己的回合内反复触发是合法的(例如连出两张牌,每张都触发一次)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const CONFIRM_RT = '伤逝/confirm';
const CONFIRM_KEY = '伤逝/confirmed';

/** 已损失体力值 X = max(0, maxHealth - health)。 */
function lostHealth(state: GameState, ownerId: number): number {
  const p = state.players[ownerId];
  if (!p) return 0;
  return Math.max(0, p.maxHealth - p.health);
}

/** 检查并可能触发伤逝:手牌 < X 时询问,确认则摸至 X 张。 */
async function checkTrigger(state: GameState, ownerId: number): Promise<void> {
  const p = state.players[ownerId];
  if (!p?.alive) return;
  const X = lostHealth(state, ownerId);
  const hand = p.hand.length;
  if (X <= 0) return; // 未受伤:不触发("小于X",X=0 时恒不成立)
  if (hand >= X) return; // 手牌数 ≥ X:不触发

  // 询问是否发动
  delete state.localVars[CONFIRM_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CONFIRM_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: `伤逝:是否将手牌摸至 ${X} 张?(当前 ${hand} 张,已损失 ${X} 体力)`,
      confirmLabel: '摸牌',
      cancelLabel: '不发动',
    },
    defaultChoice: false,
    timeout: 10,
  });
  if (state.localVars[CONFIRM_KEY] !== true) return;

  // 摸至 X 张:count = X - hand。牌堆不足时钳制到可用总数,避免 validate 抛错。
  let count = X - hand;
  const available = state.zones.deck.length + state.zones.discardPile.length;
  if (count > available) count = available;
  if (count > 0) {
    await applyAtom(state, { type: '摸牌', player: ownerId, count });
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '伤逝',
    description: '当你的手牌数小于X后,你可以将手牌摸至X张(X为你已损失体力值)',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // respond:玩家在「伤逝/confirm」询问下的确认/取消
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不需要回应';
      if (atom.requestType !== CONFIRM_RT) return '当前不是伤逝确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 造成伤害 after:春华受伤 → X 增加 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    await checkTrigger(ctx.state, ownerId);
  });

  // ── 失去体力 after:春华失去体力 → X 增加 ──
  registerAfterHook(state, skill.id, ownerId, '失去体力', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    await checkTrigger(ctx.state, ownerId);
  });

  // ── 弃置 after:春华被弃牌(含手牌) → 手牌数减少 ──
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    if ((atom.cardIds ?? []).length === 0) return;
    await checkTrigger(ctx.state, ownerId);
  });

  // ── 移动牌 after:春华手牌被移走 → 手牌数减少 ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    // 仅当"从春华的手牌区移出"才可能减少手牌(摸牌 from=牌堆 不触发)
    if (atom.from?.zone !== '手牌') return;
    if (atom.from?.player !== ownerId) return;
    // 手牌→自己的手牌(罕见)不减,跳过
    if (atom.to?.zone === '手牌' && atom.to?.player === ownerId) return;
    await checkTrigger(ctx.state, ownerId);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '伤逝',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动伤逝?',
      confirmLabel: '摸牌',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
