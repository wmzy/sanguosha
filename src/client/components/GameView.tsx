// src/client/components/GameView.tsx
// 新 ENGINE-DESIGN 完整游戏界面 — 参照老 GameBoard + DebugPlayerList 设计
//
// 布局: GameHeader → 提示区 → 座位弧形(其他玩家) → [左:角色大卡 | 右:倒计时+操作+目标+手牌] → 日志/调试面板
// 特性: 视角切换、顺滑倒计时、装备区独立、座位布局、主动技点击、手牌选择、弃牌选择
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { cx } from '@linaria/core';
import * as styles from './gameViewStyles';
import type { GameView as EngineGameView, Card, Json, PendingView, EquipSlot, ActionPrompt, DistributePrompt } from '../../engine/types';
import { getActionsForPlayer, registerSkillActions, clearRegistry, findActionAcrossOwners, type SkillActionDef } from '../skillActionRegistry';
import { seatDistance, effectiveDist, canAttack } from '../utils/distance';
import { CountdownBar, DEFAULT_COUNTDOWN_TOTAL_MS } from './CountdownBar';
import { CharSelectOverlay } from './CharSelectOverlay';
import { IdentityRevealOverlay } from './IdentityRevealOverlay';
import { FACTION_BG, IDENTITY_COLORS, SUIT_COLOR } from './gameViewConstants';
import { getCharacterMeta } from '../../engine/character-meta';
import { DistributeUI } from './DistributeUI';
import { PlayerSeatView } from './PlayerSeatView';


// ─── ActionMsg: 发给 controller(不含 baseSeq) ───
interface ActionMsg {
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
  onDeleteRoom: () => void;
}

// ─── 阶段中文名 ───
const PHASE_LABELS: Record<string, string> = {
  '准备': '准备阶段', '判定': '判定阶段', '摸牌': '摸牌阶段',
  '出牌': '出牌阶段', '弃牌': '弃牌阶段', '回合结束': '回合结束',
};

// ─── 引擎声明的默认通用技能(技能按钮区/座位卡均过滤这些) ───
import { DEFAULT_SKILLS as ENGINE_DEFAULT_SKILLS } from '../../engine/atoms/选将';
import { isEquipment, isDelayedTrick, isRespondOnly, RANGE_REQUIRED_CARDS, TARGET_REQUIRED_CARDS, TWO_TARGET_CARDS, SELF_TARGET_CARDS, RESPOND_ONLY_CARDS } from '../../engine/card-meta';
const DEFAULT_SKILLS = new Set(ENGINE_DEFAULT_SKILLS);
const EQUIPMENT_SKILL_NAMES = new Set([
  '诸葛连弩', '青釭剑', '青龙偃月刀', '雌雄双股剑', '贯石斧',
  '丈八蛇矛', '方天画戟', '麒麟弓', '寒冰剑',
  '八卦阵', '仁王盾', '藤甲', '白银狮子',
  '赤兔', '紫骍', '大宛', '的卢', '绝影', '爪黄飞电',
]);

// ─── 时间格式化 ───
function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

import { useAnimationState } from '../hooks/useAnimationState';

