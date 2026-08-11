// 罪论(诸葛瞻·蜀·被动技,OL hero/410 风林火山官方逐字):
//   "结束阶段,你可以观看牌堆顶三张牌,然后获得其中X张牌,将剩余牌以任意顺序置于牌堆顶
//    (X为你满足的项数:1.本回合造成过伤害;2.本回合未弃置过牌;3.手牌数全场最少)。
//    若均不满足,你与一名其他角色失去1点体力。"
//
// 触发时机:阶段开始(回合结束) after-hook——同闭月/进趋。此时 turn.vars 尚未被
//   回合结束 atom 清空,本回合累计的"造成伤害/弃置"标记可读(见进趋注释)。
//
// X = 三项满足数(0..3):
//   ① 本回合造成过伤害:after-hook 监听 造成伤害后(source===自己)写 turn.vars 标记。
//      造成伤害后 仅在实际造成伤害(amount>0,已扣血)后发出,语义精确匹配"造成过伤害"。
//   ② 本回合未弃置过牌:after-hook 监听 弃置(player===自己)写 turn.vars 标记;条件=未写。
//   ③ 手牌数全场最少:实时计算存活角色手牌最小值,自己===min(含并列)。
//
// 分支:
//   X=0:强制——自己 + 选一名其他存活角色,各失去1点体力(失去体力 atom,非伤害)。
//   X≥1:可选(confirm)——观看牌堆顶3张,选X张获得(移动牌 牌堆→手牌),
//        剩余(3-X)张按指定顺序置牌堆顶(整理牌堆)。
//
// turn.vars 标记键按 ownerId 命名空间(罪论/伤害/${ownerId}、罪论/弃置/${ownerId}),
//   避免多名罪论拥有者同回合互相污染(共享 turn.vars)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook } from '../core/skill';
import type { SkillModule } from '../types';

const SKILL_ID = '罪论';
const CONFIRM_RT = `${SKILL_ID}/confirm`;
const PICK_RT = `${SKILL_ID}/pick`;
const CHOOSE_TARGET_RT = `${SKILL_ID}/chooseTarget`;

const CONFIRM_KEY = `${SKILL_ID}/confirmed`;
const PICK_KEY = `${SKILL_ID}/pick`; // { gained: string[]; topOrder: string[] }
const TARGET_KEY = `${SKILL_ID}/target`;
const EXPECTED_GAIN_KEY = `${SKILL_ID}/expectedGain`; // number
const OBSERVED_KEY = `${SKILL_ID}/observed`; // string[]

