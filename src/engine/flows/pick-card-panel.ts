// src/engine/flows/pick-card-panel.ts
// 选牌面板公共逻辑:过河拆桥(弃置)/顺手牵羊(获得)/反馈(获得) 等 15+ 处共用。
//
// 各处的交互同构:弹 pickTargetCard pending,使用者从目标区域(装备/判定/手牌)选一张牌。
//   - 装备/判定:明牌可见,直接选 cardId
//   - 手牌:盲选第 K 张(牌背位置博弈),splice 手牌顺序保证重放确定性
// 分层:
//   - askPickTargetCard(底层):弹面板并解析为选中 cardId(不执行转移),供
//     需要自定义后续动作的调用方使用(鞬出族目标自选自弃、解围选移动源牌)。
//   - runPickTargetCardPanel(薄封装):discard=弃置所选牌(过河拆桥)、
//     obtain=获得所选牌(顺手牵羊/反馈)。
//
// 装备保护(界奇才)已解耦:本模块不再 import 界奇才,面板始终展示全部装备;
// 界奇才通过 before-hook 拦截「请求回应」atom,在 toViewEvents 前过滤 prompt.equipment
// 中的受保护装备(见 skills/界奇才.ts)。askPickTargetCard 在 applyAtom 后回读
// (可能被过滤后的)prompt.equipment 重算默认选择,避免超时 fallback 命中受保护装备。
import type { ActionLogEntry, GameState, Json } from '../types';
import { applyAtom } from '../core/apply';
import { discardJudgeZoneCard, obtainJudgeZoneCard } from '../core/judge-zone';
import { PICK_RESULT_KEY, getPickResult } from '../rules/vars-keys';

/** 在 actionLog 中当前(最后一条)条目之前插入一条"设置手牌顺序"条目。
 *  重放时 restore() 识别该条目后直接恢复目标 hand 顺序(不走 dispatch)→ 后续盲选
 *  取 hand[K] 确定性正确。去重:若前一条已是同 target 的设置手牌顺序且 order 一致,
 *  跳过(避免重放二次插入)。 */
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
    timestamp: state.clock.now() - state.startedAt,
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

/** askPickTargetCard 的选项(mode 可省略,timeoutFallback 可关)。 */
export interface AskPickTargetCardOptions {
  /** 面板 prompt.mode:'discard'(弃他人牌,过河拆桥族)会让界奇才 before-hook
   *  过滤目标的防具/宝物;省略时面板不带 mode——目标自选自弃(鞬出族:「其他角色
   *  弃置你装备区牌」不成立,保护不适用)与纯选牌(解围移动选源牌)不触发过滤。 */
  mode?: PickCardMode;
  requestType: string;
  title: string;
  includeJudge?: boolean;
  /** 超时是否兜底默认选择(明牌优先,否则手牌[0]);默认 true。
   *  解围选源牌传 false:超时视为未选(技能落空),与旧手写面板一致。 */
  timeoutFallback?: boolean;
}

/** 面板选中结果:zone + 已解析的实体 cardId(手牌盲选已按 handIndex 取到具体牌;
 *  装备/判定的 cardId 已校验在(可能被界奇才过滤后的)面板候选列表内)。 */
export interface PickTargetCardSelection {
  zone: 'equipment' | 'judge' | 'hand';
  cardId: string;
}

/** 底层选牌:弹 pickTargetCard 面板并解析选择,返回选中的牌(不执行任何转移)。
 *  含:手牌盲选 splice 顺序快照(重放确定性)、超时默认(明牌优先:装备→判定→手牌[0])、
 *  界奇才 before-hook 过滤后的默认选择重算。未选(超时无兜底)/所选无效返回 undefined。
 *  装备保护由界奇才 before-hook 在「请求回应」atom 上过滤,本函数不感知。 */
