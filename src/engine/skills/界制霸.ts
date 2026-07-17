// 界制霸(界孙策·主公技,OL hero/452 官方逐字):
//   主公技，出牌阶段限一次，你可以与一名其他吴势力角色拼点；
//   其他吴势力角色出牌阶段限一次，其可以与你拼点（你可以拒绝）：
//   若其没赢，你可以获得两张拼点牌。
//
// 双向拼点(相对标制霸 src/engine/skills/制霸.ts,不修改标版):
//   方向 A(同标制霸):其他吴势力角色在自己出牌阶段主动发起拼点;
//     孙策觉醒后可拒绝;若发起方没赢,孙策可获得两张拼点牌。
//   方向 B(界新增):孙策在自己出牌阶段主动发起拼点(限一次,选一名其他吴势力角色);
//     若发起方(孙策)没赢,孙策可获得两张拼点牌。
//
// 结果归属(官方字面"若其没赢，你可以获得两张拼点牌"):
//   "其"=发起方,"你"=孙策(技能拥有者)。故无论谁发起,只要发起方没赢,
//   孙策(你)即可获得两张拼点牌。方向 B 下孙策主动发起而没赢时,孙策自己获得两张牌
//   (界版加强:孙策主动拼点无负面)。
//
// 主公判定:ownerId===0(参考激将/若愚/黄天/标制霸的主公位约定)。
// 拼点点数:A=1, 2-10=面值, J=11, Q=12, K=13;严格大于才算赢,相等算没赢。
// 不使用「拼点」atom:该 atom applyView 固定把拼点牌投影进弃牌堆,与"获得拼点牌
//   (处理区→手牌)"的视图路径冲突。改用「移动牌」逐张流转(同标制霸)。
// 限一次:方向 A 用 盟友 vars['界制霸/usedThisTurn'];方向 B 用 孙策 vars['界制霸/主动/usedThisTurn']
//   (后缀 /usedThisTurn 由「回合结束」atom 自动清空)。两个方向独立计数。
// 觉醒拒绝判定:读孙策 vars['魂姿/awakened'](由 魂姿/界魂姿 写入,跨技能共享)。
//
// 命名:文件/loader key/character skill name = '界制霸'(避开标制霸冲突);
//   内部 Skill.name = '制霸'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending } from '../skill';

const SKILL_ID = '界制霸';
const DISPLAY_NAME = '制霸';
const AWAKENED_KEY = '魂姿/awakened';

// 限一次 key(两个方向独立)
const ALLY_USED = SKILL_ID; // 盟友主动:vars['界制霸/usedThisTurn']
const LORD_USED = `${SKILL_ID}/主动`; // 孙策主动:vars['界制霸/主动/usedThisTurn']

// respond requestTypes
const REFUSE_RT = `${SKILL_ID}/refuse`; // 觉醒后孙策是否拒绝盟友发起的拼点(confirm)
const RESP_CARD_RT = `${SKILL_ID}/respCard`; // 被拼点方选一张拼点牌(useCard)
const TAKE_RT = `${SKILL_ID}/take`; // 孙策是否获得两张拼点牌(confirm)

// localVars 键
const REFUSE_KEY = `${SKILL_ID}/refuseResult`; // true=接受, false=拒绝
const RESP_CARD_KEY = `${SKILL_ID}/respCardId`;
const TAKE_KEY = `${SKILL_ID}/takeResult`;

