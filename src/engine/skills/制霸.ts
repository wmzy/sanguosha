// 制霸(孙策·主公技):其他吴势力角色的出牌阶段,可与你进行一次拼点;
//   若该角色没赢,你可以获得双方拼点的牌;觉醒后你可拒绝此拼点。每回合限一次。
//
// 模式 B 变体(主公技,盟友主动):在孙策(ownerId)实例上注册,但 use action
//   注册在每个吴势力盟友座次上(非孙策本人),盟友在自己出牌阶段主动拼点。
//   参考黄天(为群势力盟友注册 use action)的同构模式。
//
// 流程:
//   1. 吴盟友在自己回合出牌阶段 dispatch 制霸.use(选一张拼点牌)
//   2. validate:盟友回合+出牌阶段+无pending+存活+孙策为主公+孙策存活+孙策有手牌+
//      牌在手+本回合未用
//   3. 若孙策已觉醒(魂姿):询问孙策是否拒绝;拒绝则中止(不动牌)
//   4. 盟友拼点牌 → 处理区(打出,公开)
//   5. 询问孙策选拼点牌 → 孙策拼点牌 → 处理区(打出,公开)
//   6. 比点:发起方(盟友)点数严格大于孙策 = 盟友赢;否则(≤)盟友没赢
//   7. 盟友没赢 → 询问孙策是否获得双方拼点牌:
//        获得则两张牌 处理区→孙策手牌;不获得则 处理区→弃牌堆
//      盟友赢 → 两张牌 处理区→弃牌堆
//
// 关键点:
//   - 主公判定:ownerId === 0(参考激将/若愚/黄天的主公位约定)
//   - 拼点点数:A=1, 2-10=面值, J=11, Q=12, K=13;严格大于才算赢,相等算没赢
//   - 不使用「拼点」atom:该 atom 的 applyView 固定把拼点牌投影进弃牌堆,
//     与"获得拼点牌(处理区→手牌)"的视图路径冲突(会 discardPileCount 双计)。
//     改用「移动牌」逐张流转:打出(手牌→处理区)已公开拼点牌,获得/弃置由移动牌
//     统一处理,视图在 处理区↔手牌/弃牌堆 间保持一致。
//   - 每名角色每回合限一次:盟友 vars['制霸/usedThisTurn'](后缀约定,回合结束自动清空)
//   - 觉醒拒绝判定:读孙策 vars['魂姿/awakened'](由魂姿技能写入,跨技能共享 player.vars)
//
// 共享导出:方向A(盟友主动拼点)的 use/respond 注册与比点后结算
//   (registerZhibaAllyRankUse / registerZhibaRankRespond / resolveZhibaRankAfterCompare)
//   —— 界制霸·方向A 与本文件逐字同构,差异(限一次键/requestType/帧名/获得询问文案/
//   选拼点牌回应者范围)经 ZhibaRankOptions 注入,界版直接消费(模式同 好施.ts)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply'
import { popFrame, pushFrame } from '../core/frame';
import { usedThisTurn, markOncePerTurn } from '../rules/once-per-turn';
import { registerAction } from '../core/skill';
import { askConfirm, defineConfirmAction, engineCanPlayNow } from '../util/skillRuntime';
import { getHunziAwakened } from '../rules/vars-keys';
import { askRankCard, getCardValue } from '../flows/rank';


// respond requestTypes(孙策回应)
const REFUSE_RT = '制霸/refuse'; // 觉醒后是否拒绝拼点(confirm)
const LORD_CARD_RT = '制霸/lordCard'; // 孙策选拼点牌(useCard)
const TAKE_RT = '制霸/take'; // 是否获得双方拼点牌(confirm)

// localVars 键
const REFUSE_KEY = '制霸/refuseResult'; // true=接受, false=拒绝
const LORD_CARD_KEY = '制霸/lordCardId';
const TAKE_KEY = '制霸/takeResult';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '制霸',
    description:
      '主公技:其他吴势力角色出牌阶段可与你拼点,若其没赢你可获得双方拼点牌;觉醒后可拒绝拼点',
  };
}

/** 制霸族(标/界)方向A 共享注册参数:标制霸 与 界制霸·方向A(盟友主动拼点)
 *  的 use/respond 注册与比点后结算逐字同构,差异全部经此注入。 */
