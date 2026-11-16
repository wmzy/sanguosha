// skills/cards/_pickPanel.ts — pickTargetCard 选牌面板的 respond/resolve 共享实现。
//
// 顺手牵羊(obtain)与过河拆桥(discard)是同构卡:弹选牌面板让使用者从目标区域
// (手牌/装备/判定区)选一张牌。respond 的 zone 形状校验与 PICK_RESULT_KEY 写入
// 完全一致;resolve 侧的获得/弃置分支已由 flows/pick-card-panel 的
// runPickTargetCardPanel 按 mode 参数化——本模块把两者收敛为单点,两卡仅注入
// requestType / mode / title 差异。挑衅 的选牌分支复用其中的装备候选判据。
//
// 装备面板候选校验(panelEquipmentAllowed / validateEquipmentInPanel):
//   装备区选牌的 cardId 必须在面板下发(可能已被 before-hook 过滤)的 equipment
//   候选列表内。界奇才的防具/宝物保护仅约束弃置语义——OL 文案「当其他角色**弃置**
//   你装备区里的防具或宝物牌时,你防止之」,before-hook 也只拦 mode='discard' 的
//   面板,obtain 面板不过滤(顺手牵羊仍可拿走受保护装备)。故仅过河拆桥启用该校验;
//   顺手牵羊(obtain)不启用——注入异常 cardId 由 askPickTargetCard 的候选校验
//   兜底(返回 undefined → 面板落空,不发生牌转移)。
import type { CardEffect, GameState, Json, ResolveCtx } from '../../types';
import { runPickTargetCardPanel } from '../../flows/pick-card-panel';
import { PICK_RESULT_KEY } from '../../rules/vars-keys';
import { requireRequestType } from '../../util/skillRuntime';

/** 装备区选牌的共享判据:cardId 是否在面板下发(可能已被 before-hook 过滤)的
 *  equipment 候选列表内。列表缺失(异常 pending 形状)时放行,由 askPickTargetCard
 *  的候选校验兜底。过河拆桥/顺手牵羊 respond 与 挑衅 选牌分支同源消费。 */
export function panelEquipmentAllowed(atom: unknown, cardId: string): boolean {
  const equipList = (
    atom as { prompt?: { equipment?: Array<{ cardId: string }> } } | undefined
  )?.prompt?.equipment;
  return !equipList || equipList.some((e) => e.cardId === cardId);
}

/** createPickPanelRespond 可选项。 */
export interface PickPanelRespondOptions {
  /** 选牌面板的 requestType(requireRequestType 匹配 + 错误文案)。 */
  requestType: string;
  /** 是否校验装备区 cardId 在面板候选列表内(仅 discard 语义启用,见文件头)。 */
  validateEquipmentInPanel?: boolean;
}

/** pickTargetCard 选牌面板的 respond 三件套:requestType 校验 + zone 形状校验
 *  (手牌 handIndex / 装备·判定区 cardId)+ execute 写 PICK_RESULT_KEY
 *  (由 runPickTargetCardPanel 读取)。顺手牵羊/过河拆桥 消费。 */
export function createPickPanelRespond(
  opts: PickPanelRespondOptions,
): NonNullable<CardEffect['respond']> {
  return {
    validate: (state: GameState, ownerId: number, params: Record<string, Json>) => {
      const check = requireRequestType(state, ownerId, [opts.requestType], {
        wrongTypeError: '当前不是选牌窗口',
        mismatchError: '当前不是选牌窗口',
      });
      if (check.error) return check.error;
      const zone = params.zone;
      if (zone === 'equipment' || zone === 'judge') {
        if (typeof params.cardId !== 'string') return 'cardId required';
      } else if (zone === 'hand') {
        if (typeof params.handIndex !== 'number') return 'handIndex required';
      } else {
        return 'zone required (equipment|judge|hand)';
      }
      if (
        opts.validateEquipmentInPanel &&
        zone === 'equipment' &&
        typeof params.cardId === 'string' &&
        !panelEquipmentAllowed(state.pendingSlots.get(ownerId)?.atom, params.cardId)
      ) {
        return '该装备不可选';
      }
      return null;
    },
    execute: async (state: GameState, _ownerId: number, params: Record<string, Json>) => {
      state.localVars[PICK_RESULT_KEY] = {
        zone: params.zone,
        cardId: params.cardId ?? null,
        handIndex: params.handIndex ?? null,
      };
    },
  };
}

/** pickTargetCard 选牌面板的 resolve 薄封装:目标存在时弹面板,获得/弃置分支由
 *  runPickTargetCardPanel 按 mode 执行。无懈可击由 runSettlementPhase 的
 *  「生效前」时机统一处理,此处不再询问。 */
export function createPickPanelResolve(opts: {
  mode: 'obtain' | 'discard';
  requestType: string;
  title: string;
}): (ctx: ResolveCtx) => Promise<void> {
  return async (ctx) => {
    const { state, source, target } = ctx;
    const targetPlayer = state.players[target];
    if (targetPlayer) {
      await runPickTargetCardPanel(state, source, target, targetPlayer, {
        mode: opts.mode,
        requestType: opts.requestType,
        title: opts.title,
      });
    }
  };
}
