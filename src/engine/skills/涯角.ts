// 涯角(界赵云·蜀·主动技):每当你于回合外使用或打出手牌时,你可以展示牌堆顶的一张牌,
//   若这两张牌的类别相同,你可以将牌堆顶的一张牌交给一名角色;
//   若不同,你可以弃置攻击范围内包含你的一名角色区域里的一张牌。
//
// 规则来源:docs/research/武将技能/蜀国/界赵云.md
//
// 实现:
//   1. after hook 挂在「移动牌」atom 上:
//      触发条件 = 手牌(from)→处理区(to) 且非自己回合 且牌堆非空。
//      每张手牌的使用/打出 = 一次 移动牌(手牌→处理区),天然满足"每张手牌限一次"。
//   2. 询问发动(请求回应·confirm) → 展示牌堆顶(展示 atom,广播身份) → 比较类别:
//        · 相同 → 请求回应(choosePlayer)选目标 → 移动牌(牌堆顶→目标手牌)
//        · 不同 → 请求回应(choosePlayer)选攻击范围内包含自己的角色 →
//          runPickTargetCardPanel 弃置该角色区域一张牌(discard 模式)
//      两步"你可以"均为可选;不选则牌留在牌堆顶。
//   3. respond action 处理三种 requestType(confirm/target/discard),按当前 pending 分支写 localVars。
//
// 类别判断:cardMap 的 type 字段(基本牌/锦囊牌/装备牌)。
// "交给一名角色"含自己(FAQ 明确)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';
import { inAttackRange } from '../distance';
import { runPickTargetCardPanel } from './选牌面板';

/** localVars keys */
const CONFIRMED_KEY = '涯角/confirmed';
const TARGET_KEY = '涯角/target';

/** 请求回应 requestTypes */
const CONFIRM_RT = '涯角/confirm';
const TARGET_RT = '涯角/target';
const DISCARD_RT = '涯角/discard';

/** 读取当前 pending 的 requestType(类型安全) */
function currentRequestType(state: GameState, ownerId: number): string | undefined {
  const slot = state.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as unknown as Record<string, unknown>).requestType as string | undefined;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '涯角',
    description:
      '每当你于回合外使用或打出手牌时,你可以展示牌堆顶的一张牌,若这两张牌的类别相同,你可以将牌堆顶的一张牌交给一名角色;若不同,你可以弃置攻击范围内包含你的一名角色区域里的一张牌。',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:处理涯角的三步询问(confirm / target / discard) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>) => {
      const rt = currentRequestType(st, ownerId);
      if (rt !== CONFIRM_RT && rt !== TARGET_RT && rt !== DISCARD_RT)
        return '当前不是涯角询问';
      // DISCARD_RT = pickTargetCard 选牌面板(由 runPickTargetCardPanel 发起):
      //   需 zone + 对应 cardId/handIndex(与界刚烈/过河拆桥选牌一致)
      if (rt === DISCARD_RT) {
        const zone = params.zone;
        if (zone === 'equipment' || zone === 'judge') {
          if (typeof params.cardId !== 'string') return 'cardId required';
        } else if (zone === 'hand') {
          if (typeof params.handIndex !== 'number') return 'handIndex required';
        } else {
          return 'zone required (equipment|judge|hand)';
        }
      }
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const rt = currentRequestType(st, ownerId);
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === TARGET_RT) {
        st.localVars[TARGET_KEY] = params.target ?? null;
      } else if (rt === DISCARD_RT) {
        // pickTargetCard 选牌结果:由 选牌面板.ts 的 runPickTargetCardPanel 读取
        st.localVars['选牌/结果'] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
          handIndex: params.handIndex ?? null,
        };
      }
    },
  );

  // ── after hook:回合外使用/打出手牌后 ──
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    // 仅手牌→处理区 = 使用/打出手牌
    if (atom.from.zone !== '手牌' || atom.from.player !== ownerId) return;
    if (atom.to.zone !== '处理区') return;
    // 仅回合外
    if (ctx.state.currentPlayerIndex === ownerId) return;
    // 存活
    if (!ctx.state.players[ownerId]?.alive) return;
    // 牌堆须非空
    const deck = ctx.state.zones.deck;
    if (deck.length === 0) return;

    // ── 第一步:询问是否发动涯角 ──
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '是否发动涯角?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    // ── 第二步:展示牌堆顶牌(广播身份给所有人) ──
    const topCardId = deck[deck.length - 1];
    await applyAtom(ctx.state, { type: '展示', player: ownerId, cardId: topCardId });

    // ── 第三步:比较类别 ──
    const playedCard = ctx.state.cardMap[atom.cardId];
    const topCard = ctx.state.cardMap[topCardId];
    const sameType = playedCard?.type === topCard?.type;

    if (sameType) {
      // 类别相同:询问将牌堆顶牌交给哪名角色(含自己)
      delete ctx.state.localVars[TARGET_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: TARGET_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '涯角:将牌堆顶牌交给一名角色',
          min: 1,
          max: 1,
          filter: (view, target) => view.players[target]?.alive === true,
        },
        timeout: 15,
      });
      const giveTarget = ctx.state.localVars[TARGET_KEY] as number | null;
      if (typeof giveTarget === 'number') {
        // 用摸牌 atom 将牌堆顶牌交给目标(摸牌的 toViewEvents 含完整牌信息,
        // 移动牌 牌堆→手牌 的视图事件缺 id 会导致前后端视图不一致)。
        // 展示后牌堆未变,摸牌 count=1 必然抽出刚展示的 topCardId。
        await applyAtom(ctx.state, { type: '摸牌', player: giveTarget, count: 1 });
      }
    } else {
      // 类别不同:弃置攻击范围内包含自己的一名角色区域里的一张牌
      // 官方:"若这两张牌类型不同,你可以弃置攻击范围内包含你的一名角色区域里的一张牌"
      delete ctx.state.localVars[TARGET_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: TARGET_RT,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '涯角:选择攻击范围内包含你的一名角色,弃其一张牌',
          min: 1,
          max: 1,
          // "攻击范围内包含你" = 该角色能攻击到 owner(inAttackRange(target, owner))
          filter: (_view, t) =>
            ctx.state.players[t]?.alive === true && inAttackRange(ctx.state, t, ownerId),
        },
        timeout: 20,
      });
      const discardTarget = ctx.state.localVars[TARGET_KEY] as number | null;
      delete ctx.state.localVars[TARGET_KEY];
      if (typeof discardTarget !== 'number') return;
      const target = ctx.state.players[discardTarget];
      if (!target?.alive) return;
      // runPickTargetCardPanel(discard) 内部读取 选牌/结果 并 applyAtom 弃置(过河拆桥同款)
      await runPickTargetCardPanel(ctx.state, ownerId, discardTarget, target, {
        mode: 'discard',
        requestType: DISCARD_RT,
        title: `涯角:选择要从 ${target.name} 区域弃置的一张牌`,
      });
    }

    // 清理
    delete ctx.state.localVars[CONFIRMED_KEY];
    delete ctx.state.localVars[TARGET_KEY];
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '涯角',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动涯角?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