export interface ZhibaRankOptions {
  /** 技能实例 id(registerAction 注册键:'制霸'/'界制霸') */
  skillId: string;
  /** 孙策(技能拥有者)座次;主公位约定 ownerId===0 */
  ownerId: number;
  /** 每回合限一次 vars 键(标 '制霸' / 界 '界制霸') */
  usedKey: string;
  /** pushFrame 帧名(结算帧名,日志可见;标 '制霸' / 界 '界制霸') */
  frameName: string;
  /** 觉醒拒绝询问 requestType / localVars 键 */
  refuseRT: string;
  refuseKey: string;
  /** 选拼点牌询问 requestType / localVars 键(标 '制霸/lordCard' / 界 '界制霸/respCard') */
  respCardRT: string;
  respCardKey: string;
  /** 获得拼点牌询问 requestType / localVars 键 */
  takeRT: string;
  takeKey: string;
  /** 获得询问文案(逐字保留各版差异:标 '…双方拼点牌' / 界 '…两张拼点牌') */
  takeTitle: string;
  /** respond 选拼点牌分支仅孙策可回应(标 true;界的 RESP_CARD_RT 兼服务方向B,
   *  被拼点方可为盟友 → false) */
  respCardLordOnly: boolean;
}

/** 拼点比点后统一结算(方向A/方向B 共用;界版方向B亦复用):
 *   发起方赢 → 两张拼点牌进弃牌堆
 *   发起方没赢 → 询问孙策(opts.ownerId)是否获得两张拼点牌:
 *     获得 → 处理区→孙策手牌;不获得 → 处理区→弃牌堆 */
export async function resolveZhibaRankAfterCompare(
  state: GameState,
  cardA: string,
  cardB: string,
  initiatorWon: boolean,
  opts: ZhibaRankOptions,
): Promise<void> {
  if (initiatorWon) {
    // 发起方赢:两张牌进弃牌堆
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
  // 发起方没赢:询问孙策是否获得双方拼点牌
  const take = await askConfirm(state, opts.takeRT, opts.ownerId, {
    confirmedKey: opts.takeKey,
    title: opts.takeTitle,
    confirmLabel: '获得',
    cancelLabel: '不获得',
    defaultChoice: true,
    timeout: 20,
  });
  for (const id of [cardA, cardB]) {
    await applyAtom(state, {
      type: '移动牌',
      cardId: id,
      from: { zone: '处理区' },
      to: take
        ? { zone: '手牌', player: opts.ownerId }
        : { zone: '弃牌堆' },
    });
  }
}

/** 方向A:为每个其他吴势力盟友注册 use action(盟友在自己出牌阶段主动发起拼点)。
 *  validate 分支顺序与拒绝文案、觉醒拒绝询问→askRankCard→比点→获得询问 的
 *  atom 序列与标版逐字一致;标/界差异全部经 opts 注入。 */
export function registerZhibaAllyRankUse(
  state: GameState,
  opts: ZhibaRankOptions,
): Array<() => void> {
  const { ownerId, skillId } = opts;
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const allyIdx = p.index;
    if (allyIdx === ownerId) continue;
    if (p.faction !== '吴') continue;

    const u = registerAction(
      state,
      skillId,
      allyIdx,
      'use',
      (st: GameState, params: Record<string, Json>): string | null => {
        // 主公技:仅孙策为主公(ownerId===0)时可用
        if (ownerId !== 0) return '制霸为主公技,孙策非主公';
        const lord = st.players[ownerId];
        if (!lord?.alive) return '主公不存在或已死亡';
        // 拼点需孙策有手牌
        if (lord.hand.length === 0) return '孙策没有手牌,无法拼点';

        const self = st.players[allyIdx];
        if (!self?.alive) return '已死亡';
        // 自己回合 + 出牌阶段 + 无阻塞 pending(存活已由上方早退校验)→ engineCanPlayNow
        if (!engineCanPlayNow(st, allyIdx)) return '现在不能使用制霸';

        // 每回合限一次
        if (usedThisTurn(st, allyIdx, opts.usedKey)) return '本回合已使用过制霸';

        // 牌校验:在手牌中
        const cardId = params.cardId as string | undefined;
        if (typeof cardId !== 'string') return '请选择一张拼点牌';
        if (!self.hand.includes(cardId)) return '拼点牌不在手牌中';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const allyCardId = params.cardId as string;

        // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
        await markOncePerTurn(st, allyIdx, opts.usedKey);

        const lord = st.players[ownerId];

        // 觉醒后可拒绝拼点:询问孙策(未觉醒则直接接受)
        if (getHunziAwakened(lord.vars)) {
          const accept = await askConfirm(st, opts.refuseRT, ownerId, {
            confirmedKey: opts.refuseKey,
            title: `${st.players[allyIdx].name} 欲与你制霸拼点,是否接受?`,
            confirmLabel: '接受',
            cancelLabel: '拒绝',
            defaultChoice: true,
            timeout: 20,
          });
          if (!accept) return; // 孙策拒绝,中止
        }

        await pushFrame(st, opts.frameName, allyIdx, { ...params });
        try {
          // 1) 盟友拼点牌 → 处理区(公开)
          await applyAtom(st, {
            type: '移动牌',
            cardId: allyCardId,
            from: { zone: '手牌', player: allyIdx },
            to: { zone: '处理区' },
          });

          // 2) 询问孙策选拼点牌(询问封装于 flows/rank.askRankCard;
          //    比点走本文件的 移动牌 流转,不用 runRankCompareFlow)
          const lordCardId = await askRankCard(st, {
            requestType: opts.respCardRT,
            answerKey: opts.respCardKey,
            target: ownerId,
            title: `制霸:与 ${st.players[allyIdx].name} 拼点,请出一张手牌`,
            timeout: 30,
          });
          if (!lordCardId) {
            // 孙策未出牌(超时等):两张牌进弃牌堆,盟友视为赢(无事)
            await applyAtom(st, {
              type: '移动牌',
              cardId: allyCardId,
              from: { zone: '处理区' },
              to: { zone: '弃牌堆' },
            });
            return;
          }

          // 孙策拼点牌 → 处理区(公开)
          await applyAtom(st, {
            type: '移动牌',
            cardId: lordCardId,
            from: { zone: '手牌', player: ownerId },
            to: { zone: '处理区' },
          });

          // 3) 比点:盟友严格大于孙策 = 盟友赢;否则盟友没赢
          const allyValue = getCardValue(st.cardMap[allyCardId]);
          const lordValue = getCardValue(st.cardMap[lordCardId]);
          const allyWon = allyValue > lordValue;

          await resolveZhibaRankAfterCompare(st, allyCardId, lordCardId, allyWon, opts);
        } finally {
          await popFrame(st);
        }
      },
    );
    unloaders.push(u);
  }
  return unloaders;
}

