// 勤学(界吕蒙·吴·觉醒技,OL hero/306 现行版 2022 加强):
//   "觉醒技,准备阶段或结束阶段,若你的手牌数比你的体力值多2或更多,
//    你减1点体力上限,回复1点体力或摸两张牌,然后获得'攻心'。"
//
// 时机:阶段开始(准备 或 回合结束)after-hook —— 吕蒙的准备阶段 / 结束阶段。
//   阶段顺序:准备→判定→摸牌→出牌→弃牌→回合结束;两个触发点对应 phase '准备' 与 '回合结束'。
// 条件:手牌数 - 体力值 >= 2,且未觉醒。
// 效果:减1体力上限 → 二选一(摸两张牌 / 回复1点体力) → 永久获得"攻心"(衍生技)。
// 觉醒标记:player.vars['勤学/awakened'](永久 vars,整局一次,不被「回合结束」atom 清理)。
//
// 模式参考:志继/若愚(觉醒技 after-hook + 二选一 + 设上限 + 添加技能)。
//   志继挂在「回合开始」,本技挂在「阶段开始」(因触发点是"阶段"而非"回合开始")。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const CHOOSE_RT = '勤学/choose';
const CHOICE_KEY = '勤学/choice';
const AWAKENED_KEY = '勤学/awakened';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '勤学',
    description:
      '觉醒技:准备或结束阶段,若手牌数比体力值多2或更多,减1体力上限,回复1体力或摸2牌,然后获得"攻心"',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:吕蒙二选一(摸两张牌 / 回复1点体力)──
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
      if (atom['requestType'] !== CHOOSE_RT) return '当前不是勤学选择';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      // choice=true → 摸两张牌;choice=false → 回复1点体力
      st.localVars[CHOICE_KEY] = params.choice === true ? 'draw' : 'heal';
    },
  );

  // ── 阶段开始 after-hook:勤学主逻辑(准备 或 回合结束)──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '准备' && atom.phase !== '回合结束') return;
    // 觉醒技:整局一次
    if (ctx.state.players[ownerId]?.vars[AWAKENED_KEY]) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    // 触发条件:手牌数 - 体力值 >= 2(无人数分支,OL 现行版)
    if (self.hand.length - self.health < 2) return;

    // 标记已觉醒(在读条件后立即设,防重入)
    ctx.state.players[ownerId].vars[AWAKENED_KEY] = true;

    // 1. 减1点体力上限(设上限 amount = maxHealth - 1,需 > 0)
    const newMax = self.maxHealth - 1;
    if (newMax > 0) {
      await applyAtom(ctx.state, { type: '设上限', player: ownerId, amount: newMax });
    }

    // 2. 二选一(摸两张牌 / 回复1点体力)
    delete ctx.state.localVars[CHOICE_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CHOOSE_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '勤学:摸两张牌,还是回复1点体力?',
        confirmLabel: '摸两张牌',
        cancelLabel: '回复1点体力',
      },
      defaultChoice: false,
      timeout: 30,
    });
    const choice = ctx.state.localVars[CHOICE_KEY] as string | undefined;
    delete ctx.state.localVars[CHOICE_KEY];

    if (choice === 'draw') {
      await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 2 });
    } else {
      // 回复1点(不超过上限;已满血则跳过)
      const cur = ctx.state.players[ownerId].health;
      const max = ctx.state.players[ownerId].maxHealth;
      const amount = Math.min(1, Math.max(0, max - cur));
      if (amount > 0) {
        await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount });
      }
    }

    // 3. 永久获得"攻心"(衍生技)
    await applyAtom(ctx.state, { type: '添加技能', player: ownerId, skillId: '攻心' });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '勤学',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '勤学:摸两张牌,还是回复1点体力?',
      confirmLabel: '摸两张牌',
      cancelLabel: '回复1点体力',
    },
  });
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
