// src/client/components/GameView.tsx
// 新 ENGINE-DESIGN 完整游戏界面 — 参照老 GameBoard + DebugPlayerList 设计
//
// 布局: GameHeader → 提示区 → 座位弧形(其他玩家) → [左:角色大卡 | 右:倒计时+操作+目标+手牌] → 日志/调试面板
// 特性: 视角切换、顺滑倒计时、装备区独立、座位布局、主动技点击、手牌选择、弃牌选择
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { GameView as EngineGameView, Card, Json, ActionPrompt, DistributePrompt } from '../../engine/types';
import { getActionsForPlayer, registerSkillActions, clearRegistry, type SkillActionDef } from '../skillActionRegistry';
import { effectiveDist, canAttack } from '../utils/distance';
import { CountdownBar, DEFAULT_COUNTDOWN_TOTAL_MS } from './CountdownBar';
import { CharSelectOverlay } from './CharSelectOverlay';
import { CharSelectWaitingOverlay } from './CharSelectWaitingOverlay';
import { IdentityRevealOverlay } from './IdentityRevealOverlay';
import { SUIT_COLOR, PHASE_LABELS } from './gameViewConstants';
import { getCharacterMeta } from '../../engine/character-meta';
import { DistributeUI } from './DistributeUI';
import { PlayerSeatView } from './PlayerSeatView';
import { PlayerCardLarge } from './PlayerCardLarge';
import { GameLog } from './GameLog';
import { createCardFlyAnimation } from '../utils/cardFlyAnimation';
import { resolvePendingRespond } from '../utils/pendingRespond';


// ─── ActionMsg: 发给 controller(不含 baseSeq) ───
export interface ActionMsg {
  skillId: string;
  actionType: string;
  ownerId: number;
  params: Record<string, Json>;
  /** 组合 action:在主 action 前顺序执行的前置 action(转化类,如武圣) */
  preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>;
}

interface Props {
  view: EngineGameView;
  onAction: (action: ActionMsg) => void;
  /** 当前视角座次(看谁)。正式模式 = viewer;debug 模式由上层控制(多视角切换)。 */
  perspective: number;
  /** 循环切换到下一视角(debug 模式提供时,header 渲染视角切换按钮)。 */
  onSwitchPerspective?: () => void;
  /** 跳转到当前玩家回调(debug 模式提供时,header 渲染「查看当前玩家」按钮)。 */
  onGoToCurrentPlayer?: () => void;
  /** 直接切到指定座次(点座位卡切换视角等)。 */
  onPerspectiveChange?: (idx: number) => void;
  /** 自动跟随开关状态(debug 模式提供时,header 渲染「自动切换」按钮)。 */
  autoSwitchCtl?: { enabled: boolean; toggle: () => void };
  /** 退出/删除房间(可选;debug 模式提供时渲染「退出」按钮)。 */
  onDeleteRoom?: () => void;
}

// ─── 引擎声明的默认通用技能(技能按钮区/座位卡均过滤这些) ───
import { DEFAULT_SKILLS as ENGINE_DEFAULT_SKILLS } from '../../engine/atoms/选将';
import { isDelayedTrick, RANGE_REQUIRED_CARDS, TARGET_REQUIRED_CARDS, TWO_TARGET_CARDS, SELF_TARGET_CARDS, RESPOND_ONLY_CARDS } from '../../engine/card-meta';
const DEFAULT_SKILLS = new Set(ENGINE_DEFAULT_SKILLS);

import { useAnimationState } from '../hooks/useAnimationState';