/** 拼点牌点数:A=1, 2-10=面值, J=11, Q=12, K=13 */
function rankValue(rank: string): number {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  const n = parseInt(rank, 10);
  return Number.isFinite(n) ? n : 0;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '主公技:你与其他吴势力角色可互相拼点;若发起方没赢,你可以获得两张拼点牌;觉醒后可拒绝盟友发起的拼点',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ════════════════════════════════════════════════════════════════
  // 方向 A:盟友(其他吴势力角色)在自己出牌阶段主动发起拼点(同标制霸)
  // ════════════════════════════════════════════════════════════════
  for (const p of state.players) {
    const allyIdx = p.index;
    if (allyIdx === ownerId) continue;
    if (p.faction !== '吴') continue;

    const u = registerAction(
      state,
      skill.id,
      allyIdx,
      'use',
      (st: GameState, params: Record<string, Json>): string | null => {
        if (ownerId !== 0) return '制霸为主公技,孙策非主公';
        const lord = st.players[ownerId];
        if (!lord?.alive) return '主公不存在或已死亡';
        if (lord.hand.length === 0) return '孙策没有手牌,无法拼点';

        const self = st.players[allyIdx];
        if (!self?.alive) return '已死亡';
        const myTurn = st.currentPlayerIndex === allyIdx;
        const inActPhase = st.phase === '出牌';
        const free = !hasBlockingPending(st);
        if (!myTurn || !inActPhase || !free) return '现在不能使用制霸';
        if (usedThisTurn(st, allyIdx, ALLY_USED)) return '本回合已使用过制霸';

        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张拼点牌';
        if (!self.hand.includes(cardId)) return '拼点牌不在手牌中';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const allyCardId = params.cardId as string;
        await markOncePerTurn(st, allyIdx, ALLY_USED);
        const lord = st.players[ownerId];

        // 觉醒后可拒绝
        if (lord.vars[AWAKENED_KEY]) {
          delete st.localVars[REFUSE_KEY];
          await applyAtom(st, {
            type: '请求回应',
            requestType: REFUSE_RT,
            target: ownerId,
            prompt: {
              type: 'confirm',
              title: `${st.players[allyIdx].name} 欲与你制霸拼点,是否接受?`,
              confirmLabel: '接受',
              cancelLabel: '拒绝',
            },
            defaultChoice: true,
            timeout: 20,
          });
          if (st.localVars[REFUSE_KEY] === false) return; // 孙策拒绝
        }

        await pushFrame(st, SKILL_ID, allyIdx, { ...params });
        try {
          // 1) 盟友拼点牌 → 处理区(公开)
          await applyAtom(st, {
            type: '移动牌',
            cardId: allyCardId,
            from: { zone: '手牌', player: allyIdx },
            to: { zone: '处理区' },
          });

          // 2) 询问孙策选拼点牌
          delete st.localVars[RESP_CARD_KEY];
          await applyAtom(st, {
            type: '请求回应',
            requestType: RESP_CARD_RT,
            target: ownerId,
            prompt: {
              type: 'useCard',
              title: `制霸:与 ${st.players[allyIdx].name} 拼点,请出一张手牌`,
              cardFilter: { min: 1, max: 1 },
            },
            timeout: 30,
          });
          const lordCardId = st.localVars[RESP_CARD_KEY] as string | undefined;
          if (!lordCardId || !st.players[ownerId].hand.includes(lordCardId)) {
            await applyAtom(st, {
              type: '移动牌',
              cardId: allyCardId,
              from: { zone: '处理区' },
              to: { zone: '弃牌堆' },
            });
            return;
          }

          await applyAtom(st, {
            type: '移动牌',
            cardId: lordCardId,
            from: { zone: '手牌', player: ownerId },
            to: { zone: '处理区' },
          });

          // 3) 比点:发起方(盟友)严格大于孙策 = 盟友赢
          const allyValue = rankValue(st.cardMap[allyCardId]?.rank ?? '');
          const lordValue = rankValue(st.cardMap[lordCardId]?.rank ?? '');
          const initiatorWon = allyValue > lordValue;

          await resolveAfterCompare(st, ownerId, allyCardId, lordCardId, initiatorWon);
        } finally {
          await popFrame(st);
        }
      },
    );
    unloaders.push(u);
  }

  // ════════════════════════════════════════════════════════════════
  // 方向 B:孙策在自己出牌阶段主动发起拼点(界新增)
  // ════════════════════════════════════════════════════════════════
  const uLord = registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>): string | null => {
      if (ownerId !== 0) return '制霸为主公技,孙策非主公';
      const self = st.players[ownerId];
      if (!self?.alive) return '已死亡';
      const myTurn = st.currentPlayerIndex === ownerId;
      const inActPhase = st.phase === '出牌';
      const free = !hasBlockingPending(st);
      if (!myTurn || !inActPhase || !free) return '现在不能主动使用制霸';
      if (usedThisTurn(st, ownerId, LORD_USED)) return '本回合已主动使用过制霸';

      const cardId = params.cardId as string | undefined;
      if (typeof cardId !== 'string') return '请选择一张拼点牌';
      if (!self.hand.includes(cardId)) return '拼点牌不在手牌中';

      // 目标:一名其他吴势力角色,存活
      const target = params.target as number | undefined;
      if (typeof target !== 'number') return '请选择一名其他吴势力角色';
      if (target === ownerId) return '不能与自己拼点';
      const tp = st.players[target];
      if (!tp?.alive) return '目标不存在或已死亡';
      if (tp.faction !== '吴') return '目标非吴势力';
      if (tp.hand.length === 0) return '目标没有手牌,无法拼点';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const lordCardId = params.cardId as string;
      const targetIdx = params.target as number;
      await markOncePerTurn(st, ownerId, LORD_USED);

      await pushFrame(st, SKILL_ID, ownerId, { ...params });
      try {
        // 1) 孙策拼点牌 → 处理区(公开)
        await applyAtom(st, {
          type: '移动牌',
          cardId: lordCardId,
          from: { zone: '手牌', player: ownerId },
          to: { zone: '处理区' },
        });

        // 2) 询问目标选拼点牌
        delete st.localVars[RESP_CARD_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: RESP_CARD_RT,
          target: targetIdx,
          prompt: {
            type: 'useCard',
            title: `制霸:${st.players[ownerId].name} 与你拼点,请出一张手牌`,
            cardFilter: { min: 1, max: 1 },
          },
          timeout: 30,
        });
        const targetCardId = st.localVars[RESP_CARD_KEY] as string | undefined;
        if (!targetCardId || !st.players[targetIdx].hand.includes(targetCardId)) {
          // 目标未出牌:孙策拼点牌进弃牌堆,无事
          await applyAtom(st, {
            type: '移动牌',
            cardId: lordCardId,
            from: { zone: '处理区' },
            to: { zone: '弃牌堆' },
          });
          return;
        }

        await applyAtom(st, {
          type: '移动牌',
          cardId: targetCardId,
          from: { zone: '手牌', player: targetIdx },
          to: { zone: '处理区' },
        });

        // 3) 比点:发起方(孙策)严格大于目标 = 孙策赢
        const lordValue = rankValue(st.cardMap[lordCardId]?.rank ?? '');
        const targetValue = rankValue(st.cardMap[targetCardId]?.rank ?? '');
        const initiatorWon = lordValue > targetValue;

        await resolveAfterCompare(st, ownerId, lordCardId, targetCardId, initiatorWon);
      } finally {
        await popFrame(st);
      }
    },
  );
  unloaders.push(uLord);

  // ════════════════════════════════════════════════════════════════
  // respond(注册到所有玩家):拒绝 / 选拼点牌 / 获得确认
  // dispatch 按 (skillId, ownerId, actionType) 查;以 requestType 区分三种询问。
  // ════════════════════════════════════════════════════════════════
  for (const p of state.players) {
    const seatId = p.index;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as Record<string, unknown>;
        if (atom['type'] !== '请求回应') return '当前不需要回应';
        const rt = atom['requestType'] as string;
        // 拒绝/获得确认:仅孙策
        if (rt === REFUSE_RT || rt === TAKE_RT) {
          if (seatId !== ownerId) return '只有孙策可以回应';
          return null;
        }
        // 选拼点牌:被拼点方(由请求 target 决定——孙策或目标盟友)
        if (rt === RESP_CARD_RT) {
          const cardId = params.cardId as string;
          if (typeof cardId !== 'string') return '请选择一张拼点牌';
          if (!st.players[seatId].hand.includes(cardId)) return '拼点牌不在手牌中';
          return null;
        }
        return '当前不是制霸回应';
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return;
        const atom = slot.atom as Record<string, unknown>;
        const rt = atom['requestType'] as string;
        if (rt === REFUSE_RT) {
          st.localVars[REFUSE_KEY] = params.choice === true || params.confirmed === true;
        } else if (rt === RESP_CARD_RT) {
          st.localVars[RESP_CARD_KEY] = params.cardId;
        } else if (rt === TAKE_RT) {
          st.localVars[TAKE_KEY] = params.choice === true || params.confirmed === true;
        }
      },
    );
    unloaders.push(u);
  }

  return () => {
    unloaders.forEach((u) => u());
  };
}

