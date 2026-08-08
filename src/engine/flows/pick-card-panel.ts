// src/engine/pick-card-panel.ts
// 选牌面板公共逻辑:过河拆桥(弃置)/顺手牵羊(获得)/反馈(获得) 三处共用。
//
// 三者的交互同构:弹 pickTargetCard pending,使用者从目标区域(装备/判定/手牌)选一张牌。
//   - 装备/判定:明牌可见,直接选 cardId
//   - 手牌:盲选第 K 张(牌背位置博弈),splice 手牌顺序保证重放确定性
// 差异通过 mode(requestType/title) 参数化:
//   - discard: 弃置选定牌(过河拆桥)
//   - obtain:  获得选定牌(顺手牵羊/反馈)
//
// 装备保护(界奇才)已解耦:本模块不再 import 界奇才,面板始终展示全部装备;
// 界奇才通过 before-hook 拦截「请求回应」atom,在 toViewEvents 前过滤 prompt.equipment
// 中的受保护装备(见 skills/界奇才.ts)。runPickTargetCardPanel 在 applyAtom 后回读
// (可能被过滤后的)prompt.equipment 重算默认选择,避免超时 fallback 命中受保护装备。
import type { ActionLogEntry, GameState, Json } from '../types';
import { applyAtom } from '../index';

/** 在 actionLog 中当前(最后一条)条目之前插入一条"设置手牌顺序"条目。
 *  重放时该条目先执行 → 目标 hand 顺序恢复 → 后续盲选取 hand[K] 确定性正确。
 *  去重:若前一条已是同 target 的设置手牌顺序且 order 一致,跳过(避免重放二次插入)。 */
export function spliceHandOrderEntry(state: GameState, target: number): void {
  const player = state.players[target];
  if (!player) return;
  const order = [...player.hand];
  if (order.length === 0) return;
  const log = state.actionLog;
  const myIndex = log.length - 1; // 当前条目位置
  if (myIndex > 0) {
    const prev = log[myIndex - 1];
    if (
      prev.message.skillId === '系统规则' &&
      prev.message.actionType === '设置手牌顺序' &&
      (prev.message.params.target as number) === target
    ) {
      const prevOrder = prev.message.params.order as string[];
      if (
        Array.isArray(prevOrder) &&
        prevOrder.length === order.length &&
        prevOrder.every((id, i) => id === order[i])
      ) {
        return; // 顺序未变,跳过
      }
    }
  }
  const entry: ActionLogEntry = {
    id: `order-${log.length}-${target}`,
    timestamp: Date.now() - state.startedAt,
    message: {
      skillId: '系统规则',
      actionType: '设置手牌顺序',
      ownerId: log[myIndex].message.ownerId,
      params: { target, order },
      baseSeq: log[myIndex].baseSeq,
    },
    baseSeq: log[myIndex].baseSeq,
  };
  log.splice(myIndex, 0, entry);
}

export type PickCardMode = 'discard' | 'obtain';

export interface PickTargetCardOptions {
  mode: PickCardMode;
  /** 请求回应的 requestType;前端 resolvePendingRespond 按 [/_] 分隔取首段作 skillId。
   *  需与对应技能 respond action 的 validate 检查一致。 */
  requestType: string;
  /** pickTargetCard 面板标题。 */
  title: string;
  /** 是否允许选判定区延时锦囊。过河拆桥/顺手牵羊=true(默认);
   *  反馈=false(经典规则仅手牌+装备,不含判定区)。 */
  includeJudge?: boolean;
}

/** 弹 pickTargetCard 选牌面板,使用者(from)从目标区域选一张牌(弃置或获得)。
 *  - discard: 弃置选定牌(过河拆桥)
 *  - obtain:  获得选定牌(顺手牵羊/反馈)
 *  手牌盲选时 splice 手牌顺序(重放确定性);超时默认明牌优先(装备→判定)否则 hand[0]。
 *  装备保护由调用方的 before-hook(界奇才)在「请求回应」atom 上过滤,本函数不感知。 */