/** respond(注册到所有玩家):孙策处理拒绝/选拼点牌/获得确认。
 *  dispatch 按 (skillId, ownerId, actionType) 查;以 requestType 区分三种询问。
 *  选拼点牌分支的回应者范围是标/界唯一结构差异(opts.respCardLordOnly)。 */
export function registerZhibaRankRespond(
  state: GameState,
  opts: ZhibaRankOptions,
): Array<() => void> {
  const { ownerId, skillId } = opts;
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const seatId = p.index;
    const u = registerAction(
      state,
      skillId,
      seatId,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as Record<string, unknown>;
        if (atom['type'] !== '请求回应') return '当前不需要回应';
        const rt = atom['requestType'] as string;
        // 拒绝/获得确认:仅孙策
        if (rt === opts.refuseRT || rt === opts.takeRT) {
          if (seatId !== ownerId) return '只有孙策可以回应';
          return null;
        }
        // 选拼点牌:标版仅孙策;界版被拼点方由请求 target 决定(孙策或目标盟友)
        if (rt === opts.respCardRT) {
          if (opts.respCardLordOnly && seatId !== ownerId)
            return '只有孙策可以选择拼点牌';
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
        if (rt === opts.refuseRT) {
          // choice===true → 接受;false → 拒绝
          st.localVars[opts.refuseKey] = params.choice === true || params.confirmed === true;
        } else if (rt === opts.respCardRT) {
          st.localVars[opts.respCardKey] = params.cardId;
        } else if (rt === opts.takeRT) {
          st.localVars[opts.takeKey] = params.choice === true || params.confirmed === true;
        }
      },
    );
    unloaders.push(u);
  }
  return unloaders;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const opts: ZhibaRankOptions = {
    ownerId,
    skillId: skill.id,
    usedKey: '制霸',
    frameName: '制霸',
    refuseRT: REFUSE_RT,
    refuseKey: REFUSE_KEY,
    respCardRT: LORD_CARD_RT,
    respCardKey: LORD_CARD_KEY,
    takeRT: TAKE_RT,
    takeKey: TAKE_KEY,
    takeTitle: '制霸:对方拼点没赢,是否获得双方拼点牌?',
    respCardLordOnly: true,
  };

  const unloaders = [
    // ── 方向A:为每个吴势力盟友(非孙策)注册 use action ──
    ...registerZhibaAllyRankUse(state, opts),
    // ── respond(注册到所有玩家):孙策处理拒绝/选拼点牌/获得确认 ──
    ...registerZhibaRankRespond(state, opts),
  ];

  return () => {
    unloaders.forEach((u) => u());
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  // 孙策的回应 action(拒绝/选拼点牌/获得确认)。盟友的主动拼点 action 由后端
  // validate 处理(GameView 不暴露 faction,activeWhen 仅做能力范围内的 UI 过滤)。
  defineConfirmAction(api, 'respond', {
    label: '制霸',
    title: '制霸',
    confirmLabel: '确认',
    cancelLabel: '取消',
  });
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