/**
 * 拼点比点后统一结算(两个方向共用):
 *   initiatorWon=true(发起方赢)→ 两张牌进弃牌堆
 *   initiatorWon=false(发起方没赢)→ 询问孙策是否获得两张拼点牌:
 *     获得 → 处理区→孙策手牌;不获得 → 处理区→弃牌堆
 */
async function resolveAfterCompare(
  state: GameState,
  ownerId: number,
  cardA: string,
  cardB: string,
  initiatorWon: boolean,
): Promise<void> {
  if (initiatorWon) {
    for (const id of [cardA, cardB]) {
      await applyAtom(state, {
        type: '移动牌',
        cardId: id,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    }
    return;
  }
  // 发起方没赢:询问孙策是否获得两张拼点牌
  delete state.localVars[TAKE_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: TAKE_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '制霸:对方拼点没赢,是否获得两张拼点牌?',
      confirmLabel: '获得',
      cancelLabel: '不获得',
    },
    defaultChoice: true,
    timeout: 20,
  });
  const take = state.localVars[TAKE_KEY] !== false;
  for (const id of [cardA, cardB]) {
    await applyAtom(state, {
      type: '移动牌',
      cardId: id,
      from: { zone: '处理区' },
      to: take ? { zone: '手牌', player: ownerId } : { zone: '弃牌堆' },
    });
  }
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '制霸',
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