export async function askPickTargetCard(
  state: GameState,
  from: number,
  target: number,
  targetPlayer: GameState['players'][number],
  opts: AskPickTargetCardOptions,
): Promise<PickTargetCardSelection | undefined> {
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

  // 手牌存在时,splice 顺序快照(重放确定性)
  if (handCount > 0) {
    spliceHandOrderEntry(state, target);
  }

  // 超时默认选择:明牌优先(装备第一张→判定第一张),否则手牌[0]
  const defaultZone =
    equipment.length > 0
      ? { zone: 'equipment', cardId: equipment[0].cardId }
      : judge.length > 0
        ? { zone: 'judge', cardId: judge[0].cardId }
        : { zone: 'hand', handIndex: 0 };
  const hasTimeoutFallback = opts.timeoutFallback !== false;

  // 保留 atom 引用:before-hook(界奇才)会就地过滤 prompt.equipment,applyAtom 后回读
  const pickAtom = {
    type: '请求回应' as const,
    requestType: opts.requestType,
    target: from,
    prompt: {
      type: 'pickTargetCard' as const,
      ...(opts.mode === undefined ? {} : { mode: opts.mode }),
      title: opts.title,
      target,
      equipment,
      judge,
      handCount,
    },
    ...(hasTimeoutFallback
      ? { defaultChoice: defaultZone as unknown as Json }
      : {}),
    timeout: 20,
  };
  await applyAtom(state, pickAtom);

  // 读取使用者选择
  const result = getPickResult(state.localVars);
  delete state.localVars[PICK_RESULT_KEY];
  // 无兜底(解围选源牌):超时未回应 → 视为未选
  if (result === undefined && !hasTimeoutFallback) return undefined;

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
    // 校验:必须是被询问时(prompt,含界奇才 before-hook 过滤后)下发的候选之一。
    // 获得/弃置 atom 均不校验归属,异常客户端注入任意 cardId 会把他人手中的牌
    // 复制进自己手牌/弃牌堆,且可能绕过装备保护。
    if (!filteredEquip.some((e) => e.cardId === cardId)) return undefined;
    return { zone: 'equipment', cardId };
  }
  if (zone === 'judge') {
    const cardId = (result?.cardId ?? fallback.cardId) as string;
    const trick = targetPlayer.pendingTricks.find((t) => t.card.id === cardId);
    if (!trick) return undefined;
    return { zone: 'judge', cardId };
  }
  // hand:盲选
  const handIndex = result?.handIndex ?? 0;
  const pickedCard = targetPlayer.hand[handIndex] ?? targetPlayer.hand[0];
  return pickedCard ? { zone: 'hand', cardId: pickedCard } : undefined;
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
  const selection = await askPickTargetCard(state, from, target, targetPlayer, {
    mode: opts.mode,
    requestType: opts.requestType,
    title: opts.title,
    includeJudge: opts.includeJudge,
  });
  if (!selection) return;

  if (selection.zone === 'equipment') {
    if (obtain) {
      await applyAtom(state, {
        type: '获得',
        player: from,
        cardId: selection.cardId,
        from: target,
      });
    } else {
      await applyAtom(state, { type: '弃置', player: target, cardIds: [selection.cardId] });
    }
  } else if (selection.zone === 'judge') {
    const trick = targetPlayer.pendingTricks.find((t) => t.card.id === selection.cardId);
    if (trick) {
      await applyAtom(state, { type: '移除延时锦囊', player: target, trickName: trick.name });
      // 判定区只持牌面快照,实体牌在使用时已入弃牌堆:按实体牌实际归属处置,
      // 不能直接 获得/弃置(会让同一张牌同时存在于弃牌堆与手牌,或弃牌堆出现两次)。
      if (obtain) {
        await obtainJudgeZoneCard(state, target, selection.cardId, from);
      } else {
        await discardJudgeZoneCard(state, target, selection.cardId);
      }
    }
  } else {
    // hand:盲选
    if (obtain) {
      await applyAtom(state, {
        type: '获得',
        player: from,
        cardId: selection.cardId,
        from: target,
      });
    } else {
      await applyAtom(state, { type: '弃置', player: target, cardIds: [selection.cardId] });
    }
  }
}