/** turn.vars key:本回合 owner 是否造成过伤害 */
const damageVar = (ownerId: number) => `${SKILL_ID}/伤害/${ownerId}`;
/** turn.vars key:本回合 owner 是否弃置过牌 */
const discardVar = (ownerId: number) => `${SKILL_ID}/弃置/${ownerId}`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description:
      '结束阶段可观看牌堆顶三张牌,获得其中X张(X为满足项数:本回合造成过伤害/未弃置过牌/手牌数全场最少),余牌任意顺序置牌堆顶;均不满足则自己与一名其他角色各失去1点体力',
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

  // ── 跟踪①:本回合造成过伤害 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害后', async (ctx) => {
    if (ctx.atom.source === ownerId) {
      ctx.state.turn.vars[damageVar(ownerId)] = true;
    }
  });

  // ── 跟踪②:本回合弃置过牌 ──
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    if (ctx.atom.player === ownerId) {
      ctx.state.turn.vars[discardVar(ownerId)] = true;
    }
  });

  // ── respond:处理 confirm / pick / chooseTarget 三种询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const rt = currentRequestType(st, ownerId);
      if (rt !== CONFIRM_RT && rt !== PICK_RT && rt !== CHOOSE_TARGET_RT) {
        return '当前不是罪论询问';
      }
      if (rt === CONFIRM_RT) return null; // confirm:任意 choice 均可

      if (rt === CHOOSE_TARGET_RT) {
        // chooseTarget:需提供一名其他存活角色
        const tgt = (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0];
        if (typeof tgt !== 'number') return '请选择一名其他角色';
        if (tgt === ownerId) return '不能选择自己';
        if (!st.players[tgt]?.alive) return '目标已死亡';
        return null;
      }

      // pick:校验 gained/topOrder 是 observed 的合法划分
      const observed = (st.localVars[OBSERVED_KEY] as string[] | undefined) ?? [];
      const expectedGain = (st.localVars[EXPECTED_GAIN_KEY] as number | undefined) ?? 0;
      const gained = params.gained as string[] | undefined;
      const topOrder = params.topOrder as string[] | undefined;
      if (!Array.isArray(gained) || !Array.isArray(topOrder)) return '需要 gained/topOrder 划分';
      if (gained.length !== expectedGain) return `应获得 ${expectedGain} 张牌`;
      const observedSet = new Set(observed);
      const combined = [...gained, ...topOrder];
      const valid =
        combined.length === observed.length &&
        new Set(combined).size === combined.length &&
        combined.every((id) => observedSet.has(id));
      if (!valid) return '划分不合法(必须恰好覆盖观看的牌)';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const rt = currentRequestType(st, ownerId);
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === PICK_RT) {
        st.localVars[PICK_KEY] = {
          gained: params.gained ?? [],
          topOrder: params.topOrder ?? [],
        };
      } else if (rt === CHOOSE_TARGET_RT) {
        const tgt = (params.target as number | undefined) ?? (params.targets as number[] | undefined)?.[0];
        if (typeof tgt === 'number') st.localVars[TARGET_KEY] = tgt;
      }
    },
  );

  // ── 阶段开始(回合结束) after-hook:罪论主流程 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx): Promise<void> => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '回合结束') return;
    if (atom.player !== ownerId) return;

    const st = ctx.state;
    const self = st.players[ownerId];
    if (!self?.alive) return;

    // 计算 X
    const causedDamage = !!st.turn.vars[damageVar(ownerId)];
    const notDiscarded = !st.turn.vars[discardVar(ownerId)];
    const alivePlayers = st.players.filter((p) => p.alive);
    const minHand = alivePlayers.reduce((m, p) => Math.min(m, p.hand.length), Infinity);
    const fewestHand = alivePlayers.length > 0 && self.hand.length === minHand; // 含并列
    const x = (causedDamage ? 1 : 0) + (notDiscarded ? 1 : 0) + (fewestHand ? 1 : 0);

    // ── X=0:强制失去体力 ──
    if (x === 0) {
      const others = alivePlayers.filter((p) => p.index !== ownerId);
      let target: number | undefined;
      if (others.length > 0) {
        delete st.localVars[TARGET_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: CHOOSE_TARGET_RT,
          target: ownerId,
          prompt: {
            type: 'choosePlayer',
            title: '罪论:选择一名其他角色与其各失去1点体力',
            min: 1,
            max: 1,
            candidates: others.map((p) => p.index),
          },
          timeout: 20,
        });
        target = st.localVars[TARGET_KEY] as number | undefined;
        delete st.localVars[TARGET_KEY];
        // 超时未选 → 默认选第一个其他存活角色(不放弃失去体力义务)
        if (typeof target !== 'number' || !st.players[target]?.alive || target === ownerId) {
          target = others[0].index;
        }
      }
      await applyAtom(st, { type: '失去体力', target: ownerId, amount: 1 });
      if (typeof target === 'number' && st.players[target]?.alive) {
        await applyAtom(st, { type: '失去体力', target, amount: 1 });
      }
      return;
    }

    // ── X≥1:牌堆为空则无可观之牌,直接返回 ──
    const deck = st.zones.deck;
    if (deck.length === 0) return;
    const drawCount = Math.min(3, deck.length);
    const observed = deck.slice(-drawCount);
    const gainCount = Math.min(x, drawCount);

    // 1. 询问是否发动
    delete st.localVars[CONFIRM_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `是否发动罪论?(满足 ${x} 项,获得 ${gainCount} 张)`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!st.localVars[CONFIRM_KEY]) {
      delete st.localVars[CONFIRM_KEY];
      return;
    }
    delete st.localVars[CONFIRM_KEY];

    // 2. 询问挑选(获得X张 + 剩余任意顺序置顶)
    st.localVars[OBSERVED_KEY] = observed;
    st.localVars[EXPECTED_GAIN_KEY] = gainCount;
    delete st.localVars[PICK_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: PICK_RT,
      target: ownerId,
      prompt: {
        type: 'distribute',
        title: `罪论:选择 ${gainCount} 张获得,其余 ${drawCount - gainCount} 张按顺序置于牌堆顶`,
        description:
          'respond: { gained: 要获得的牌; topOrder: 留在牌堆顶的牌(顺序即摸牌顺序,首个最先摸到) }',
        mode: 'select',
        cardIds: observed,
        minTotal: drawCount,
        maxTotal: drawCount,
      },
      timeout: 30,
    });

    let pick = st.localVars[PICK_KEY] as { gained: string[]; topOrder: string[] } | undefined;
    delete st.localVars[PICK_KEY];
    delete st.localVars[OBSERVED_KEY];
    delete st.localVars[EXPECTED_GAIN_KEY];
    // 超时/非法:默认获得 observed 前 gainCount 张,剩余保持原序置顶
    if (!pick || !Array.isArray(pick.gained) || !Array.isArray(pick.topOrder)) {
      pick = { gained: observed.slice(0, gainCount), topOrder: observed.slice(gainCount) };
    }
    const gained = pick.gained;
    const topOrder = pick.topOrder;

    // 3. 获得:逐张从牌堆移入手牌(移动牌 牌堆→手牌,视图为摸牌信息分级)
    for (const cardId of gained) {
      if (st.zones.deck.includes(cardId)) {
        await applyAtom(st, {
          type: '移动牌',
          cardId,
          from: { zone: '牌堆' },
          to: { zone: '手牌', player: ownerId },
        });
      }
    }

    // 4. 剩余牌按指定顺序置牌堆顶(整理牌堆:bottom + topOrder 倒序置顶)
    if (topOrder.length > 0) {
      const remainingCount = topOrder.length;
      const bottom = st.zones.deck.slice(0, st.zones.deck.length - remainingCount);
      const newDeck = [...bottom, ...[...topOrder].reverse()];
      if (newDeck.length === st.zones.deck.length) {
        await applyAtom(st, {
          type: '整理牌堆',
          cards: newDeck,
          topCount: remainingCount,
        });
      }
    }
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: SKILL_ID,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动罪论?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