// ─── 主组件 ───
// 纯净的单视角组件:perspective(看谁)由上层决定。
//   正式模式:上层传 perspective=view.viewer,固定看自己。
//   debug 模式:上层(DebugLobby)管理视角切换,传当前 perspective。
// 多视角切换/自动跟随/代打逻辑不在本组件内——那是上层的职责。
export function GameViewComponent({ view, onAction, perspective, onSwitchPerspective, onGoToCurrentPlayer, onPerspectiveChange, autoSwitchCtl, onDeleteRoom }: Props) {
  const perspectiveIdx = perspective;
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedKillTarget, setSelectedKillTarget] = useState<string | null>(null);
  const [selectedForDiscard, setSelectedForDiscard] = useState<Set<string>>(new Set());
  /** 转化模式:点武圣等转化技能后进入此模式,匹配卡牌显示为转化后的牌 */
  const [transformMode, setTransformMode] = useState<{
    skillId: string;
    actionType: string;
    cardFilter: (c: Card) => boolean;
    wrapperName: string;
  } | null>(null);
  /** 分配模式:点仁德/制衡等 distribute 主动技后进入此模式,弹出 DistributeUI 选牌/分配 */
  const [distributeMode, setDistributeMode] = useState<{
    skillId: string;
    actionType: string;
    prompt: DistributePrompt;
  } | null>(null);
  const [showIdentityReveal, setShowIdentityReveal] = useState(() => !sessionStorage.getItem('sgs_identity_shown'));
  // 选将遮罩:候选人从选将 slot 的 atom.candidates 获取(引擎生成)。
  // 正式模式:view.pending 是自己的选将询问(viewer 隔离)。
  // debug 模式:上层已将 perspective 切到待选将玩家,从 allCharSelectSlots 取该玩家的 slot
  //   (viewer 自己选完时 view.pending 为空,靠 allCharSelectSlots 代打其他玩家)。
  const ownCharSelect = view.pending?.atom?.type === '选将询问' ? view.pending : null;
  const parallelSlotForPerspective = view.allCharSelectSlots?.find(
    s => s.atom.type === '选将询问' && s.target === perspectiveIdx,
  ) ?? null;
  const charSelectPending = ownCharSelect ?? parallelSlotForPerspective;
  const isCharSelectPending = charSelectPending !== null;
  const charCandidates: Array<{ name: string; skills: string[] }> = charSelectPending
    ? (charSelectPending.atom as { candidates: Array<{ name: string; skills: string[] }> }).candidates
    : [];
  const charSelectTarget = charSelectPending ? charSelectPending.target : -1;
  // 选将阶段进行中:仍有玩家未选将(character 为空)且游戏未进入第一回合(阶段准备)
  const charSelectInProgress = view.phase === '准备'
    && view.players.some(p => !p.character);
  // 当前视角玩家是否已选将(debug 代打时随 perspectiveIdx 变化)
  const perspectiveCharSelected = !!view.players[perspectiveIdx]?.character;
  // ─── 动画状态 ───
  const anim = useAnimationState(view, perspectiveIdx);
  const handListRef = useRef<HTMLDivElement>(null);
  // 广播型 pending(如无懈可击)"不回应"后本地跳过标记,避免重复显示 prompt
  const [skippedBroadcast, setSkippedBroadcast] = useState<Set<string>>(new Set());

  const perspectivePlayer = view.players[perspectiveIdx];
  const perspectiveName = perspectivePlayer?.name ?? `P${perspectiveIdx}`;
  const isPerspectiveTurn = view.currentPlayerIndex === perspectiveIdx;
  const isMyTurn = isPerspectiveTurn;
  const currentPlayer = view.players[view.currentPlayerIndex];
  const currentPlayerName = currentPlayer?.name ?? '';

  // ─── 技能 action 注册表 ───
  // view 变化时,异步重新注册所有玩家的技能前端 actions(defineAction)
  // registerSkillActions 是 async:内部会动态 import 技能模块并调用 onMount → defineAction,
  // 必须 await 才能让 defineAction 完成,registry 才有内容。
  const skillActionsKey = view.players.map(p => `${p.name}:${p.skills.join(',')}`).join('|');
  const [skillActions, setSkillActions] = useState<SkillActionDef[]>([]);
  useEffect(() => {
    let cancelled = false;
    clearRegistry();
    // 先为所有玩家注册
    (async () => {
      for (const p of view.players) {
        await registerSkillActions(p.index, p.skills);
      }
      if (!cancelled) {
        setSkillActions(getActionsForPlayer(perspectiveIdx));
      }
    })();
    return () => { cancelled = true; };
  }, [skillActionsKey, perspectiveIdx]);

  // 视角玩家的手牌(正式模式=自己;debug 模式上层保证可见性,这里只取视角玩家的)
  const perspectiveHand: Card[] = perspectivePlayer?.hand ?? [];

  // 待回应:调试模式下自动跟到 pending target 的视角
  const pending = view.pending;
  const pendingTargetIdx = pending?.target ?? -1;
  // 广播型 slot(target < 0,如无懈可击 target=-2)所有人都可回应
  const isPerspectiveAwaiting = pending !== null && (pendingTargetIdx < 0 || pendingTargetIdx === perspectiveIdx);
  // 弃牌窗口:engine 在 弃牌阶段 创建 requestType='__弃牌' 的 pending
  const isDiscardPhase = pending !== null && (pending.atom as { requestType?: string }).requestType === '__弃牌';
  const discardMin = isDiscardPhase ? ((pending.atom as { prompt: { cardFilter?: { min?: number } } }).prompt.cardFilter?.min ?? 0) : 0;
  const discardMax = isDiscardPhase ? ((pending.atom as { prompt: { cardFilter?: { max?: number } } }).prompt.cardFilter?.max ?? discardMin) : 0;
  // 弃牌窗口出现/切换时清空已选
  useEffect(() => { setSelectedForDiscard(new Set()); }, [pending]);
  // pending 变化时清空广播跳过标记(新 pending = 新窗口)
  const pendingKey = pending ? `${pending.atom?.type}:${(pending.atom as { requestType?: string }).requestType}` : '';
  useEffect(() => { setSkippedBroadcast(new Set()); }, [pendingKey]);
  // 切牌/重选牌时,同步重置借刀杀人的第二目标
  useEffect(() => { setSelectedKillTarget(null); }, [selectedCardId]);
  // 当前视角玩家是否可操作。上层传入 perspective 即意味着该视角可操作(正式模式只传 viewer,
  // debug 模式上层保证视角合法性),故恒为 true。后续 handler 仅检查 isMyTurn/isPerspectiveAwaiting。
  const canOperate = true;
  const isMyAwaiting = isPerspectiveAwaiting && canOperate;

  // 倒计时:pending 回应优先,否则用 turnDeadline
  // 顺滑进度条由 CountdownBar (使用 useCountdownFraction + CSS transition) 渲染。
  const deadline = pending?.deadline ?? view.turnDeadline;
  // 注意:不在客户端 deadline<=0 时自动 respond/endTurn。
  // 现在依赖服务端真实超时(默认 15s):服务端 advance → view.pending 清空 → UI 自然恢复。

  // 发送 action:ownerId = 当前视角玩家(正式模式=viewer;debug 模式上层传入的 perspective)
  /** 发送 action。preceding 用于组合 action(转化技:武圣红牌当杀) */
  const send = useCallback(
    (skillId: string, actionType: string, params: Record<string, Json>, preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>) => {
      onAction({ skillId, actionType, ownerId: perspectiveIdx, params, preceding });
      setSelectedCardId(null);
      setSelectedTarget(null);
      setSelectedKillTarget(null);
    },
    [onAction, perspectiveIdx],
  );

  /** distribute 主动技提交后退出分配模式 */
  const sendDistribute = useCallback(
    (skillId: string, actionType: string, params: Record<string, Json>) => {
      send(skillId, actionType, params);
      setDistributeMode(null);
    },
    [send],
  );

  // ─── 距离和攻击范围计算(纯函数，委托 src/client/utils/distance) ───

  /** 选中的牌 */
  const selectedCard = selectedCardId ? perspectiveHand.find(c => c.id === selectedCardId) ?? null : null;

  // 转化模式下,被"虚拟"的牌名(如武圣红牌当杀):决定是否需要距离检查/是否需要目标
  // 转化前 selectedCard.name 是原牌名(如闪/桃),转化后语义上等于 wrapperName(如杀)
  const effectiveCardName = (transformMode && selectedCardId)
    ? transformMode.wrapperName
    : selectedCard?.name;

  /** 判断目标 i 是否可被选中(距离/范围检查) */
  function isTargetable(i: number): boolean {
    // 转化模式下 wrapperName 才决定距离约束
    if (!RANGE_REQUIRED_CARDS.has(effectiveCardName ?? '')) return true;
    const result = canAttack(view.players, view.cardMap, perspectiveIdx, i);
    if (!result) {
      const fromP = view.players[perspectiveIdx];
      const range = fromP?.distanceVars?.attackRange ?? 1;
      console.log('[isTargetable] 无法选中', i, 'dist=', effectiveDist(view.players, perspectiveIdx, i), 'range=', range);
    }
    return result;
  }



  // 当前是否需要选目标(出牌或使用技能时)
  // 转化模式按 wrapperName(如杀)决定;普通出牌按原牌名
  const selectedNeedsTarget = (transformMode && selectedCardId)
    ? TARGET_REQUIRED_CARDS.has(transformMode.wrapperName)
    : selectedCard
      ? TARGET_REQUIRED_CARDS.has(selectedCard.name)
      : false;

  // 出牌
  /** 玩家名 → 座次下标(UI 层用 name,dispatch 时转 index) */
  function nameToIndex(name: string): number {
    return view.players.findIndex(p => p.name === name);
  }

  function handlePlayCard() {
    if (!selectedCardId) return;
    const card = perspectiveHand.find(c => c.id === selectedCardId);
    if (!card) return;
    if (RESPOND_ONLY_CARDS.has(card.name)) return; // 不能主动出
    const selfName = view.players[view.viewer].name;
    const needsTarget = TARGET_REQUIRED_CARDS.has(card.name);
    const needsTwoTargets = TWO_TARGET_CARDS.has(card.name);
    if (needsTarget && !selectedTarget) return; // 需要目标但没选
    if (needsTwoTargets && (!selectedTarget || !selectedKillTarget)) return; // 需两个目标
    const targetName = selectedTarget ?? (SELF_TARGET_CARDS.has(card.name) ? selfName : undefined);
    const params: Record<string, Json> = { cardId: card.id };
    if (targetName) {
      const idx = nameToIndex(targetName);
      if (idx >= 0) {
        // 借刀杀人需要 A + B 两个目标,显式字段更清晰
        if (needsTwoTargets) {
          params.target = idx;
          if (selectedKillTarget) {
            const kIdx = nameToIndex(selectedKillTarget);
            if (kIdx >= 0) params.killTarget = kIdx;
          }
        } else if (isDelayedTrick(card)) {
          // 延时锦囊 validate 用单数 target
          params.target = idx;
        } else {
          // 其他牌用 targets 数组(与杀、过河拆桥等对齐)
          params.targets = [idx];
        }
      }
    }
    // ─── 出牌飞行动画:在 card 消失前捕获位置,生成浮动元素 ───
    const cardEl = handListRef.current?.querySelector(`[data-card-id="${card.id}"]`) as HTMLElement | null;
    if (cardEl) {
      createCardFlyAnimation(cardEl, card);
    }
    // 装备牌统一走"装备通用" skillId,其他牌走 card.name
    const skillId = card.type === '装备牌' ? '装备通用' : card.name;
    send(skillId, 'use', params);
  }

  // 选目标(含距离检查)
  function handleTargetClick(name: string) {
    const idx = view.players.findIndex(p => p.name === name);
    if (idx >= 0 && !isTargetable(idx)) return; // 距离外,禁止选中
    setSelectedTarget(selectedTarget === name ? null : name);
  }

  // 借刀杀人:两阶段目标选择(A = 持武器人,B = 被 A 杀的人)
  // 点 A:设 selectedTarget;点 B:设 selectedKillTarget;点 A 再次:清除 B
  function handleTwoTargetClick(name: string, which: 'A' | 'B') {
    if (which === 'A') {
      if (selectedTarget === name) {
        // 取消选 A,同时清 B
        setSelectedTarget(null);
        setSelectedKillTarget(null);
      } else {
        // 切换 A,清 B
        setSelectedTarget(name);
        setSelectedKillTarget(null);
      }
    } else {
      // 选 B(允许再次点 B 取消)
      setSelectedKillTarget(selectedKillTarget === name ? null : name);
    }
  }

  /** from 是否能攻击 to(纯函数,用于借刀杀人 B 选择范围限制) */
  // ─── 武将技能使用(基于 ActionPrompt 类型驱动) ───
  function handleSkillAction(action: SkillActionDef) {
    const { skillId, actionType, prompt } = action;
    const params: Record<string, Json> = {};

    switch (prompt.type) {
      case 'useCard':
        // 选牌型:需要 selectedCardId
        if (!selectedCardId) return;
        params.cardId = selectedCardId;
        params.cardIds = [selectedCardId]; // 兼容多牌技能(如制衡)的单牌调用
        break;
      case 'selectTarget':
        // 选目标型:需要 selectedTarget
        if (!selectedTarget) return;
        params.target = nameToIndex(selectedTarget);
        break;
      case 'useCardAndTarget':
        // 选牌+选目标型
        // 转化技能(如武圣):进入转化模式,用户从手牌中选匹配卡牌后再选目标
        if (action.transform) {
          if (prompt.cardFilter?.filter) {
            // 用第一张手牌中匹配的牌调用 transform,得到 wrapper.name(如“杀”)
            const sample = perspectiveHand.find(c => prompt.cardFilter!.filter!(c));
            const wrapperName = sample
              ? action.transform(sample).name
              : action.skillId;
            setTransformMode({
              skillId,
              actionType,
              cardFilter: prompt.cardFilter.filter,
              wrapperName,
            });
            setSelectedCardId(null);
            setSelectedTarget(null);
            return;
          }
        }
        if (!selectedCardId) return;
        if (!selectedTarget) return;
        {
          const idx = nameToIndex(selectedTarget);
          if (idx < 0) return;
          params.cardId = selectedCardId;
          // 延时锦囊 validate 用单数 target;其他牌用 targets 数组
          const trickCard = perspectiveHand.find(c => c.id === selectedCardId);
          if (trickCard && isDelayedTrick(trickCard)) {
            params.target = idx;
          } else {
            params.targets = [idx];
          }
        }
        break;
      case 'confirm':
        // 确认型:直接发送
        break;
      case 'choosePlayer':
        // 选玩家型:需要 selectedTarget
        if (!selectedTarget) return;
        params.target = nameToIndex(selectedTarget);
        break;
      case 'distribute':
        // 分配型(仁德/制衡):进入 distributeMode,由弹窗 UI 选牌/分配后提交
        setDistributeMode({ skillId, actionType, prompt });
        setSelectedCardId(null);
        setSelectedTarget(null);
        return;
      default:
        break;
    }

    send(skillId, actionType, params);
    setSelectedCardId(null);
    setSelectedTarget(null);
  }

  // ─── 转化模式:选完目标后,提交 preceding=[transform] + 转化后的牌.use ───
  function handleTransformPlay(targetName: string) {
    if (!transformMode || !selectedCardId) return;
    const targetCard = perspectiveHand.find(c => c.id === selectedCardId);
    if (!targetCard) return;
    const idx = nameToIndex(targetName);
    if (idx < 0) return;
    const shadowCardId = `${selectedCardId}#${transformMode.skillId}`;
    // 转化后的主出牌:wrapper.name(use),preceding=[武圣.transform]
    send(transformMode.wrapperName, 'use', { cardId: shadowCardId, targets: [idx] }, [{
      skillId: transformMode.skillId,
      actionType: transformMode.actionType,
      params: { cardId: selectedCardId },
    }]);
    setTransformMode(null);
    setSelectedCardId(null);
    setSelectedTarget(null);
  }

  // pending → respond 信息推导(skillId + cardFilter)已抽到 utils/pendingRespond.ts

  // 回应
  function handleRespond(cardId?: string) {
    if (!pending) return;
    // 弃牌窗口超时:按顺序弃超出的牌（与 engine 超时回退一致：取最后 discardMin 张）
    if (isDiscardPhase) {
      if (selectedForDiscard.size >= discardMin) {
        handleConfirmDiscard();
      } else {
        const hand = perspectiveHand;
        const fallback = hand.slice(-discardMin).map(c => c.id);
        send('系统规则', 'respond', { cardIds: fallback });
        setSelectedForDiscard(new Set());
      }
      return;
    }
    const info = resolvePendingRespond(pending, skillActions);
    if (!info) return;
    if (cardId) {
      // 校验:点的牌必须匹配 pending 的 cardFilter(防询问闪时点杀)
      const card = perspectiveHand.find(c => c.id === cardId);
      if (!card) return;
      if (info.cardFilter && !info.cardFilter(card)) return; // 不匹配,忽略
      send(info.skillId, 'respond', { cardId });
    } else if (pendingTargetIdx < 0) {
      // 广播型 pending(如无懈可击 target=-2):"不回应"不发 action,仅本地标记跳过。
      // slot 继续等待其他玩家回应或超时,不能通过空 respond resolve 广播 slot。
      setSkippedBroadcast(prev => new Set(prev).add(pending!.atom?.type + ':' + (pending!.atom as { requestType?: string }).requestType));
    } else {
      // 单 target pending:空 respond(后端 execute 收到空 cardId → 不做操作)
      send(info.skillId, 'respond', {});
    }
  }

  // 结束回合
  function handleEndTurn() {
    if (!isMyTurn) return;
    send('回合管理', 'end', {});
  }

  // 弃牌(暂未实现UI)
  // function handleDiscard() { ... }

  // 选牌
  function handleCardClick(card: Card) {
    // 弃牌窗口:切换弃牌选中状态
    if (isDiscardPhase && isPerspectiveAwaiting && canOperate) {
      setSelectedForDiscard(prev => {
        const next = new Set(prev);
        if (next.has(card.id)) {
          next.delete(card.id);
          return next;
        }
        if (next.size >= discardMax) return prev; // 已达上限,不增加
        next.add(card.id);
        return next;
      });
      return;
    }
    // 回应模式(只有自己视角才能操作)
    if (isMyAwaiting) {
      // 只允许点击匹配当前 pending cardFilter 的牌(通用,不硬编码技能名)
      const info = resolvePendingRespond(pending, skillActions);
      if (info && info.cardFilter) {
        if (info.cardFilter(card)) handleRespond(card.id);
      }
      return;
    }
    // 转化模式(如武圣):只允许点击匹配的卡牌作为“被转化的原牌”
    if (transformMode && isMyTurn && canOperate) {
      if (!transformMode.cardFilter(card)) return; // 过滤不匹配的牌
      if (selectedCardId === card.id) {
        setSelectedCardId(null);
        setSelectedTarget(null);
      } else {
        setSelectedCardId(card.id);
        setSelectedTarget(null);
      }
      return;
    }
    // 出牌模式(只有自己回合才能操作)
    if (!isMyTurn || !canOperate) return;
    if (selectedCardId === card.id) {
      setSelectedCardId(null);
      setSelectedTarget(null);
    } else {
      setSelectedCardId(card.id);
      setSelectedTarget(null);
    }
  }

  // 确认弃牌
  function handleConfirmDiscard() {
    if (!pending || !isDiscardPhase) return;
    if (selectedForDiscard.size < discardMin || selectedForDiscard.size > discardMax) return;
    const cardIds = Array.from(selectedForDiscard);
    send('系统规则', 'respond', { cardIds });
    setSelectedForDiscard(new Set());
  }

  // 选弃牌(暂未实现UI)
  // function toggleDiscard(cardId: string) { ... }

  // 座位排列: 自己始终在 result[0]（底部中央）；
  // 其余玩家从“上家”开始逆时针排，这样弧形座位按 leftPct 从左到右呈现
  //   [上家(左) ... 下家(右)]
  // 符合三国杀惯例：自己正对面为逆时针出牌方向，自己的下家在右手侧。
  const orderedPlayers = useMemo(() => {
    const n = view.players.length;
    if (n === 0) return [] as typeof view.players;
    const result: typeof view.players = [view.players[perspectiveIdx]];
    for (let i = 1; i < n; i++) {
      // (perspectiveIdx - i + n) % n 走的是 [上家, 上上家, ..., 下家] 的逆时针路径
      result.push(view.players[(perspectiveIdx - i + n) % n]);
    }
    return result;
  }, [view.players, perspectiveIdx]);


  // ─── 身份牌颜色映射(已迁入 gameViewConstants,这里从顶层导入) ───

  return (
    <div className={styles.pageRoot}>
          {/* ─── 身份揭示遮罩 ─── */}
      {/* 选将阶段(charSelectPending 或 charSelectInProgress)不显示身份弹窗——
          选将遮罩已含"你的身份"信息,身份弹窗 zIndex 更高会盖住选将界面和倒计时。
          选将完成后若仍未确认过身份,再显示。*/}
      {showIdentityReveal
        && view.players[view.viewer]?.identity
        && !isCharSelectPending
        && !charSelectInProgress && (
        <IdentityRevealOverlay
          identity={view.players[view.viewer].identity!}
          onConfirm={() => {
            setShowIdentityReveal(false);
            sessionStorage.setItem('sgs_identity_shown', '1');
          }}
        />
      )}
      {/* ─── 选将遮罩(读 view.pending) ─── */}
      {isCharSelectPending && charSelectTarget >= 0 && (
        <CharSelectOverlay
          candidates={charCandidates}
          charSelectTarget={charSelectTarget}
          isSelfSelecting={charSelectTarget === perspectiveIdx}
          isLord={view.players[charSelectTarget]?.identity === '主公'}
          viewer={perspectiveIdx}
          viewerIdentity={view.players[perspectiveIdx]?.identity}
          deadline={charSelectPending?.deadline ?? null}
          totalMs={charSelectPending?.totalMs ?? 60_000}
          getCharacterMeta={getCharacterMeta}
          onSelect={(characterName) => {
            // 发送选将 respond action 到引擎
            onAction({
              skillId: '系统规则',
              actionType: '选将',
              ownerId: charSelectTarget,
              params: { character: characterName },
            });
          }}
          perspectiveIdx={perspectiveIdx}
          playerCount={view.players.length}
          onSwitchPerspective={onSwitchPerspective}
          onGoToCurrentPlayer={onGoToCurrentPlayer}
          currentPlayerName={currentPlayerName}
          perspectiveName={perspectiveName}
          lordCharacter={view.players.find(p => p.identity === '主公')?.character}
        />
      )}

      {/* ─── 选将阶段等待遮罩(并行选将:当前视角玩家已选完但其他人还在选)─── */}
      {!isCharSelectPending && charSelectInProgress && perspectiveCharSelected && (
        <CharSelectWaitingOverlay
          view={view}
          perspectiveIdx={perspectiveIdx}
          perspectiveName={perspectiveName}
          onSwitchPerspective={onSwitchPerspective}
        />
      )}

      {/* ─── 头部 ─── */}
      <div className={styles.headerBar}>
        {onDeleteRoom && <button className={styles.backBtn} onClick={onDeleteRoom}>← 退出</button>}
        <div className={styles.headerCenter}>
          <span className={cx(styles.roundBadge, anim.turnVersion > 0 && styles.turnGlowing)} key={`turn-${anim.turnVersion}`}>第 {view.turn.round} 轮</span>
          <span className={cx(styles.phaseBadge, anim.phaseVersion > 0 && styles.phaseAnimating)} key={`phase-${anim.phaseVersion}`}>{PHASE_LABELS[view.phase] ?? view.phase}</span>
          <span className={styles.currentPlayerText}>
            当前: {currentPlayerName} {currentPlayer?.character ? `(${currentPlayer.character})` : ''}
          </span>
        </div>
        {/* debug 模式:视角切换 / 跳转 / 自动跟随(onSwitchPerspective 存在时才渲染) */}
        {onSwitchPerspective && (
          <div className={styles.headerRight}>
            <button className={styles.perspectiveBtn} onClick={onSwitchPerspective}>
              视角: {perspectiveName}
            </button>
            {onGoToCurrentPlayer && <button className={styles.goToBtn} onClick={onGoToCurrentPlayer}>查看当前玩家</button>}
            {autoSwitchCtl && (
              <button
                className={cx(styles.goToBtn, autoSwitchCtl.enabled && styles.autoSwitchActive)}
                onClick={autoSwitchCtl.toggle}
              >
                自动切换{autoSwitchCtl.enabled ? '✓' : '✗'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── 操作提示 ─── */}
      {/* 优先级: 弃牌 pending > 回应 pending > 出牌/弃牌阶段提示 */}
      {/* 选将期间不渲染 promptBox — CharSelectOverlay 已覆盖全屏,避免弹窗视觉干扰 */}
      {isPerspectiveAwaiting && pending && !isDiscardPhase && pending?.atom?.type !== '选将询问' && (() => {
        // 广播型 pending 且已本地跳过:显示已跳过提示
        const isBroadcast = pendingTargetIdx < 0;
        const broadcastKey = `${pending.atom?.type}:${(pending.atom as { requestType?: string }).requestType}`;
        const isSkipped = isBroadcast && skippedBroadcast.has(broadcastKey);
        return (
          <div className={styles.promptBoxAwaiting}>
            <div className={styles.promptTitle}>⚡ 需要回应 — {perspectiveName}</div>
            <div className={styles.promptDesc}>
              {pending.prompt.title}
              {pending.prompt.description && <span> — {pending.prompt.description}</span>}
            </div>
            {isSkipped ? (
              <div className={styles.waitingHint}>已跳过，等待其他玩家回应...</div>
            ) : canOperate ? (() => {
              // distribute 类 pending(遗计分配):渲染分配 UI
              if (pending.prompt.type === 'distribute') {
                const info = resolvePendingRespond(pending, skillActions);
                const skillId = info?.skillId ?? '系统规则';
                const cardIds = (pending.prompt as { cardIds?: string[] }).cardIds ?? [];
                return <DistributeUI skillId={skillId} actionType="respond" prompt={pending.prompt} cardIds={cardIds} players={view.players} viewer={perspectiveIdx} onSend={send} cardMap={view.cardMap} />;
              }
              // confirm 类 pending(反馈/遗计确认/八卦阵):渲染 发动/不发动 按钮
              if (pending.prompt.type === 'confirm') {
                const confirmLabel = pending.prompt.confirmLabel || '确认';
                const cancelLabel = pending.prompt.cancelLabel || '取消';
                const info = resolvePendingRespond(pending, skillActions);
                const skillId = info?.skillId ?? '系统规则';
                return (
                  <div className={styles.promptActions}>
                    <button className={styles.promptBtnPrimary} onClick={() => send(skillId, 'respond', { choice: true })}>{confirmLabel}</button>
                    <button className={styles.promptBtn} onClick={() => send(skillId, 'respond', { choice: false })}>{cancelLabel}</button>
                  </div>
                );
              }
              // useCard 类 pending:渲染 可出的牌按钮 + 不回应
              const info = resolvePendingRespond(pending, skillActions);
              const filterFn = info?.cardFilter;
              const respondableCards = filterFn ? perspectiveHand.filter(filterFn) : [];
              return (
                <div className={styles.promptActions}>
                  <button className={styles.promptBtn} onClick={() => handleRespond()}>不回应</button>
                  {respondableCards.map(c => (
                    <button key={c.id} className={styles.promptBtnPrimary} onClick={() => handleRespond(c.id)}>
                      {c.name} {c.suit}{c.rank}
                    </button>
                  ))}
                </div>
              );
            })() : (
              <div className={styles.waitingHint}>等待 {perspectiveName} 回应...</div>
            )}
          </div>
        );
      })()}

      {!isPerspectiveTurn && !isPerspectiveAwaiting && !isDiscardPhase && (
        <div className={styles.waitingHint}>等待 {currentPlayerName} 操作...</div>
      )}
      {isPerspectiveTurn && view.phase === '出牌' && !isPerspectiveAwaiting && !isDiscardPhase && (
        <div className={styles.promptBox}>
          <div className={styles.promptTitle}>🃏 {perspectiveName}的回合 — 出牌阶段</div>
          <div className={styles.promptDesc}>
            {canOperate && selectedCardId
              ? selectedTarget
                ? `已选择目标: ${selectedTarget}，点击「出牌」确认`
                : '已选牌，可选择目标或直接出牌'
              : canOperate
                ? '选择一张手牌出牌，或点击「结束回合」'
                : `${perspectiveName} 正在思考...`}
          </div>
        </div>
      )}
      {/* distribute 主动技弹窗(仁德/制衡):点击技能按钮后进入此模式 */}
      {distributeMode && canOperate && isMyTurn && view.phase === '出牌' && (() => {
        const { skillId, actionType, prompt } = distributeMode;
        // 按 source 解析可选牌列表(手牌/装备都是 Card 对象,取 .id)
        let cardIds: string[];
        if (Array.isArray(prompt.cardIds) && prompt.cardIds.length > 0) {
          cardIds = prompt.cardIds;
        } else if (prompt.source === 'handAndEquip') {
          const equipIds = Object.values(perspectivePlayer?.equipment ?? {});
          cardIds = [...perspectiveHand.map(c => c.id), ...equipIds];
        } else {
          cardIds = perspectiveHand.map(c => c.id);
        }
        return (
          <div className={styles.promptBoxAwaiting}>
            <div className={styles.promptTitle}>🤝 {prompt.title}</div>
            <DistributeUI
              skillId={skillId}
              actionType={actionType}
              prompt={prompt}
              cardIds={cardIds}
              players={view.players}
              viewer={perspectiveIdx}
              onSend={sendDistribute}
              cardMap={view.cardMap}
            />
            <div className={styles.distributeCancelRow}>
              <button className={styles.cancelBtn} onClick={() => setDistributeMode(null)}>取消</button>
            </div>
          </div>
        );
      })()}
      {isPerspectiveTurn && view.phase === '弃牌' && !isPerspectiveAwaiting && !isDiscardPhase && (
        <div className={styles.promptBox}>
          <div className={styles.promptTitle}>🗑️ {perspectiveName} — 弃牌阶段</div>
          <div className={styles.promptDesc}>{canOperate ? '请弃置多余的手牌' : `${perspectiveName} 正在弃牌...`}</div>
        </div>
      )}
      {isDiscardPhase && isPerspectiveAwaiting && (
        <div className={styles.promptBoxAwaiting}>
          <div className={styles.promptTitle}>🗑️ 弃牌阶段:需弃 {discardMin} 张牌（已选 {selectedForDiscard.size}/{discardMin}）</div>
          <div className={styles.promptDesc}>
            {canOperate
              ? discardMin === discardMax
                ? `请选择 ${discardMin} 张手牌弃置`
                : `请选择 ${discardMin}–${discardMax} 张手牌弃置`
              : `等待 ${perspectiveName} 弃牌...`}
          </div>
          {canOperate && (
            <div className={styles.promptActions}>
              <button
                className={styles.promptBtnPrimary}
                disabled={selectedForDiscard.size < discardMin || selectedForDiscard.size > discardMax}
                onClick={handleConfirmDiscard}
              >
                确认弃牌 ({selectedForDiscard.size}/{discardMin})
              </button>
              {selectedForDiscard.size > 0 && (
                <button className={styles.promptBtn} onClick={() => setSelectedForDiscard(new Set())}>
                  清空选择
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── 座位布局(弧形) ─── */}
      <div className={styles.seatingArea}>
        {/* 其他玩家沿弧形排列 */}
        <div className={styles.seatArcContainer}>
          {orderedPlayers.slice(1).length > 0 && orderedPlayers.slice(1).map((player, i) => {
            const totalOthers = orderedPlayers.length - 1;
            const realIdx = view.players.findIndex(p => p.name === player.name);
            // 沿 180° 弧形分布: 左端5% 右端95%, Y轴弧线中间高两端低
            const t = totalOthers <= 1 ? 0.5 : i / (totalOthers - 1);
            const leftPct = 5 + 90 * t;
            const arcH = 1 - Math.cos(Math.PI * t); // 0→1→0
            const topPct = 55 - 52 * arcH * 0.5;
            return (
              <div
                key={player.name}
                className={styles.seatArcSlot}
                style={{ left: `${leftPct}%`, top: `${topPct}%` }}
              >
                <PlayerSeatView
                  player={player}
                  index={realIdx}
                  view={view}
                  isCurrentPlayer={player.name === currentPlayerName}
                  isPerspective={player.name === perspectiveName}
                  needsTarget={selectedNeedsTarget}
                  isTargetable={isTargetable(realIdx)}
                  selectedTarget={selectedTarget}
                  onTargetClick={handleTargetClick}
                  onPerspectiveChange={(idx) => { onPerspectiveChange?.(idx); }}
                  isDamaged={anim.damageFlashIndices.has(realIdx)}
                  damageVersion={anim.damageFlashIndices.get(realIdx) ?? 0}
                  isTurnGlow={player.name === currentPlayerName && anim.turnVersion > 0}
                  turnGlowVersion={anim.turnVersion}
                />
              </div>
            );
          })}
        </div>

        {/* 中央信息区 */}
        <div className={styles.centerMeta}>
          <div className={styles.metaText}>
            牌堆: {view.zones?.deckCount ?? Object.keys(view.cardMap).length} 张
          </div>
          {/* 处理区:中间结算的牌(判定牌 / 闪抵消杀) */}
          {(() => {
            const procIds = view.zones?.processing ?? [];
            if (procIds.length === 0) return null;
            return (
              <div className={styles.processingRow} title="处理区:正在结算的中间牌(判定/抵消等)">
                <span className={styles.processingLabel}>处理区:</span>
                {procIds.map((cardId: string) => {
                  const card = view.cardMap[cardId];
                  if (!card) return null;
                  const suitColor = SUIT_COLOR[card.suit] ?? '#ccc';
                  const desc = card.description ?? '';
                  return (
                    <span
                      key={cardId}
                      className={styles.processingTag}
                      style={{ color: suitColor, borderColor: suitColor }}
                      title={desc || card.name}
                    >
                      {card.name} {card.suit}{card.rank}
                    </span>
                  );
                })}
              </div>
            );
          })()}
          {/* 弃牌堆:右上角一个小图标 + 数字 */}
          <div className={styles.discardPileRow}>
            <span
              className={styles.discardPileIcon}
              title="弃牌堆"
            >
              🗂
            </span>
            <span className={styles.discardPileCount}>
              弃牌: {view.zones?.discardPileCount ?? 0}
            </span>
          </div>
        </div>
      </div>

      {/* ─── 下方主区域：左 角色大卡 / 右 手牌+操作 ─── */}
      <div className={styles.bottomLayout}>
        {/* ─── 左：角色大卡（势力/身份/体力/技能/装备） ─── */}
        <div className={styles.playerCardLarge}>
          <PlayerCardLarge
            perspectiveIdx={perspectiveIdx}
            viewer={view.viewer}
            view={view}
            damageFlashIndices={anim.damageFlashIndices}
            isMyTurn={isMyTurn}
            canOperate={canOperate}
            isPerspectiveTurn={isPerspectiveTurn}
            skillActions={skillActions}
            onSkillAction={handleSkillAction}
          />
        </div>

        {/* ─── 右：手牌 + 统一倒计时 + 操作 + 目标 ─── */}
        <div className={styles.handColumn}>
          {/* 统一倒计时进度条（顺滑） */}
          <CountdownBar deadline={deadline} totalMs={pending?.totalMs ?? DEFAULT_COUNTDOWN_TOTAL_MS} />
          {/* 转化模式提示 + 取消选择 */}
          <div className={styles.handHeader}>
            <span className={styles.handTitle}>
              {perspectiveName} 的手牌 ({perspectiveHand.length})
              {perspectiveIdx !== view.viewer && <span className={styles.debugHint}> (调试视角)</span>}
              {transformMode && (
                <span className={cx(styles.debugHint, styles.transformHint)}>
                  ⚡ 转化模式:选1张{transformMode.wrapperName} · 源技能 {transformMode.skillId}
                </span>
              )}
            </span>
            {transformMode && (
              <button className={styles.cancelBtn} onClick={() => {
                setTransformMode(null);
                setSelectedCardId(null);
                setSelectedTarget(null);
              }}>
                取消转化
              </button>
            )}
            {!transformMode && selectedCardId && (
              <button className={styles.cancelBtn} onClick={() => { setSelectedCardId(null); setSelectedTarget(null); }}>
                取消选择
              </button>
            )}
          </div>
          {/* 操作面板：出牌/结束回合/目标提示 */}
          <div className={styles.actionBar}>
            {canOperate && isMyTurn && view.phase === '出牌' && transformMode && selectedCardId && (
              <button className={cx(styles.playBtn, !selectedTarget && styles.btnDisabled)} onClick={() => selectedTarget && handleTransformPlay(selectedTarget)} disabled={!selectedTarget}>
                使用{transformMode.wrapperName}{selectedTarget ? ` → ${selectedTarget}` : ' (请选目标)'}
              </button>
            )}
            {canOperate && isMyTurn && view.phase === '出牌' && !transformMode && selectedCardId && (() => {
              const card = perspectiveHand.find(c => c.id === selectedCardId);
              const needsTarget = card ? TARGET_REQUIRED_CARDS.has(card.name) : false;
              const needsTwoTargets = card ? TWO_TARGET_CARDS.has(card.name) : false;
              const canPlay = needsTwoTargets
                ? (!!selectedTarget && !!selectedKillTarget)
                : (!needsTarget || !!selectedTarget);
              const targetLabel = needsTwoTargets
                ? (selectedTarget && selectedKillTarget
                  ? ` → A=${selectedTarget} B=${selectedKillTarget}`
                  : ' (请选 A/B 两个目标)')
                : (selectedTarget ? ` → ${selectedTarget}` : needsTarget ? ' (请选目标)' : '');
              return <button className={cx(styles.playBtn, !canPlay && styles.btnDisabled)} onClick={handlePlayCard} disabled={!canPlay}>
                出牌{targetLabel}
              </button>;
            })()}
            {canOperate && isMyTurn && (view.phase === '出牌' || view.phase === '弃牌') && (
              <button className={styles.endTurnBtn} onClick={handleEndTurn}>结束回合</button>
            )}
            {selectedCardId && selectedTarget && canOperate && isMyTurn && (
              <div className={styles.targetHint}>已选择目标: {selectedTarget}</div>
            )}
          </div>
          {/* 目标选择 — 需要目标的牌或转化模式(转化的目标牌可能需要目标) */}
          {(selectedCardId && canOperate && isMyTurn && !pending && (() => {
            // 转化模式:检查 wrapperName 是否需要目标
            if (transformMode) {
              return TARGET_REQUIRED_CARDS.has(transformMode.wrapperName)
                || RANGE_REQUIRED_CARDS.has(transformMode.wrapperName);
            }
            const card = perspectiveHand.find(c => c.id === selectedCardId);
            return card && TARGET_REQUIRED_CARDS.has(card.name);
          })()) && (() => {
            const card = perspectiveHand.find(c => c.id === selectedCardId);
            const cardName = card?.name ?? '';
            // 借刀杀人: 两步目标(先 A:有武器的相邻玩家,再 B:被 A 杀的人)
            // 简化为 A 可被任何存活非自己角色选, B 可被任何存活非自己且 ≠ A 选(距离 A≤1 规则)
            // 这里仅前端限制;服务端 validate 会严格检查。
            const isTwoTarget = TWO_TARGET_CARDS.has(cardName);
            return (
              <div className={styles.targetSection}>
                {isTwoTarget ? (
                  <>
                    <div className={styles.targetTitle}>
                      ① 选 A 角色(装备区有武器):
                      {selectedTarget && <span className={styles.selectedTargetText}>{selectedTarget}</span>}
                    </div>
                    <div className={styles.targetList}>
                      {view.players.map((p, i) => {
                        if (!p.alive || i === perspectiveIdx) return null;
                        const targetable = true; // A 选择不卡距离
                        return (
                          <button
                            key={i}
                            className={cx(styles.targetBtn, selectedTarget === p.name && styles.targetBtnActive, !targetable && styles.targetBtnDisabled)}
                            disabled={!targetable}
                            onClick={() => handleTwoTargetClick(p.name, 'A')}
                          >
                            {p.name} ({p.character}) ♥{p.health}
                          </button>
                        );
                      })}
                    </div>
                    {selectedTarget && (
                      <>
                        <div className={cx(styles.targetTitle)} style={{ marginTop: 8 }}>
                          ② 选 B 角色(A 对其出杀):
                          {selectedKillTarget && <span className={styles.selectedTargetText}>{selectedKillTarget}</span>}
                        </div>
                        <div className={styles.targetList}>
                          {view.players.map((p, i) => {
                            if (!p.alive || i === perspectiveIdx) return null;
                            if (p.name === selectedTarget) return null; // 不能选 A 当 B
                            const aIdx = view.players.findIndex(x => x.name === selectedTarget);
                            // B 必须在 A 攻击范围内(在范围内 = 可被出杀)
                            const inAARange = aIdx >= 0 ? canAttack(view.players, view.cardMap, aIdx, i) : false;
                            return (
                              <button
                                key={i}
                                className={cx(styles.targetBtn, selectedKillTarget === p.name && styles.targetBtnActive, !inAARange && styles.targetBtnDisabled)}
                                disabled={!inAARange}
                                onClick={() => handleTwoTargetClick(p.name, 'B')}
                              >
                                {p.name} ({p.character}) ♥{p.health}
                                {!inAARange && <span className={styles.mutedHint}>距离外</span>}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div className={styles.targetTitle}>选择目标:</div>
                    <div className={styles.targetList}>
                      {view.players.map((p, i) => {
                        if (!p.alive || i === perspectiveIdx) return null;
                        const targetable = isTargetable(i);
                        return (
                          <button
                            key={i}
                            className={cx(styles.targetBtn, selectedTarget === p.name && styles.targetBtnActive, !targetable && styles.targetBtnDisabled)}
                            disabled={!targetable}
                            onClick={() => transformMode ? handleTransformPlay(p.name) : handleTargetClick(p.name)}
                          >
                            {p.name} ({p.character}) ♥{p.health}
                            {!targetable && <span className={styles.mutedHint}>距离外</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          {/* 手牌区 */}
          <div className={styles.handList} ref={handListRef}>
            {perspectiveHand.map((card, i) => {
              const isSelected = selectedCardId === card.id;
              const isDiscardSelected = selectedForDiscard.has(card.id);
              const canPlay = isMyTurn && canOperate;
              const isAwaiting = isMyAwaiting && (() => {
                const info = resolvePendingRespond(pending, skillActions);
                return !!info?.cardFilter?.(card);
              })();
              const canDiscardClick = isDiscardPhase && isPerspectiveAwaiting && canOperate;
              const isTransformMatch = transformMode !== null && transformMode.cardFilter(card);
              const isTransformActive = transformMode !== null && isMyTurn && canOperate;
              const isTransformDisabled = isTransformActive && !isTransformMatch;
              const canClick = canPlay || isAwaiting || canDiscardClick || isTransformActive;
              const suitColor = SUIT_COLOR[card.suit] ?? '#ccc';
              const isNew = anim.newCardIds.has(card.id);
              const displayName = isTransformMatch && transformMode ? transformMode.wrapperName : card.name;
              const totalHand = perspectiveHand.length;
              const fanAngle = totalHand > 1 ? -10 + 20 * (i / (totalHand - 1)) : 0;
              return (
                <div
                  key={card.id}
                  data-card-id={card.id}
                  className={cx(
                    styles.handCard,
                    isSelected && styles.handCardSelected,
                    (!canPlay && !isAwaiting && !canDiscardClick && !isTransformActive) && styles.handCardDisabled,
                    isAwaiting && styles.handCardRespondable,
                    isDiscardSelected && styles.discardCardSelected,
                    isNew && styles.handCardNew,
                    isTransformMatch && styles.handCardTransform,
                    isTransformDisabled && styles.handCardTransformDisabled,
                  )}
                  style={{ transform: `rotate(${fanAngle}deg)`, zIndex: i }}
                  onClick={() => canClick && !isTransformDisabled && handleCardClick(card)}
                  title={
                    isTransformMatch && transformMode
                      ? `${displayName} ${card.suit}${card.rank}\n(原:${card.name}) ${card.description ?? ''}`.trim()
                      : `${card.name} ${card.suit}${card.rank}\n${card.description ?? ''}`
                  }
                >
                  <div className={styles.cardName} style={{ color: suitColor }}>{displayName}</div>
                  {isTransformMatch && transformMode && (
                    <div className={styles.cardOrigin} style={{ color: suitColor }}>(原: {card.name})</div>
                  )}
                  <div className={styles.cardSuit} style={{ color: suitColor }}>{card.suit}{card.rank}</div>
                </div>
              );
            })}
            {perspectiveHand.length === 0 && <div className={styles.emptyHand}>无手牌</div>}
          </div>
        </div>
      </div>

      {/* ─── 游戏日志(正常功能,非 debug 专属) ─── */}
      <GameLog view={view} />
    </div>
  );
}