export async function runPickTargetCardPanel(
  state: GameState,
  from: number,
  target: number,
  targetPlayer: GameState['players'][number],
  opts: PickTargetCardOptions,
): Promise<void> {
  const obtain = opts.mode === 'obtain';

  // 构建装备列表(明牌)。面板始终展示全部装备——discard 模式的装备保护
  // 由界奇才 before-hook 在请求回应 atom 上过滤(见 skills/界奇才.ts),本模块不感知。
  const equipment = Object.entries(targetPlayer.equipment)
    .filter(([, id]) => typeof id === 'string')
    .map(([slot, id]) => ({ slot, cardId: id, cardName: state.cardMap[id]?.name ?? '?' }));
  // 反馈(经典规则)仅可选手牌+装备,不含判定区;过河拆桥/顺手牵羊含判定区
  const judge =
    opts.includeJudge === false
      ? []
      : targetPlayer.pendingTricks.map((t) => ({
          cardId: t.card.id,
          cardName: t.card.name,
        }));
  const handCount = targetPlayer.hand.length;

  // 超时默认选择:明牌优先(装备第一张→判定第一张),否则手牌[0]
  const defaultZone =
    equipment.length > 0
      ? { zone: 'equipment', cardId: equipment[0].cardId }
      : judge.length > 0
        ? { zone: 'judge', cardId: judge[0].cardId }
        : { zone: 'hand', handIndex: 0 };

  // 手牌存在时,splice 顺序快照(重放确定性)
  if (handCount > 0) {
    spliceHandOrderEntry(state, target);
  }

  // 保留 atom 引用:before-hook(界奇才)会就地过滤 prompt.equipment,applyAtom 后回读
  const pickAtom = {
    type: '请求回应' as const,
    requestType: opts.requestType,
    target: from,
    prompt: {
      type: 'pickTargetCard' as const,
      title: opts.title,
      target,
      equipment,
      judge,
      handCount,
    },
    defaultChoice: defaultZone as unknown as Json,
    timeout: 20,
  };
  await applyAtom(state, pickAtom);

  // 读取使用者选择
  const result = state.localVars['选牌/结果'] as
    | { zone: string; cardId: string | null; handIndex: number | null }
    | undefined;
  delete state.localVars['选牌/结果'];

  // before-hook(界奇才)可能已就地过滤 prompt.equipment 中的受保护装备;
  // 若默认选择指向被过滤掉的装备,重算为过滤后列表的首项(或判定/手牌),
  // 避免超时 fallback 命中受保护装备。
  const filteredEquip = (pickAtom.prompt.equipment ?? []) as Array<{
    slot: string;
    cardId: string;
  }>;
  let fallback = defaultZone as { zone: string; cardId?: string; handIndex?: number };
  if (fallback.zone === 'equipment') {
    const stillThere = filteredEquip.some((e) => e.cardId === fallback.cardId);
    if (!stillThere) {
      fallback =
        filteredEquip.length > 0
          ? { zone: 'equipment', cardId: filteredEquip[0].cardId }
          : judge.length > 0
            ? { zone: 'judge', cardId: judge[0].cardId }
            : { zone: 'hand', handIndex: 0 };
    }
  }
  const zone = result?.zone ?? fallback.zone;

  if (zone === 'equipment') {
    const cardId = (result?.cardId ?? fallback.cardId) as string;
    if (obtain) {
      await applyAtom(state, { type: '获得', player: from, cardId, from: target });
    } else {
      await applyAtom(state, { type: '弃置', player: target, cardIds: [cardId] });
    }
  } else if (zone === 'judge') {
    const cardId = (result?.cardId ?? fallback.cardId) as string;
    const trick = targetPlayer.pendingTricks.find((t) => t.card.id === cardId);
    if (trick) {
      await applyAtom(state, { type: '移除延时锦囊', player: target, trickName: trick.name });
      if (obtain) {
        await applyAtom(state, { type: '获得', player: from, cardId, from: target });
      } else {
        await applyAtom(state, { type: '弃置', player: target, cardIds: [cardId] });
      }
    }
  } else {
    // hand:盲选
    const handIndex = result?.handIndex ?? 0;
    const pickedCard = targetPlayer.hand[handIndex] ?? targetPlayer.hand[0];
    if (pickedCard) {
      if (obtain) {
        await applyAtom(state, { type: '获得', player: from, cardId: pickedCard, from: target });
      } else {
        await applyAtom(state, { type: '弃置', player: target, cardIds: [pickedCard] });
      }
    }
  }
}