// ─── 主组件 ───
export function GameViewComponent({ view, onAction, onDeleteRoom }: Props) {
  // 视角: 默认看自己,可切换
  const [perspectiveIdx, setPerspectiveIdx] = useState(view.viewer);
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
  // 选将遮罩:读 view.pending.atom.type === '选将询问'
  // 候选人从 view.pending.atom.candidates 获取(引擎生成)
  // debug 模式下并行选将:viewer 自己已选完时,view.pending 为空,
  // 从 view.allCharSelectSlots 按 perspectiveIdx 找对应玩家的选将 slot(代打)。
  // 第三层回退:slot 尚未为当前视角创建时,取第一个仍在选将的 slot,
  // 确保选将期间始终有遮罩覆盖全屏。
  const ownCharSelect = view.pending?.atom?.type === '选将询问' ? view.pending : null;
  const parallelSlotForPerspective = view.allCharSelectSlots?.find(
    s => s.atom.type === '选将询问' && s.target === perspectiveIdx,
  ) ?? null;
  const activeSlot = view.allCharSelectSlots?.find(
    s => s.atom.type === '选将询问' && !view.players[s.target]?.character,
  ) ?? null;
  const charSelectPending = ownCharSelect ?? parallelSlotForPerspective ?? activeSlot;
  const isCharSelectPending = charSelectPending !== null;
  const charCandidates: Array<{ name: string; skills: string[] }> = charSelectPending
    ? (charSelectPending.atom as { candidates: Array<{ name: string; skills: string[] }> }).candidates
    : [];
  const charSelectTarget = charSelectPending ? charSelectPending.target : -1;
  // 选将阶段进行中:仍有玩家未选将(character 为空)且游戏未进入第一回合(阶段准备)。
  // 用于并行选将场景:当前视角玩家已选完但其他人还在选时,显示"等待其他玩家选将"遮罩。
  const charSelectInProgress = view.phase === '准备'
    && view.players.some(p => !p.character);
  // 当前视角玩家是否已选将(debug 代打时随 perspectiveIdx 变化)
  const perspectiveCharSelected = !!view.players[perspectiveIdx]?.character;
  // ─── 动画状态 ───
  const anim = useAnimationState(view, perspectiveIdx);
  const handListRef = useRef<HTMLDivElement>(null);
  const prevPhaseForGlow = useRef(view.phase);

  // 自动视角切换开关(默认开,多 agent 协作时可关)
  const [autoSwitch, setAutoSwitch] = useState(true);
  // 选将期间用户手动切换过视角后,停止自动跟随选将 target
  const charSelectManualSwitchRef = useRef(false);
  const prevCharSelectTargetRef = useRef(-1);
  const pendingRef = useRef(view.pending);
  useEffect(() => { pendingRef.current = view.pending; }, [view.pending]);
  useEffect(() => {
    if (!view.pending) {
      charSelectManualSwitchRef.current = false;
      prevCharSelectTargetRef.current = -1;
    }
  }, [view.pending]);
  // 广播型 pending(如无懈可击)"不回应"后本地跳过标记,避免重复显示 prompt
  const [skippedBroadcast, setSkippedBroadcast] = useState<Set<string>>(new Set());

  // 有待回应请求时,自动切换视角到被问询玩家;无 pending 时回到当前回合玩家
  // 选将期间:自动跟随选将 target,但用户手动切换后停止跟随;
  //  charSelectTarget 变化(下一个玩家选将)时重置,继续跟随新 target。
  //  debug 并行选将:viewer 自己选完后 view.pending 为空,但 allCharSelectSlots 有其他玩家的 slot,
  //  自动跟到第一个未选完的玩家(代打),直到用户手动切换。
  useEffect(() => {
    if (!autoSwitch) return;
    const isCharSelect = view.pending?.atom?.type === '选将询问';
    if (isCharSelect) {
      const t = view.pending!.target;
      if (t !== prevCharSelectTargetRef.current) {
        prevCharSelectTargetRef.current = t;
        charSelectManualSwitchRef.current = false;
      }
      if (!charSelectManualSwitchRef.current && t >= 0 && t < view.players.length) {
        setPerspectiveIdx(t);
      }
      return;
    }
    // debug 并行选将:viewer 无 pending 但有并行选将 slot → 跟到第一个未选完的玩家
    if (charSelectInProgress && view.allCharSelectSlots && view.allCharSelectSlots.length > 0 && !charSelectManualSwitchRef.current) {
      const firstUnselectedSlot = view.allCharSelectSlots.find(s => !view.players[s.target]?.character);
      if (firstUnselectedSlot && firstUnselectedSlot.target >= 0 && firstUnselectedSlot.target < view.players.length) {
        setPerspectiveIdx(firstUnselectedSlot.target);
      }
      return;
    }
    if (view.pending) {
      const targetIdx = view.pending.target;
      if (targetIdx >= 0 && targetIdx < view.players.length) setPerspectiveIdx(targetIdx);
    } else if (!charSelectInProgress) {
      setPerspectiveIdx(view.currentPlayerIndex);
    }
  }, [view.pending?.target, view.currentPlayerIndex, autoSwitch, view.pending?.atom?.type, charSelectInProgress, view.allCharSelectSlots]);
  // 初次加载:默认看自己的座次(选将进行中时不覆盖,由上面的自动切换 effect 接管)
  useEffect(() => { if (!charSelectInProgress) setPerspectiveIdx(view.viewer); }, [view.viewer, charSelectInProgress]);

  const perspective = view.players[perspectiveIdx];
  const perspectiveName = perspective?.name ?? `P${perspectiveIdx}`;
  const isPerspectiveTurn = view.currentPlayerIndex === perspectiveIdx;
  // debug 模式:viewer 可以代打任何玩家,所以"是不是我的回合"以"正在看的玩家"为准
  const isMyTurn = isPerspectiveTurn;
  const isMyViewerTurn = view.currentPlayerIndex === view.viewer;
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

  // 视角玩家的手牌(debug 模式所有人可见)
  const perspectiveHand: Card[] = perspective?.hand ?? [];
  const viewerHand: Card[] = view.players[view.viewer]?.hand ?? [];

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
  // debug 模式:viewer 可以代打任何玩家;正式模式:必须视角=自己
  const canOperate = true; // debug 模式永远允许操作
  const isMyAwaiting = isPerspectiveAwaiting && canOperate;

// 倒计时:pending 回应优先,否则用 turnDeadline
  // 顺滑进度条由 CountdownBar (使用 useCountdownFraction + CSS transition) 渲染。
  const deadline = pending?.deadline ?? view.turnDeadline;
  // 注意:不在客户端 deadline<=0 时自动 respond/endTurn。
  // 旧逻辑是 debug 模式自动操作,但会导致「出杀时跳过问闪」——pending 刚渲染就被自动 handleRespond() 当作「不出」处理。
  // 现在依赖服务端真实超时(默认 15s):服务端 advance → view.pending 清空 → UI 自然恢复。

  // 切换视角
  const switchPerspective = useCallback(() => {
    const next = (perspectiveIdx + 1) % view.players.length;
    setPerspectiveIdx(next);
    setSelectedCardId(null);
    setSelectedTarget(null);
    setTransformMode(null);
    setDistributeMode(null);
    // 选将期间手动切换后,停止自动跟随
    if (pendingRef.current?.atom?.type === '选将询问') charSelectManualSwitchRef.current = true;
  }, [perspectiveIdx, view.players.length]);

  const goToCurrentPlayer = useCallback(() => {
    setPerspectiveIdx(view.currentPlayerIndex);
    setSelectedCardId(null);
    setSelectedTarget(null);
    setTransformMode(null);
    setDistributeMode(null);
  }, [view.currentPlayerIndex]);

  // 发送 action
  // debug 模式:以"正在看的玩家"作为 ownerId(代打)
  // 正式模式:必须以自己(viewer)为 ownerId
  /** 发送 action。preceding 用于组合 action(转化技:武圣红牌当杀) */
  const send = useCallback(
    (skillId: string, actionType: string, params: Record<string, Json>, preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>) => {
      const ownerId = perspectiveIdx;
      onAction({ skillId, actionType, ownerId, params, preceding });
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
  const selectedCard = selectedCardId ? (perspectiveHand.find(c => c.id === selectedCardId) ?? viewerHand.find(c => c.id === selectedCardId)) : null;

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
      let range = 1;
      if (fromP?.equipment?.['武器']) {
        const weapon = view.cardMap[fromP.equipment['武器']];
        if (weapon) range = weapon.range ?? 1;
      }
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
      const rect = cardEl.getBoundingClientRect();
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2 - 40;
      const flyDx = cx - rect.left - rect.width / 2;
      const flyDy = cy - rect.top - rect.height / 2;
      const floating = document.createElement('div');
      floating.style.cssText = `
        position: fixed; left: ${rect.left}px; top: ${rect.top}px;
        width: ${rect.width}px; height: ${rect.height}px;
        border: 2px solid #3498db; border-radius: 8px; padding: 10px 14px;
        background: rgba(22,33,62,0.95); color: #e0e0e0;
        text-align: center; pointer-events: none; z-index: 9999;
        --fly-dx: ${flyDx}px; --fly-dy: ${flyDy}px;
        animation: flyToCenter 0.45s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        box-shadow: 0 0 16px rgba(52,152,219,0.6);
      `;
      const nameDiv = document.createElement('div');
      nameDiv.style.cssText = `font-weight: bold; font-size: 15px; margin-bottom: 2px; color: ${SUIT_COLOR[card.suit] ?? '#ccc'};`;
      nameDiv.textContent = card.name;
      const suitDiv = document.createElement('div');
      suitDiv.style.cssText = `font-size: 12px; color: ${SUIT_COLOR[card.suit] ?? '#ccc'};`;
      suitDiv.textContent = `${card.suit}${card.rank}`;
      floating.appendChild(nameDiv);
      floating.appendChild(suitDiv);
      document.body.appendChild(floating);
      floating.addEventListener('animationend', () => floating.remove());
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
            const sample = perspectiveHand.find(c => prompt.cardFilter!.filter!(c))
              ?? viewerHand.find(c => prompt.cardFilter!.filter!(c));
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
          const trickCard = perspectiveHand.find(c => c.id === selectedCardId)
            ?? viewerHand.find(c => c.id === selectedCardId);
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
    const targetCard = perspectiveHand.find(c => c.id === selectedCardId) ?? viewerHand.find(c => c.id === selectedCardId);
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

  // 根据当前 pending 推导 respond 信息:
  // - skillId: 从 atom type/requestType 通用推导(询问X→X, 请求回应 requestType→skillId)
  // - cardFilter: 优先从 skillActionRegistry(本玩家或所有玩家)取;取不到则从 atom 类型本地重建
  //
  // 为什么不完全依赖 registry:
  //   registry 是 async 加载(dynamic import 技能模块);视角切换会触发 clearRegistry + 重注册,
  //   重注册期间(异步窗口)registry 是空的;React state 里还保留旧的列表,但旧列表可能因为
  //   perspectiveIdx 切换而不再包含目标玩家;此外 WS 走 JSON.stringify,后端 prompt 的
  //   cardFilter.filter 函数会被丢弃——前端拿不到原始函数引用。
  //   所以增加本地重建兜底:对当前所有 respond 提示(cardFilter 都是 c => c.name === '<cardName>')
  //   都能稳定构造。

  /** 从 SkillActionDef 的 prompt 提取 cardFilter 函数(不走 JSON 序列化,函数引用保留) */
  function extractCardFilterFromAction(action: SkillActionDef): ((c: Card) => boolean) | undefined {
    const p = action.prompt;
    if ((p.type === 'useCard' || p.type === 'useCardAndTarget') && p.cardFilter?.filter) {
      return p.cardFilter.filter;
    }
    return undefined;
  }

  /**
   * 从 atom 类型本地构造 cardFilter 函数(不依赖 registry)。
   * 当前所有 respond 提示的 filter 都是 `c => c.name === '<cardName>'`,
   * 包括:询问X → c.name==='X';请求回应 R/Y → c.name===R;请求回应 R → c.name===R;__弃牌 → ()=>true。
   */
  function deriveCardFilterFromAtom(atomType: string, reqType: string): ((c: Card) => boolean) | undefined {
    // 询问X (X∈{闪,杀,...}):X = atomType.slice(2)
    if (atomType.startsWith('询问')) {
      const cardName = atomType.slice(2);
      if (!cardName) return undefined;
      return (c) => c.name === cardName;
    }
    // 请求回应 / 并行回应:
    //   - 'R/Y' → R 是 cardName(R 例如 杀/forceKill, 杀/respondKill)
    //   - 'R'   → R 是 cardName(例如 无懈可击)
    //   - '__弃牌' → filter=()=>true(由 min/max 决定,前端另走 isDiscardPhase 路径)
    if (atomType === '请求回应' || atomType === '并行回应') {
      if (!reqType) return undefined;
      if (reqType === '__弃牌') return () => true;
      const slashIdx = reqType.indexOf('/');
      const cardName = slashIdx >= 0 ? reqType.slice(0, slashIdx) : reqType;
      if (!cardName) return undefined;
      return (c) => c.name === cardName;
    }
    return undefined;
  }

  /**
   * 从 skillActionRegistry(已注册的所有玩家 actions)中查找某 skillId 的 respond action。
   * 不限定 ownerId:当 perspective 切换期间,目标玩家的 action 可能已被清掉,
   * 但 React state 里 skillActions 还保留旧列表——这种情况下需要放宽 ownerId 匹配。
   */
  function findRespondAction(skillId: string): SkillActionDef | undefined {
    // 1. 优先当前 perspective 玩家(快路径,避免遍历整个 registry)
    const own = skillActions.find(a => a.skillId === skillId && a.actionType === 'respond');
    if (own) return own;
    // 2. 退路:跨所有 ownerId 扫描(registry 是模块级单例,不依赖 React state 时序)
    return findActionAcrossOwners(skillId, 'respond');
  }

  function pendingRespondInfo(): { skillId: string; cardFilter?: (c: Card) => boolean } | null {
    if (!pending) return null;
    const atom = pending.atom as Record<string, unknown>;
    const atomType = pending.atom?.type ?? '';
    const reqType = typeof atom['requestType'] === 'string' ? (atom['requestType'] as string) : '';

    // 通用推导 skillId
    let skillId: string | null = null;
    if (atomType.startsWith('询问')) {
      skillId = atomType.slice(2); // 询问闪→闪
    } else if (reqType === '__弃牌') {
      skillId = '系统规则';
    } else if (atomType === '请求回应' || atomType === '并行回应') {
      if (!reqType) return null;
      skillId = reqType.includes('/') ? reqType.slice(0, reqType.indexOf('/')) : (reqType || null);
    }
    if (!skillId) return null;

    // 1. 优先:从 registry(当前 perspective + 所有玩家)取 cardFilter
    const action = findRespondAction(skillId);
    const registryFilter = action ? extractCardFilterFromAction(action) : undefined;
    // 2. 兜底:从 atom 类型本地重建(不依赖 async 加载/registry 时序)
    const localFilter = deriveCardFilterFromAtom(atomType, reqType);
    const cardFilter = registryFilter ?? localFilter;

    return { skillId, cardFilter };
  }

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
    const info = pendingRespondInfo();
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
      const info = pendingRespondInfo();
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

  // 装备名
  function equipName(_slot: EquipSlot, cardId: string): string {
    const card = view.cardMap[cardId];
    return card?.name ?? cardId;
  }

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
          onSwitchPerspective={switchPerspective}
          onGoToCurrentPlayer={goToCurrentPlayer}
          currentPlayerName={currentPlayerName}
          perspectiveName={perspectiveName}
        />
      )}

      {/* ─── 选将阶段等待遮罩(并行选将:当前视角玩家已选完但其他人还在选)─── */}
      {!isCharSelectPending && charSelectInProgress && perspectiveCharSelected && (() => {
        // 从 allCharSelectSlots 取第一个仍在选将的 slot 的 deadline,用于倒计时
        const activeSlot = view.allCharSelectSlots?.find(
          s => s.atom.type === '选将询问' && !view.players[s.target]?.character,
        );
        const selectDeadline = activeSlot?.deadline ?? null;
        const selectTotalMs = activeSlot?.totalMs ?? 60_000;
        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9998,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.9)',
              color: '#f1c40f',
              fontSize: 18,
              gap: 12,
            }}
          >
            <div>⏳ {perspectiveName} 已选择武将,等待其他玩家选将...</div>
            <div style={{ fontSize: 13, color: '#aaa' }}>
              {view.players.filter(p => !p.character).map(p => p.name).join('、')} 正在选将
            </div>
            {/* 选将倒计时 */}
            <div style={{ width: 300, marginTop: 8 }}>
              <CountdownBar deadline={selectDeadline} totalMs={selectTotalMs} />
            </div>
            {/* debug 模式:切换到未选玩家代其选将 */}
            <button
              onClick={switchPerspective}
              style={{
                marginTop: 16,
                padding: '8px 18px',
                fontSize: 14,
                fontWeight: 'bold',
                color: '#fff',
                background: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              切换视角 → {view.players[(perspectiveIdx + 1) % view.players.length]?.name}
            </button>
          </div>
        );
      })()}

      {/* ─── 头部 ─── */}
      <div className={styles.headerBar}>
        <button className={styles.backBtn} onClick={onDeleteRoom}>← 退出</button>
        <div className={styles.headerCenter}>
          <span className={cx(styles.roundBadge, anim.turnVersion > 0 && styles.turnGlowing)} key={`turn-${anim.turnVersion}`}>第 {view.turn.round} 轮</span>
          <span className={cx(styles.phaseBadge, anim.phaseVersion > 0 && styles.phaseAnimating)} key={`phase-${anim.phaseVersion}`}>{PHASE_LABELS[view.phase] ?? view.phase}</span>
          <span className={styles.currentPlayerText}>
            当前: {currentPlayerName} {currentPlayer?.character ? `(${currentPlayer.character})` : ''}
          </span>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.perspectiveBtn} onClick={switchPerspective}>
            视角: {perspectiveName}
          </button>
          <button className={styles.goToBtn} onClick={goToCurrentPlayer}>查看当前玩家</button>
          <button
            className={styles.goToBtn}
            style={autoSwitch ? { background: '#27ae60', color: '#fff' } : undefined}
            onClick={() => setAutoSwitch(!autoSwitch)}
          >
            自动切换{autoSwitch ? '✓' : '✗'}
          </button>
        </div>
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
                const info = pendingRespondInfo();
                const skillId = info?.skillId ?? '系统规则';
                const cardIds = (pending.prompt as { cardIds?: string[] }).cardIds ?? [];
                return <DistributeUI skillId={skillId} actionType="respond" prompt={pending.prompt} cardIds={cardIds} players={view.players} viewer={perspectiveIdx} onSend={send} cardMap={view.cardMap} />;
              }
              // confirm 类 pending(反馈/遗计确认/八卦阵):渲染 发动/不发动 按钮
              if (pending.prompt.type === 'confirm') {
                const confirmLabel = pending.prompt.confirmLabel || '确认';
                const cancelLabel = pending.prompt.cancelLabel || '取消';
                const info = pendingRespondInfo();
                const skillId = info?.skillId ?? '系统规则';
                return (
                  <div className={styles.promptActions}>
                    <button className={styles.promptBtnPrimary} onClick={() => send(skillId, 'respond', { choice: true })}>{confirmLabel}</button>
                    <button className={styles.promptBtn} onClick={() => send(skillId, 'respond', { choice: false })}>{cancelLabel}</button>
                  </div>
                );
              }
              // useCard 类 pending:渲染 可出的牌按钮 + 不回应
              const info = pendingRespondInfo();
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
          const equipIds = Object.values(perspective?.equipment ?? {});
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
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
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
                  onPerspectiveChange={(idx) => { setPerspectiveIdx(idx); setSelectedCardId(null); setSelectedTarget(null); }}
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
          {(() => {
            const p = perspective;
            if (!p) return null;
            const isDead = !p.alive;
            const charInfo = p.character ? getCharacterMeta(p.character) : undefined;
            const faction = charInfo?.faction ?? '群';
            const factionColor = FACTION_BG[faction] || '#8e44ad';
            const identity = p.identity;
            // 技能列表（过滤默认技能与装备技能）
            const visibleSkills = p.skills.filter(s => !DEFAULT_SKILLS.has(s) && !EQUIPMENT_SKILL_NAMES.has(s));
            // 装备技能集合：动态装备的技能可主动点击
            const equipSkillActions = skillActions.filter(a => EQUIPMENT_SKILL_NAMES.has(a.skillId));
            // 主动技（confirm/choosePlayer/转化类/distribute 主动技）渲染为可点按钮
            const triggerableActions = skillActions.filter(a =>
              a.prompt.type === 'confirm' ||
              a.prompt.type === 'choosePlayer' ||
              (a.prompt.type === 'useCardAndTarget' && a.transform) ||
              a.prompt.type === 'distribute'
            );
            const showSkillButtons = isMyTurn && canOperate && view.phase === '出牌';
            return (
              <>
                {/* 势力色顶部条 */}
                <div className={styles.playerCardHeader} style={{ background: factionColor }}>
                  <div className={styles.playerCardHeaderTop}>
                    <span className={styles.playerCardName}>{p.name}</span>
                    <div>
                      {perspectiveIdx === view.viewer && <span className={styles.youBadge}>我</span>}
                      {isPerspectiveTurn && <span className={styles.turnBadge}>回合</span>}
                      {isDead && <span className={styles.youBadge} style={{ background: '#555' }}>亡</span>}
                      {identity && (
                        <span
                          className={
                            identity === '主公' ? styles.lordBadge :
                            identity === '忠臣' ? styles.loyalistBadge :
                            identity === '反贼' ? styles.rebelBadge :
                            identity === '内奸' ? styles.renegadeBadge :
                            ''
                          }
                        >
                          {identity}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={styles.playerCardChar}>{p.character || '未知'}</div>
                </div>
                {/* 体力红心 */}
                <div className={styles.seatHpRow}>
                  {Array.from({ length: p.maxHealth }, (_, i) => (
                    <span
                      key={i}
                      className={cx(i < p.health ? styles.hpHeartFull : styles.hpHeartEmpty, anim.damageFlashIndices.has(perspectiveIdx) && styles.hpFlash)}
                    >
                      ♥
                    </span>
                  ))}
                </div>
                {/* 技能区：被动为标签，可主动点击的为按钮 */}
                {visibleSkills.length > 0 && (
                  <div className={styles.skillRow} style={{ padding: '8px 12px' }}>
                    {visibleSkills.map(s => {
                      const btn = triggerableActions.find(a => a.skillId === s);
                      if (showSkillButtons && btn) {
                        return (
                          <button
                            key={s}
                            className={styles.skillBtn}
                            style={btn.style === 'danger' ? { borderColor: '#e74c3c' } : btn.style === 'primary' ? { borderColor: '#f39c12' } : undefined}
                            onClick={() => handleSkillAction(btn)}
                            title={`${btn.label}: ${btn.prompt.title}`}
                          >
                            {s}
                          </button>
                        );
                      }
                      return <span key={s} className={styles.skillTag}>{s}</span>;
                    })}
                  </div>
                )}
                {/* 装备区：独立显示，不在手牌里 */}
                {(Object.keys(p.equipment).length > 0 || equipSkillActions.length > 0) && (
                  <div className={styles.playerCardEquip}>
                    <div className={styles.playerCardEquipTitle}>装备区</div>
                    <div className={styles.equipRow}>
                      {Object.entries(p.equipment).map(([slot, cardId]) => {
                        const card = view.cardMap[cardId as string];
                        const icon =
                          slot === '武器' ? '⚔' :
                          slot === '防具' ? '🛡' :
                          slot === '进攻马' ? '🐎+' :
                          slot === '防御马' ? '🐎-' :
                          '💎';
                        return (
                          <span key={slot} title={card ? `${card.name}(${slot})` : String(cardId)}>
                            {icon} {card?.name ?? cardId}
                          </span>
                        );
                      })}
                      {showSkillButtons && equipSkillActions.map(a => (
                        <button
                          key={`${a.skillId}:${a.actionType}`}
                          className={styles.equipSkillBtn}
                          onClick={() => handleSkillAction(a)}
                          title={`${a.label}: ${a.prompt.title}`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* 判定区 */}
                {(() => {
                  const ids = p.pendingTricks ?? [];
                  if (ids.length === 0) return null;
                  return (
                    <div className={styles.judgeRow} style={{ padding: '0 12px 8px' }}>
                      <span className={styles.judgeRowLabel}>判定:</span>
                      {ids.map((cardId: string) => {
                        const card = view.cardMap[cardId];
                        const suitColor = SUIT_COLOR[card?.suit ?? '♠'] ?? '#ccc';
                        const desc = card?.description ?? '';
                        return (
                          <span
                            key={cardId}
                            className={styles.judgeTag}
                            style={{ color: suitColor, borderColor: suitColor }}
                            title={desc || card?.name || cardId}
                          >
                            {card?.name ?? cardId}{card ? ` ${card.suit}${card.rank}` : ''}
                          </span>
                        );
                      })}
                    </div>
                  );
                })()}
                {/* 手牌数 */}
                <div className={styles.infoRow}>
                  <span>手牌: {p.handCount}</span>
                </div>
              </>
            );
          })()}
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
                <span className={styles.debugHint} style={{ color: '#f1c40f', marginLeft: 8 }}>
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
              <button className={styles.playBtn} onClick={() => selectedTarget && handleTransformPlay(selectedTarget)} disabled={!selectedTarget}
                style={selectedTarget ? undefined : { opacity: 0.4, cursor: 'not-allowed' }}>
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
              return <button className={styles.playBtn} onClick={handlePlayCard} disabled={!canPlay}
                style={canPlay ? undefined : { opacity: 0.4, cursor: 'not-allowed' }}>
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
                      {selectedTarget && <span style={{ color: '#f1c40f', marginLeft: 8 }}>{selectedTarget}</span>}
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
                        <div className={styles.targetTitle} style={{ marginTop: 8 }}>
                          ② 选 B 角色(A 对其出杀):
                          {selectedKillTarget && <span style={{ color: '#f1c40f', marginLeft: 8 }}>{selectedKillTarget}</span>}
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
                                {!inAARange && <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>距离外</span>}
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
                            {!targetable && <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>距离外</span>}
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
                const info = pendingRespondInfo();
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

      {/* ─── 游戏日志 ─── */}
      <details className={styles.logPanel}>
        <summary className={styles.logSummary}>📜 游戏日志 ({view.log.length})</summary>
        <div className={styles.logContent}>
          {view.log.length === 0 && <div className={styles.logEmpty}>暂无记录</div>}
          {view.log.slice().reverse().map((entry, i) => (
            <div key={i} className={styles.logEntry}>
              <span className={styles.logTime}>{formatTime(entry.time)}</span>
              <span className={styles.logPlayer}>{entry.player}</span>
              <span className={styles.logText}>{entry.text}</span>
            </div>
          ))}
        </div>
      </details>
      {/* ─── 调试面板 ─── */}
      <details className={styles.debugPanel}>
        <summary className={styles.debugSummary}>调试信息</summary>
        <div className={styles.debugContent}>
          <div>phase: {view.phase} | round: {view.turn.round} | currentPlayer: {currentPlayerName}</div>
          <div>viewer: {view.players[view.viewer]?.name} | perspective: {perspectiveName}</div>
          <div>pending: {pending ? `${pending.prompt.title} → ${pending.target}` : 'none'}</div>
          <hr className={styles.debugHr} />
          {view.players.map((p, i) => (
            <div key={i} className={styles.debugPlayer}>
              <span className={!p.alive ? styles.debugDead : undefined}>
                {p.name}({p.character}) HP:{p.health}/{p.maxHealth}
                {!p.alive && ' [阵亡]'}
              </span>
              <span> 手牌:{p.handCount}</span>
              {Object.entries(p.equipment).map(([slot, cardId]) => (
                <span key={slot}> [{slot}:{equipName(slot as EquipSlot, cardId as string)}]</span>
              ))}
              {p.skills.filter(s => !DEFAULT_SKILLS.has(s)).length > 0 && (
                <span> 技能:{p.skills.filter(s => !DEFAULT_SKILLS.has(s)).join(',')}</span>
              )}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}


