// src/client/components/GameView.tsx
// 新 ENGINE-DESIGN 完整游戏界面 — 参照老 GameBoard + DebugPlayerList 设计
//
// 布局: GameHeader → 提示区 → 座位布局(5人) → 手牌区 → 操作面板 → 调试面板
// 特性: 视角切换、倒计时、装备区、座位布局、操作提示、弃牌选择
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { css, cx } from '@linaria/core';
import type { GameView as EngineGameView, Card, Json, PendingView, EquipSlot, ActionPrompt } from '../../engine/types';
import { getActionsForPlayer, registerSkillActions, clearRegistry, type SkillActionDef } from '../skillActionRegistry';


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

// ─── 花色颜色 ───
const SUIT_COLOR: Record<string, string> = {
  '♠': '#ccc', '♣': '#ccc', '♥': '#e74c3c', '♦': '#e74c3c',
};

// ─── 引擎声明的默认通用技能(技能按钮区/座位卡均过滤这些) ───
// 对应 src/engine/atoms/选将.ts:DEFAULT_SKILLS
const DEFAULT_SKILLS = new Set([
  '回合管理', '装备通用', '杀', '闪', '桃', '酒',
  '过河拆桥', '顺手牵羊', '无中生有', '桃园结义',
  '借刀杀人', '决斗', '南蛮入侵', '万箭齐发',
  '乐不思蜀', '无懈可击',
]);

// ─── 延时锦囊:validate 用 `params.target`(单数),非 targets(数组) ───
const DELAYED_TRICKS = new Set(['乐不思蜀', '闪电', '兵粮寸断']);

// ─── 选将:武将池 ───
interface CharPoolItem {
  name: string;
  faction: string;
  skills: string[];
  maxHealth: number;
}
const CHAR_POOL: CharPoolItem[] = [
  { name: '刘备', faction: '蜀', skills: ['仁德'], maxHealth: 4 },
  { name: '曹操', faction: '魏', skills: ['奸雄'], maxHealth: 4 },
  { name: '孙权', faction: '吴', skills: ['制衡'], maxHealth: 4 },
  { name: '关羽', faction: '蜀', skills: ['武圣'], maxHealth: 4 },
  { name: '郭嘉', faction: '魏', skills: ['天妒', '遗计'], maxHealth: 3 },
  { name: '张飞', faction: '蜀', skills: ['咆哮'], maxHealth: 4 },
  { name: '诸葛亮', faction: '蜀', skills: ['观星', '空城'], maxHealth: 3 },
  { name: '司马懿', faction: '魏', skills: ['反馈'], maxHealth: 3 },
  { name: '夏侯惇', faction: '魏', skills: ['刚烈'], maxHealth: 4 },
  { name: '甄姬', faction: '魏', skills: ['倾国'], maxHealth: 3 },
  { name: '赵云', faction: '蜀', skills: ['龙胆'], maxHealth: 4 },
  { name: '周瑜', faction: '吴', skills: ['英姿', '反间'], maxHealth: 3 },
  { name: '吕布', faction: '群', skills: ['无双'], maxHealth: 4 },
  { name: '华佗', faction: '群', skills: ['急救', '青囊'], maxHealth: 3 },
  { name: '貂蝉', faction: '群', skills: ['离间', '闭月'], maxHealth: 3 },
  { name: '张角', faction: '群', skills: ['雷击', '鬼道', '黄天'], maxHealth: 3 },
];
const FACTION_BG: Record<string, string> = {
  '魏': '#2c3e50',
  '蜀': '#27ae60',
  '吴': '#c0392b',
  '群': '#8e44ad',
};

// ─── 时间格式化 ───
function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

// ─── 倒计时 hook ───
function useCountdownSeconds(deadline: number | null): number | null {
  const [sec, setSec] = useState<number | null>(null);
  useEffect(() => {
    if (deadline == null) { setSec(null); return; }
    const tick = () => setSec(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [deadline]);
  return sec;
}

// ─── 动画状态追踪 hook ───
interface AnimationState {
  /** 当前需要播放摸牌动画的卡牌 ID 集合 */
  newCardIds: Set<string>;
  /** 受到伤害的玩家 index → 动画版本号(每次伤害递增,触发 re-render) */
  damageFlashIndices: Map<number, number>;
  /** 阶段变化的版本号(触发阶段标签动画) */
  phaseVersion: number;
  /** 新回合的版本号(触发回合光环) */
  turnVersion: number;
  /** 是否触发弃牌阶段动画 */
  discardPhase: boolean;
}

function useAnimationState(view: EngineGameView, perspectiveIdx: number): AnimationState {
  const [state, setState] = useState<AnimationState>({
    newCardIds: new Set(),
    damageFlashIndices: new Map(),
    phaseVersion: 0,
    turnVersion: 0,
    discardPhase: false,
  });

  // 上一次的快照
  const prevHandRef = useRef<string[]>([]);
  const prevHpRef = useRef<Map<number, number>>(new Map());
  const prevPhaseRef = useRef(view.phase);
  const prevRoundRef = useRef(view.turn.round);

  // 摸牌检测:当前视角手牌 ID 相对上一次新增的
  useEffect(() => {
    const hand = view.players[perspectiveIdx]?.hand ?? [];
    const handIds = hand.map(c => c.id);
    const prevIds = prevHandRef.current;
    const newIds = handIds.filter(id => !prevIds.includes(id));
    if (newIds.length > 0) {
      setState(s => ({ ...s, newCardIds: new Set([...s.newCardIds, ...newIds]) }));
      // 动画结束后清除标记(0.5s 留余量)
      setTimeout(() => {
        setState(s => {
          const next = new Set(s.newCardIds);
          for (const id of newIds) next.delete(id);
          return { ...s, newCardIds: next };
        });
      }, 550);
    }
    prevHandRef.current = handIds;
  }, [view.players[perspectiveIdx]?.hand]);

  // 伤害检测:任意玩家 HP 下降
  useEffect(() => {
    const hpMap = new Map(view.players.map((p, i) => [i, p.health]));
    const prevHp = prevHpRef.current;
    const newFlash = new Map<number, number>();
    let changed = false;
    for (const [i, hp] of hpMap) {
      const prev = prevHp.get(i);
      if (prev !== undefined && hp < prev) {
        newFlash.set(i, (state.damageFlashIndices.get(i) ?? 0) + 1);
        changed = true;
      }
    }
    if (changed) {
      setState(s => ({ ...s, damageFlashIndices: new Map([...s.damageFlashIndices, ...newFlash]) }));
      // 动画结束后清除(0.6s)
      setTimeout(() => {
        setState(s => {
          const next = new Map(s.damageFlashIndices);
          for (const [i] of newFlash) next.delete(i);
          return { ...s, damageFlashIndices: next };
        });
      }, 650);
    }
    prevHpRef.current = hpMap;
  }, [view.players]);

  // 阶段变化检测
  useEffect(() => {
    if (view.phase !== prevPhaseRef.current) {
      setState(s => ({ ...s, phaseVersion: s.phaseVersion + 1, discardPhase: view.phase === '弃牌' }));
      prevPhaseRef.current = view.phase;
      if (view.phase !== '弃牌') {
        setTimeout(() => setState(s => ({ ...s, discardPhase: false })), 400);
      }
    }
  }, [view.phase]);

  // 新回合检测
  useEffect(() => {
    if (view.turn.round !== prevRoundRef.current) {
      setState(s => ({ ...s, turnVersion: s.turnVersion + 1 }));
      prevRoundRef.current = view.turn.round;
    }
  }, [view.turn.round]);

  return state;
}

// ─── 主组件 ───
export function GameViewComponent({ view, onAction, onDeleteRoom }: Props) {
  // 视角: 默认看自己,可切换
  const [perspectiveIdx, setPerspectiveIdx] = useState(view.viewer);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedForDiscard, setSelectedForDiscard] = useState<Set<string>>(new Set());
  const [showIdentityReveal, setShowIdentityReveal] = useState(true);
  const [showCharSelect, setShowCharSelect] = useState(false);
  const [selectedCharIdx, setSelectedCharIdx] = useState<number | null>(null);

  // 选将:随机抽 5 张(仅组件挂载时生成一次)
  const charOptions = useMemo(() => {
    const shuffled = [...CHAR_POOL].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 5);
  }, []);

  // ─── 动画状态 ───
  const anim = useAnimationState(view, perspectiveIdx);
  const handListRef = useRef<HTMLDivElement>(null);
  const prevPhaseForGlow = useRef(view.phase);

  // 自动视角切换开关(默认开,多 agent 协作时可关)
  const [autoSwitch, setAutoSwitch] = useState(true);

  // 有待回应请求时,自动切换视角到被问询玩家;无 pending 时回到当前回合玩家
  useEffect(() => {
    if (!autoSwitch) return;
    if (view.pending) {
      const targetIdx = view.pending.target;
      if (targetIdx >= 0 && targetIdx < view.players.length) setPerspectiveIdx(targetIdx);
    } else {
      setPerspectiveIdx(view.currentPlayerIndex);
    }
  }, [view.pending?.target, view.currentPlayerIndex, autoSwitch]);
  // 初次加载:默认看自己的座次
  useEffect(() => { setPerspectiveIdx(view.viewer); }, [view.viewer]);

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
  const isPerspectiveAwaiting = pending !== null && pendingTargetIdx === perspectiveIdx;
  // 弃牌窗口:engine 在 弃牌阶段 创建 requestType='__弃牌' 的 pending
  const isDiscardPhase = pending !== null && (pending.atom as { requestType?: string }).requestType === '__弃牌';
  const discardMin = isDiscardPhase ? ((pending.atom as { prompt: { cardFilter?: { min?: number } } }).prompt.cardFilter?.min ?? 0) : 0;
  const discardMax = isDiscardPhase ? ((pending.atom as { prompt: { cardFilter?: { max?: number } } }).prompt.cardFilter?.max ?? discardMin) : 0;
  // 弃牌窗口出现/切换时清空已选
  useEffect(() => { setSelectedForDiscard(new Set()); }, [pending]);
  // debug 模式:viewer 可以代打任何玩家;正式模式:必须视角=自己
  const canOperate = true; // debug 模式永远允许操作
  const isMyAwaiting = isPerspectiveAwaiting && canOperate;

  // 倒计时:pending 回应优先,否则用 turnDeadline
  const deadline = pending?.deadline ?? view.turnDeadline;
  const remainingSeconds = useCountdownSeconds(deadline);
  // 注意:不再在客户端 remainingSeconds<=0 时自动 respond/endTurn。
  // 旧逻辑是 debug 模式自动操作,但会导致「出杀时跳过问闪」——pending 刚渲染就被自动 handleRespond() 当作「不出」处理。
  // 现在依赖服务端真实超时(默认 15s):服务端 advance → view.pending 清空 → UI 自然恢复。

  // 切换视角
  const switchPerspective = useCallback(() => {
    const next = (perspectiveIdx + 1) % view.players.length;
    setPerspectiveIdx(next);
    setSelectedCardId(null);
    setSelectedTarget(null);
  }, [perspectiveIdx, view.players.length]);

  const goToCurrentPlayer = useCallback(() => {
    setPerspectiveIdx(view.currentPlayerIndex);
    setSelectedCardId(null);
    setSelectedTarget(null);
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
    },
    [onAction, perspectiveIdx],
  );

  // ─── 距离和攻击范围计算(纯函数，基于 GameView) ───
  const WEAPON_RANGE: Record<string, number> = {
    '诸葛连弩': 1, '青釭剑': 2, '雌雄双股剑': 2, '贯石斧': 3,
    '青龙偃月刀': 3, '丈八蛇矛': 3, '方天画戟': 4, '麒麟弓': 5, '寒冰剑': 2,
  };
  /** 需要攻击范围内才能选目标的牌 */
  const RANGE_REQUIRED_CARDS = new Set(['杀', '顺手牵羊']);

  /** 计算 from 到 to 的座位距离(只算存活玩家) */
  function seatDistance(fromIdx: number, toIdx: number): number {
    const alive = view.players.filter(p => p.alive);
    const n = alive.length;
    if (n <= 1) return 0;
    const aliveFromIdx = alive.findIndex(p => p.name === view.players[fromIdx]?.name);
    const aliveToIdx = alive.findIndex(p => p.name === view.players[toIdx]?.name);
    if (aliveFromIdx < 0 || aliveToIdx < 0) return Infinity;
    const d = Math.abs(aliveFromIdx - aliveToIdx);
    return Math.min(d, n - d);
  }

  /** 计算 from 到 to 的实际距离(含马修正) */
  function effectiveDist(fromIdx: number, toIdx: number): number {
    let dist = seatDistance(fromIdx, toIdx);
    const fromP = view.players[fromIdx];
    const toP = view.players[toIdx];
    if (fromP?.equipment?.['进攻马']) dist -= 1;
    if (toP?.equipment?.['防御马']) dist += 1;
    return Math.max(1, dist);
  }

  /** from 是否能攻击到 to */
  function canAttack(fromIdx: number, toIdx: number): boolean {
    const fromP = view.players[fromIdx];
    let range = 1;
    if (fromP?.equipment?.['武器']) {
      const weapon = view.cardMap[fromP.equipment['武器']];
      if (weapon) range = WEAPON_RANGE[weapon.name] ?? 1;
    }
    return effectiveDist(fromIdx, toIdx) <= range;
  }

  /** 选中的牌是否需要攻击范围才能选目标 */
  const selectedCard = selectedCardId ? (perspectiveHand.find(c => c.id === selectedCardId) ?? viewerHand.find(c => c.id === selectedCardId)) : null;
  const selectedNeedsRange = selectedCard ? RANGE_REQUIRED_CARDS.has(selectedCard.name) : false;

  /** 判断目标 i 是否可被选中(距离/范围检查) */
  function isTargetable(i: number): boolean {
    if (!selectedNeedsRange) return true;
    const result = canAttack(perspectiveIdx, i);
    if (!result) {
      const fromP = view.players[perspectiveIdx];
      let range = 1;
      if (fromP?.equipment?.['武器']) {
        const weapon = view.cardMap[fromP.equipment['武器']];
        if (weapon) range = WEAPON_RANGE[weapon.name] ?? 1;
      }
      console.log('[isTargetable] 无法选中', i, 'dist=', effectiveDist(perspectiveIdx, i), 'range=', range);
    }
    return result;
  }

  // 需要选目标的牌
  const TARGET_REQUIRED_CARDS = new Set(['杀', '过河拆桥', '顺手牵羊', '借刀杀人', '决斗', '乐不思蜀']);

  // 当前是否需要选目标(出牌或使用技能时)
  const selectedNeedsTarget = selectedCard
    ? TARGET_REQUIRED_CARDS.has(selectedCard.name)
    : false;
  // 自动以自己为目标的牌
  const SELF_TARGET_CARDS = new Set(['桃', '酒']);
  // 只能作为回应打出的牌(不能主动出)
  const RESPOND_ONLY = new Set(['闪', '无懈可击']);
  // 出牌
  /** 玩家名 → 座次下标(UI 层用 name,dispatch 时转 index) */
  function nameToIndex(name: string): number {
    return view.players.findIndex(p => p.name === name);
  }

  function handlePlayCard() {
    if (!selectedCardId) return;
    const card = perspectiveHand.find(c => c.id === selectedCardId);
    if (!card) return;
    if (RESPOND_ONLY.has(card.name)) return; // 不能主动出
    const selfName = view.players[view.viewer].name;
    const needsTarget = TARGET_REQUIRED_CARDS.has(card.name);
    if (needsTarget && !selectedTarget) return; // 需要目标但没选
    const targetName = selectedTarget ?? (SELF_TARGET_CARDS.has(card.name) ? selfName : undefined);
    const params: Record<string, Json> = { cardId: card.id };
    if (targetName) {
      const idx = nameToIndex(targetName);
      if (idx >= 0) {
        // 延时锦囊 validate 用单数 target;其他牌用 targets 数组
        if (DELAYED_TRICKS.has(card.name)) {
          params.target = idx;
        } else {
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

  // ─── 武将技能使用(基于 ActionPrompt 类型驱动) ───
  function handleSkillAction(action: SkillActionDef) {
    const { skillId, actionType, prompt } = action;
    const params: Record<string, Json> = {};

    switch (prompt.type) {
      case 'useCard':
        // 选牌型:需要 selectedCardId
        if (!selectedCardId) { alert(prompt.title); return; }
        params.cardId = selectedCardId;
        break;
      case 'selectTarget':
        // 选目标型:需要 selectedTarget
        if (!selectedTarget) { alert(prompt.title); return; }
        params.target = nameToIndex(selectedTarget);
        break;
      case 'useCardAndTarget':
        // 选牌+选目标型
        if (!selectedCardId) { alert(prompt.title + ' — 请先选中手牌'); return; }
        if (!selectedTarget) { alert(prompt.title + ' — 请选择目标'); return; }
        {
          const idx = nameToIndex(selectedTarget);
          if (idx < 0) { alert(prompt.title + ' — 目标无效'); return; }
          // 延时锦囊 validate 用单数 target;其他牌用 targets 数组
          const trickCard = perspectiveHand.find(c => c.id === selectedCardId)
            ?? viewerHand.find(c => c.id === selectedCardId);
          if (trickCard && DELAYED_TRICKS.has(trickCard.name)) {
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
        if (!selectedTarget) { alert(prompt.title); return; }
        params.target = nameToIndex(selectedTarget);
        break;
      case 'distribute':
        // 分配型:暂不支持,提示
        alert('分配型技能暂未实现'); return;
      default:
        break;
    }

    send(skillId, actionType, params);
    setSelectedCardId(null);
    setSelectedTarget(null);
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
    if (cardId) {
      const card = perspectiveHand.find(c => c.id === cardId);
      if (card) send(card.name, 'respond', { cardId });
    } else {
      // 不出闪/杀/桃:用对应 skill respond 但不带 cardId(后端 skill 收到空 cardId → 不做操作)
      // 根据当前 pending 的 atom type 和 requestType 决定用哪个 skill
      const atomType = pending?.atom?.type;
      const reqType = (pending?.atom as Record<string, unknown>)?.requestType;
      let skillId: string;
      if (atomType === '询问杀') {
        skillId = '杀';
      } else if (atomType === '询问闪') {
        skillId = '闪';
      } else if (atomType === '请求回应' && reqType === '求桃') {
        skillId = '桃';
      } else {
        skillId = '闪';
      }
      send(skillId, 'respond', {});
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
      const atomType = pending?.atom?.type;
      const reqType = (pending?.atom as Record<string, unknown>)?.requestType;
      const isPeachPending = atomType === '请求回应' && reqType === '求桃';
      if (card.name === '闪' || card.name === '杀' || (isPeachPending && card.name === '桃')) {
        handleRespond(card.id);
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

  // 座位排列: [自己, 右下, 右上, 左上, 左下]
  const orderedPlayers = useMemo(() => {
    const result: typeof view.players = [];
    for (let i = 0; i < view.players.length; i++) {
      result.push(view.players[(perspectiveIdx + i) % view.players.length]);
    }
    return result;
  }, [view.players, perspectiveIdx]);


  // ─── 身份牌颜色映射 ───
  const IDENTITY_COLORS: Record<string, string> = {
    '主公': '#FFD700',
    '忠臣': '#4A90E2',
    '反贼': '#E74C3C',
    '内奸': '#9B59B6',
  };

  return (
    <div className={pageRoot}>
          {/* ─── 身份揭示遮罩 ─── */}
      {showIdentityReveal && perspective?.identity && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.85)',
          animation: 'overlayFadeIn 0.5s ease-out both',
        }}>
          <div style={{
            width: 200,
            height: 280,
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            background: IDENTITY_COLORS[perspective.identity] || '#888',
            color: '#fff',
            boxShadow: '0 0 40px rgba(0,0,0,0.5)',
            animation: 'identityCardFlip 1s cubic-bezier(0.23, 1, 0.32, 1) both',
            transformStyle: 'preserve-3d',
          }}>
            <div style={{ fontSize: 14, opacity: 0.8, letterSpacing: 2 }}>你的身份</div>
            <div style={{ fontSize: 36, fontWeight: 'bold', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>{perspective.identity}</div>
          </div>
          <button
            onClick={() => {
              setShowIdentityReveal(false);
              setShowCharSelect(true);
            }}
            style={{
              marginTop: 32,
              padding: '10px 48px',
              fontSize: 16,
              fontWeight: 'bold',
              color: '#fff',
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 8,
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.25)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
          >
            确认
          </button>
        </div>
      )}
      {/* ─── 选将遮罩 ─── */}
      {showCharSelect && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.9)',
        }}>
          <div style={{
            fontSize: 28,
            fontWeight: 'bold',
            color: '#ffd700',
            marginBottom: 32,
            letterSpacing: 4,
            textShadow: '0 2px 12px rgba(255,215,0,0.3)',
          }}>
            选择你的武将
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 16,
            maxWidth: 800,
            width: '90%',
          }}>
            {charOptions.map((ch, i) => {
              const isSelected = selectedCharIdx === i;
              return (
                <div
                  key={ch.name}
                  onClick={() => setSelectedCharIdx(i)}
                  style={{
                    background: FACTION_BG[ch.faction] || '#333',
                    borderRadius: 12,
                    padding: '24px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    border: isSelected ? '3px solid #ffd700' : '3px solid transparent',
                    boxShadow: isSelected
                      ? '0 0 20px rgba(255,215,0,0.4), 0 4px 16px rgba(0,0,0,0.3)'
                      : '0 4px 16px rgba(0,0,0,0.3)',
                    transform: isSelected ? 'translateY(-8px) scale(1.03)' : 'translateY(0)',
                    transition: 'all 0.25s cubic-bezier(0.23, 1, 0.32, 1)',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) {
                      e.currentTarget.style.transform = 'translateY(-6px)';
                      e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)';
                    }
                  }}
                >
                  <div style={{
                    fontSize: 22,
                    fontWeight: 'bold',
                    color: '#fff',
                    textShadow: '0 1px 4px rgba(0,0,0,0.3)',
                  }}>
                    {ch.name}
                  </div>
                  <div style={{
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.7)',
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: 6,
                    padding: '2px 8px',
                  }}>
                    {ch.faction} · {ch.skills.join(' / ')}
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: 3,
                    marginTop: 4,
                  }}>
                    {Array.from({ length: ch.maxHealth }, (_, j) => (
                      <div key={j} style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: '#e74c3c',
                        boxShadow: '0 0 4px rgba(231,76,60,0.5)',
                      }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            disabled={selectedCharIdx === null}
            onClick={() => {
              if (selectedCharIdx !== null) {
                setShowCharSelect(false);
              }
            }}
            style={{
              marginTop: 32,
              padding: '12px 56px',
              fontSize: 18,
              fontWeight: 'bold',
              color: selectedCharIdx !== null ? '#000' : '#666',
              background: selectedCharIdx !== null
                ? 'linear-gradient(135deg, #ffd700, #f0c000)'
                : '#333',
              border: 'none',
              borderRadius: 8,
              cursor: selectedCharIdx !== null ? 'pointer' : 'not-allowed',
              boxShadow: selectedCharIdx !== null
                ? '0 4px 16px rgba(255,215,0,0.3)'
                : 'none',
              transition: 'all 0.2s',
              letterSpacing: 2,
            }}
          >
            确认选择
          </button>
        </div>
      )}

      {/* ─── 头部 ─── */}
      <div className={headerBar}>
        <button className={backBtn} onClick={onDeleteRoom}>← 退出</button>
        <div className={headerCenter}>
          <span className={cx(roundBadge, anim.turnVersion > 0 && turnGlowing)} key={`turn-${anim.turnVersion}`}>第 {view.turn.round} 轮</span>
          <span className={cx(phaseBadge, anim.phaseVersion > 0 && phaseAnimating)} key={`phase-${anim.phaseVersion}`}>{PHASE_LABELS[view.phase] ?? view.phase}</span>
          <span className={currentPlayerText}>
            当前: {currentPlayerName} {currentPlayer?.character ? `(${currentPlayer.character})` : ''}
          </span>
          {remainingSeconds !== null && (
            <span className={headerCountdown}>⏱ {remainingSeconds}s</span>
          )}
        </div>
        <div className={headerRight}>
          <button className={perspectiveBtn} onClick={switchPerspective}>
            视角: {perspectiveName}
          </button>
          <button className={goToBtn} onClick={goToCurrentPlayer}>查看当前玩家</button>
          <button
            className={goToBtn}
            style={autoSwitch ? { background: '#27ae60', color: '#fff' } : undefined}
            onClick={() => setAutoSwitch(!autoSwitch)}
          >
            自动切换{autoSwitch ? '✓' : '✗'}
          </button>
        </div>
      </div>

      {/* ─── 操作提示 ─── */}
      {/* 优先级: 弃牌 pending > 回应 pending > 出牌/弃牌阶段提示 */}
      {isPerspectiveAwaiting && pending && !isDiscardPhase && (
        <div className={promptBoxAwaiting}>
          <div className={promptTitle}>⚡ 需要回应 — {perspectiveName}</div>
          <div className={promptDesc}>
            {pending.prompt.title}
            {pending.prompt.description && <span> — {pending.prompt.description}</span>}
          </div>
          {canOperate && (() => {
            const atomType = pending?.atom?.type;
            const reqType = (pending?.atom as Record<string, unknown>)?.requestType;
            // 根据 pending 类型决定按钮文案和展示的牌
            let declineLabel: string;
            let cardFilter: string[];
            if (atomType === '询问闪') {
              declineLabel = '不闪';
              cardFilter = ['闪'];
            } else if (atomType === '询问杀') {
              declineLabel = '不出杀';
              cardFilter = ['杀'];
            } else if (atomType === '请求回应' && reqType === '求桃') {
              declineLabel = '不救';
              cardFilter = ['桃'];
            } else {
              declineLabel = '不回应';
              cardFilter = [];
            }
            return (
              <div className={promptActions}>
                <button className={promptBtn} onClick={() => handleRespond()}>{declineLabel}</button>
                {cardFilter.length > 0 && perspectiveHand.filter(c => cardFilter.includes(c.name)).map(c => (
                  <button key={c.id} className={promptBtnPrimary} onClick={() => handleRespond(c.id)}>
                    {c.name} {c.suit}{c.rank}
                  </button>
                ))}
              </div>
            );
          })()}
          {!canOperate && <div className={waitingHint}>等待 {perspectiveName} 回应...</div>}
          {/* 倒计时进度条:remainingSeconds 是秒数,15s 总长(询问闪/杀约定 timeout) */}
          {remainingSeconds !== null && (() => {
            const total = 15;
            const ratio = Math.max(0, Math.min(1, remainingSeconds / total));
            return (
              <div className={promptCountdownBar}>
                <div className={promptCountdownFill} style={{ width: `${ratio * 100}%` }} />
              </div>
            );
          })()}
        </div>
      )}

      {!isPerspectiveTurn && !isPerspectiveAwaiting && !isDiscardPhase && (
        <div className={waitingHint}>等待 {currentPlayerName} 操作...</div>
      )}
      {isPerspectiveTurn && view.phase === '出牌' && !isPerspectiveAwaiting && !isDiscardPhase && (
        <div className={promptBox}>
          <div className={promptTitle}>🃏 {perspectiveName}的回合 — 出牌阶段</div>
          <div className={promptDesc}>
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
      {isPerspectiveTurn && view.phase === '弃牌' && !isPerspectiveAwaiting && !isDiscardPhase && (
        <div className={promptBox}>
          <div className={promptTitle}>🗑️ {perspectiveName} — 弃牌阶段</div>
          <div className={promptDesc}>{canOperate ? '请弃置多余的手牌' : `${perspectiveName} 正在弃牌...`}</div>
        </div>
      )}
      {isDiscardPhase && isPerspectiveAwaiting && (
        <div className={promptBoxAwaiting}>
          <div className={promptTitle}>🗑️ 弃牌阶段:需弃 {discardMin} 张牌（已选 {selectedForDiscard.size}/{discardMin}）</div>
          <div className={promptDesc}>
            {canOperate
              ? discardMin === discardMax
                ? `请选择 ${discardMin} 张手牌弃置`
                : `请选择 ${discardMin}–${discardMax} 张手牌弃置`
              : `等待 ${perspectiveName} 弃牌...`}
          </div>
          {canOperate && (
            <div className={promptActions}>
              <button
                className={promptBtnPrimary}
                disabled={selectedForDiscard.size < discardMin || selectedForDiscard.size > discardMax}
                onClick={handleConfirmDiscard}
              >
                确认弃牌 ({selectedForDiscard.size}/{discardMin})
              </button>
              {selectedForDiscard.size > 0 && (
                <button className={promptBtn} onClick={() => setSelectedForDiscard(new Set())}>
                  清空选择
                </button>
              )}
            </div>
          )}
          {remainingSeconds !== null && (() => {
            const total = 30;
            const ratio = Math.max(0, Math.min(1, remainingSeconds / total));
            return (
              <div className={promptCountdownBar}>
                <div className={promptCountdownFill} style={{ width: `${ratio * 100}%` }} />
              </div>
            );
          })()}
        </div>
      )}

      {/* ─── 座位布局 ─── */}
      <div className={seatingArea}>
        {/* 上排: 2人 */}
        <div className={seatRowCenter}>
          {orderedPlayers[3] && <PlayerSeatView
            player={orderedPlayers[3]}
            index={(perspectiveIdx + 3) % view.players.length}
            view={view}
            isCurrentPlayer={orderedPlayers[3].name === currentPlayerName}
            isPerspective={orderedPlayers[3].name === perspectiveName}
            needsTarget={selectedNeedsTarget}
            isTargetable={isTargetable((perspectiveIdx + 3) % view.players.length)}
            selectedTarget={selectedTarget}
            remainingSeconds={orderedPlayers[3].name === currentPlayerName ? remainingSeconds : null}
            onTargetClick={handleTargetClick}
            onPerspectiveChange={(idx) => { setPerspectiveIdx(idx); setSelectedCardId(null); setSelectedTarget(null); }}
            isDamaged={anim.damageFlashIndices.has((perspectiveIdx + 3) % view.players.length)}
            damageVersion={anim.damageFlashIndices.get((perspectiveIdx + 3) % view.players.length) ?? 0}
            isTurnGlow={orderedPlayers[3].name === currentPlayerName && anim.turnVersion > 0}
            turnGlowVersion={anim.turnVersion}
          />}
          {orderedPlayers[2] && <PlayerSeatView
            player={orderedPlayers[2]}
            index={(perspectiveIdx + 2) % view.players.length}
            view={view}
            isCurrentPlayer={orderedPlayers[2].name === currentPlayerName}
            isPerspective={orderedPlayers[2].name === perspectiveName}
            needsTarget={selectedNeedsTarget}
            isTargetable={isTargetable((perspectiveIdx + 2) % view.players.length)}
            selectedTarget={selectedTarget}
            remainingSeconds={orderedPlayers[2].name === currentPlayerName ? remainingSeconds : null}
            onTargetClick={handleTargetClick}
            onPerspectiveChange={(idx) => { setPerspectiveIdx(idx); setSelectedCardId(null); setSelectedTarget(null); }}
            isDamaged={anim.damageFlashIndices.has((perspectiveIdx + 2) % view.players.length)}
            damageVersion={anim.damageFlashIndices.get((perspectiveIdx + 2) % view.players.length) ?? 0}
            isTurnGlow={orderedPlayers[2].name === currentPlayerName && anim.turnVersion > 0}
            turnGlowVersion={anim.turnVersion}
          />}
        </div>

        {/* 中排: 左下 | 中央信息 | 右下 */}
        <div className={seatRowSpread}>
          <div className={seatSlot160}>
            {orderedPlayers[4] && <PlayerSeatView
              player={orderedPlayers[4]}
              index={(perspectiveIdx + 4) % view.players.length}
              view={view}
              isCurrentPlayer={orderedPlayers[4].name === currentPlayerName}
              isPerspective={orderedPlayers[4].name === perspectiveName}
              needsTarget={selectedNeedsTarget}
              isTargetable={isTargetable((perspectiveIdx + 4) % view.players.length)}
              selectedTarget={selectedTarget}
              remainingSeconds={orderedPlayers[4].name === currentPlayerName ? remainingSeconds : null}
              onTargetClick={handleTargetClick}
              onPerspectiveChange={(idx) => { setPerspectiveIdx(idx); setSelectedCardId(null); setSelectedTarget(null); }}
              isDamaged={anim.damageFlashIndices.has((perspectiveIdx + 4) % view.players.length)}
              damageVersion={anim.damageFlashIndices.get((perspectiveIdx + 4) % view.players.length) ?? 0}
              isTurnGlow={orderedPlayers[4].name === currentPlayerName && anim.turnVersion > 0}
              turnGlowVersion={anim.turnVersion}
            />}
          </div>

          <div className={centerMeta}>
            <div className={metaText}>
              牌堆: {Object.keys(view.cardMap).length} 张
            </div>
            {deadline != null && remainingSeconds !== null && (
              <div className={countdownText}>
                ⏱ {remainingSeconds}s
              </div>
            )}
          </div>

          <div className={seatSlot160}>
            {orderedPlayers[1] && <PlayerSeatView
              player={orderedPlayers[1]}
              index={(perspectiveIdx + 1) % view.players.length}
              view={view}
              isCurrentPlayer={orderedPlayers[1].name === currentPlayerName}
              isPerspective={orderedPlayers[1].name === perspectiveName}
              needsTarget={selectedNeedsTarget}
              isTargetable={isTargetable((perspectiveIdx + 1) % view.players.length)}
              selectedTarget={selectedTarget}
              remainingSeconds={orderedPlayers[1].name === currentPlayerName ? remainingSeconds : null}
              onTargetClick={handleTargetClick}
              onPerspectiveChange={(idx) => { setPerspectiveIdx(idx); setSelectedCardId(null); setSelectedTarget(null); }}
              isDamaged={anim.damageFlashIndices.has((perspectiveIdx + 1) % view.players.length)}
              damageVersion={anim.damageFlashIndices.get((perspectiveIdx + 1) % view.players.length) ?? 0}
              isTurnGlow={orderedPlayers[1].name === currentPlayerName && anim.turnVersion > 0}
              turnGlowVersion={anim.turnVersion}
            />}
          </div>
        </div>

        {/* 下排: 自己 */}
        <div className={seatRowCenter}>
          {orderedPlayers[0] && <PlayerSeatView
            player={orderedPlayers[0]}
            index={perspectiveIdx}
            view={view}
            isCurrentPlayer={orderedPlayers[0].name === currentPlayerName}
            isPerspective={true}
            needsTarget={false}
            isTargetable={true}
            selectedTarget={null}
            remainingSeconds={orderedPlayers[0].name === currentPlayerName ? remainingSeconds : null}
            onTargetClick={handleTargetClick}
            onPerspectiveChange={(idx) => { setPerspectiveIdx(idx); setSelectedCardId(null); setSelectedTarget(null); }}
            isDamaged={anim.damageFlashIndices.has(perspectiveIdx)}
            damageVersion={anim.damageFlashIndices.get(perspectiveIdx) ?? 0}
            isTurnGlow={orderedPlayers[0].name === currentPlayerName && anim.turnVersion > 0}
            turnGlowVersion={anim.turnVersion}
          />}
        </div>
      </div>

      {/* ─── 手牌区 ─── */}
      <div className={handSection}>
        <div className={handHeader}>
          <span className={handTitle}>
            {perspectiveName} 的手牌 ({perspectiveHand.length})
            {perspectiveIdx !== view.viewer && <span className={debugHint}> (调试视角)</span>}
          </span>
          {selectedCardId && (
            <button className={cancelBtn} onClick={() => { setSelectedCardId(null); setSelectedTarget(null); }}>
              取消选择
            </button>
          )}
        </div>
        <div className={handList} ref={handListRef}>
          {perspectiveHand.map((card, i) => {
            const isSelected = selectedCardId === card.id;
            const isDiscardSelected = selectedForDiscard.has(card.id);
            const canPlay = isMyTurn && canOperate;
            const __atomType = pending?.atom?.type;
            const __reqType = (pending?.atom as Record<string, unknown>)?.requestType;
            const __isPeachPending = __atomType === '请求回应' && __reqType === '求桃';
            const isAwaiting = isMyAwaiting && (card.name === '闪' || card.name === '杀' || (__isPeachPending && card.name === '桃'));
            const canDiscardClick = isDiscardPhase && isPerspectiveAwaiting && canOperate;
            const canClick = canPlay || isAwaiting || canDiscardClick;
            const suitColor = SUIT_COLOR[card.suit] ?? '#ccc';
            const isNew = anim.newCardIds.has(card.id);
            return (
              <div
                key={card.id}
                data-card-id={card.id}
                className={cx(handCard, isSelected && handCardSelected, (!canPlay && !isAwaiting && !canDiscardClick) && handCardDisabled, isAwaiting && handCardRespondable, isDiscardSelected && discardCardSelected, isNew && handCardNew)}
                onClick={() => canClick && handleCardClick(card)}
              >
                <div className={cardName} style={{ color: suitColor }}>{card.name}</div>
                <div className={cardSuit} style={{ color: suitColor }}>{card.suit}{card.rank}</div>
              </div>
            );
          })}
          {perspectiveHand.length === 0 && <div className={emptyHand}>无手牌</div>}
        </div>
      </div>
      {/* ─── 武将技能区(基于 defineAction 注册表) ─── */}
      {/* 按 prompt 类型决定渲染方式: */}
      {/* - confirm/distribute/choosePlayer: 显示独立触发按钮 */}
      {/* - useCard/useCardAndTarget/selectTarget: 影响手牌区可选性,不显示按钮 */}
      {(() => {
        const triggerableActions = skillActions.filter(a =>
          a.prompt.type === 'confirm' ||
          a.prompt.type === 'distribute' ||
          a.prompt.type === 'choosePlayer'
        );
        if (!(isMyTurn && canOperate && view.phase === '出牌' && triggerableActions.length > 0)) return null;
        return (
        <div className={skillSection}>
          <div className={skillTitle}>武将技能:</div>
          <div className={skillList}>
            {triggerableActions.map(action => (
              <button key={`${action.skillId}:${action.actionType}`}
                className={skillBtn}
                style={action.style === 'danger' ? { borderColor: '#e74c3c' } : action.style === 'primary' ? { borderColor: '#f39c12' } : undefined}
                onClick={() => handleSkillAction(action)}
                title={action.prompt.title}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
        );
      })()}


      {/* ─── 操作面板 ─── */}
      <div className={actionBar}>
        {canOperate && isMyTurn && view.phase === '出牌' && selectedCardId && (() => {
          const card = perspectiveHand.find(c => c.id === selectedCardId);
          const needsTarget = card ? TARGET_REQUIRED_CARDS.has(card.name) : false;
          const canPlay = !needsTarget || !!selectedTarget;
          return <button className={playBtn} onClick={handlePlayCard} disabled={!canPlay}
            style={canPlay ? undefined : { opacity: 0.4, cursor: 'not-allowed' }}>
            出牌{selectedTarget ? ` → ${selectedTarget}` : needsTarget ? ' (请选目标)' : ''}
          </button>;
        })()}
        {canOperate && isMyTurn && (view.phase === '出牌' || view.phase === '弃牌') && (
          <button className={endTurnBtn} onClick={handleEndTurn}>结束回合</button>
        )}
        {selectedCardId && selectedTarget && canOperate && isMyTurn && (
          <div className={targetHint}>已选择目标: {selectedTarget}</div>
        )}
      </div>

      {/* ─── 目标选择 ─── */}
      {selectedCardId && canOperate && isMyTurn && !pending && (
        <div className={targetSection}>
          <div className={targetTitle}>选择目标:</div>
          <div className={targetList}>
            {view.players.map((p, i) => {
              if (!p.alive || i === perspectiveIdx) return null;
              const targetable = isTargetable(i);
              return (
                <button
                  key={i}
                  className={cx(targetBtn, selectedTarget === p.name && targetBtnActive, !targetable && targetBtnDisabled)}
                  disabled={!targetable}
                  onClick={() => handleTargetClick(p.name)}
                >
                  {p.name} ({p.character}) ♥{p.health}
                  {!targetable && <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>距离外</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── 游戏日志 ─── */}
      <details className={logPanel}>
        <summary className={logSummary}>📜 游戏日志 ({view.log.length})</summary>
        <div className={logContent}>
          {view.log.length === 0 && <div className={logEmpty}>暂无记录</div>}
          {view.log.slice().reverse().map((entry, i) => (
            <div key={i} className={logEntry}>
              <span className={logTime}>{formatTime(entry.time)}</span>
              <span className={logPlayer}>{entry.player}</span>
              <span className={logText}>{entry.text}</span>
            </div>
          ))}
        </div>
      </details>
      {/* ─── 调试面板 ─── */}
      <details className={debugPanel}>
        <summary className={debugSummary}>调试信息</summary>
        <div className={debugContent}>
          <div>phase: {view.phase} | round: {view.turn.round} | currentPlayer: {currentPlayerName}</div>
          <div>viewer: {view.players[view.viewer]?.name} | perspective: {perspectiveName}</div>
          <div>pending: {pending ? `${pending.prompt.title} → ${pending.target}` : 'none'}</div>
          <hr className={debugHr} />
          {view.players.map((p, i) => (
            <div key={i} className={debugPlayer}>
              <span className={!p.alive ? debugDead : undefined}>
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

// ─── 玩家座位视图 ───
interface PlayerSeatProps {
  player: EngineGameView['players'][number];
  index: number;
  view: EngineGameView;
  isCurrentPlayer: boolean;
  isPerspective: boolean;
  needsTarget: boolean;
  isTargetable: boolean;
  selectedTarget: string | null;
  remainingSeconds: number | null;
  onTargetClick: (name: string) => void;
  onPerspectiveChange: (index: number) => void;
  /** 该玩家是否刚受到伤害 */
  isDamaged?: boolean;
  /** 伤害动画版本号(每次伤害递增,触发 key 变化重放动画) */
  damageVersion?: number;
  /** 是否触发新回合光环 */
  isTurnGlow?: boolean;
  turnGlowVersion?: number;
  /** debug 模式:是否在前端隐藏身份(非视角/非主公/非死亡) */
  hideIdentity?: boolean;
}

function PlayerSeatView({
  player, index, view, isCurrentPlayer, isPerspective,
  needsTarget, isTargetable, selectedTarget, remainingSeconds,
  onTargetClick, onPerspectiveChange,
  isDamaged = false, damageVersion = 0, isTurnGlow = false, turnGlowVersion = 0,
  hideIdentity = true,
}: PlayerSeatProps) {
  const isDead = !player.alive;
  const isClickable = needsTarget && !isDead && isTargetable;

  return (
    <div
      className={cx(
        seatCard,
        isCurrentPlayer && seatCardActive,
        isPerspective && seatCardPerspective,
        isDead && seatCardDead,
        isClickable && seatCardClickable,
        selectedTarget === player.name && seatCardTargeted,
        isDamaged && seatShaking,
        isDamaged && seatDamageOverlay,
        isTurnGlow && turnGlowing,
      )}
      key={damageVersion > 0 ? `dmg-${damageVersion}` : undefined}
      onClick={() => isClickable && onTargetClick(player.name)}
      onDoubleClick={() => onPerspectiveChange(index)}
    >
      <div className={seatHeader}>
        <div>
          <span className={seatIndexBadge}>[{index + 1}号]</span>
          <span className={seatName}>{player.name}</span>
          {player.character && <span className={seatChar}>({player.character})</span>}
          {/* 身份显示:hideIdentity=true 时隐藏非自己/非主公/非死亡的身份 */}
          {(() => {
            // debug 模式下前端自己计算身份可见性
            // 服务端 debug=true 暴露所有 identity,前端按规则只显示自己/主公/死亡
            const identity = player.identity;
            if (!identity) {
              if (player.identityHidden) return <span className={hiddenBadge}>暗</span>;
              return null;
            }
            // hideIdentity 模式(debug 多人):只显示自己/主公/死亡
            if (hideIdentity && !isPerspective && identity !== '主公' && player.alive) {
              return <span className={hiddenBadge}>暗</span>;
            }
            return (
              <span
                className={
                  identity === '主公' ? lordBadge :
                  identity === '忠臣' ? loyalistBadge :
                  identity === '反贼' ? rebelBadge :
                  renegadeBadge
                }
              >
                {identity}
              </span>
            );
          })()}
          {isPerspective && <span className={youBadge}>视角</span>}
          {isCurrentPlayer && <span className={turnBadge}>回合</span>}
          {isDead && <span> 💀</span>}
        </div>
        <div className={cx(
          player.health === 1 ? hpLow : player.health <= player.maxHealth / 2 ? hpMid : hpFull,
          isDamaged && hpFlash,
        )} key={`hp-${damageVersion}`}>
          ♥ {player.health}/{player.maxHealth}
        </div>
      </div>
      <div className={skillRow}>
        {player.skills.filter(s => !DEFAULT_SKILLS.has(s)).map(s => (
          <span key={s} className={skillTag}>{s}</span>
        ))}
      </div>
      <div className={infoRow}>
        <span>手牌: {player.handCount}</span>
      </div>
      {Object.keys(player.equipment).length > 0 && (
        <div className={equipRow}>
          {Object.entries(player.equipment).map(([slot, cardId]) => {
            const card = view.cardMap[cardId as string];
            const icon =
              slot === '武器' ? '⚔' :
              slot === '防具' ? '🛡' :
              slot === '进攻马' ? '🐎+' :
              slot === '防御马' ? '🐎-' :
              '💎';
            return <span key={slot}>{icon}{card?.name ?? cardId}</span>;
          })}
        </div>
      )}
      {player.marks.length > 0 && (
        <div className={markRow}>
          {player.marks.map(m => (
            <span key={m.id} className={markTag}>
              {m.id}{m.payload ? `(${JSON.stringify(m.payload)})` : ''}
            </span>
          ))}
        </div>
      )}
      {remainingSeconds !== null && (
        <div className={timerText}>⏱ {remainingSeconds}s</div>
      )}
    </div>
  );
}

// ==================== Styles ====================

const pageRoot = css`
  padding: 12px;
  font-family: 'Noto Sans SC', 'PingFang SC', sans-serif;
  background: linear-gradient(135deg, #0f0c29 0%, #1a1a2e 50%, #16213e 100%);
  color: #e0e0e0;
  min-height: 100vh;
  overflow-x: hidden;
`;

// Header
const headerBar = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: rgba(0,0,0,0.3);
  border-radius: 8px;
`;
const backBtn = css`
  border: 1px solid #555; border-radius: 4px; padding: 4px 12px;
  cursor: pointer; background: transparent; color: #e0e0e0; font-size: 13px;
`;
const headerCenter = css`display: flex; align-items: center; gap: 12px; font-size: 14px;`;
const roundBadge = css`
  background: #0f3460; border-radius: 4px; padding: 2px 8px;
  font-size: 12px; color: #8899aa;
`;
const phaseBadge = css`
  background: #e67e22; border-radius: 4px; padding: 2px 8px;
  font-size: 12px; color: #fff; font-weight: bold;
`;
const currentPlayerText = css`color: #ffd700;`;
const headerRight = css`display: flex; gap: 8px;`;
const perspectiveBtn = css`
  border: 1px solid #3498db; border-radius: 4px; padding: 4px 10px;
  cursor: pointer; background: transparent; color: #3498db; font-size: 12px;
`;
const goToBtn = css`
  border: 1px solid #555; border-radius: 4px; padding: 4px 10px;
  cursor: pointer; background: transparent; color: #aaa; font-size: 12px;
`;
const headerCountdown = css`
  color: #e67e22; font-weight: bold; font-size: 16px;
  background: rgba(230,126,34,0.15); border-radius: 4px; padding: 2px 8px;
  animation: pulse 1s ease-in-out infinite;
`;

// Prompt
const promptBox = css`
  border: 2px solid #e67e22; border-radius: 8px; padding: 12px 16px;
  background: rgba(230,126,34,0.15); margin-bottom: 12px;
`;
const promptBoxAwaiting = css`
  border: 2px solid #e74c3c; border-left: 4px solid #e74c3c;
  border-radius: 8px; padding: 12px 16px;
  background: rgba(231,76,60,0.1); margin-bottom: 12px;
`;
const promptCountdownBar = css`
  position: relative;
  width: 100%;
  height: 4px;
  background: rgba(231,76,60,0.2);
  border-radius: 2px;
  margin-top: 8px;
  overflow: hidden;
`;
const promptCountdownFill = css`
  height: 100%;
  background: #e74c3c;
  transition: width 0.2s linear;
`;
const promptTitle = css`color: #e67e22; font-weight: bold; font-size: 15px; margin-bottom: 4px;`;
const promptDesc = css`font-size: 14px; margin-bottom: 8px;`;
const promptActions = css`display: flex; gap: 8px; flex-wrap: wrap;`;
const promptBtn = css`
  border: 1px solid #888; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; background: rgba(0,0,0,0.3); color: #e0e0e0; font-size: 13px;
`;
const promptBtnPrimary = css`
  border: 1px solid #27ae60; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; background: rgba(39,174,96,0.2); color: #2ecc71; font-size: 13px; font-weight: bold;
`;

const waitingHint = css`
  text-align: center; color: #888; font-size: 13px; margin-bottom: 12px;
`;

// Seating
const seatingArea = css`margin-bottom: 16px;`;
const seatRowCenter = css`
  display: flex; justify-content: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap;
`;
const seatRowSpread = css`
  display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;
`;
const seatSlot160 = css`width: 160px;`;
const centerMeta = css`
  text-align: center; flex: 1;
`;
const metaText = css`font-size: 12px; color: #888;`;
const countdownText = css`font-size: 18px; color: #e67e22; font-weight: bold; margin-top: 4px;`;

// Seat card
const seatCard = css`
  border: 1px solid #333; border-radius: 8px; padding: 10px 14px;
  background: rgba(22,33,62,0.8); transition: all 0.2s; min-width: 180px;
`;
const seatCardActive = css`border: 2px solid #ffd700; box-shadow: 0 0 12px rgba(255,215,0,0.2);`;
const seatCardPerspective = css`border: 2px solid #3498db;`;
const seatCardDead = css`opacity: 0.35;`;
const seatCardClickable = css`cursor: pointer; &:hover { border-color: #e74c3c; }`;
const seatCardTargeted = css`outline: 3px solid #e74c3c;`;
const seatHeader = css`
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;
`;
const seatName = css`font-weight: bold; font-size: 14px;`;
const seatIndexBadge = css`
  display: inline-block;
  background: rgba(136,153,170,0.25);
  color: #8899aa;
  border-radius: 3px;
  padding: 1px 5px;
  margin-right: 6px;
  font-size: 10px;
  font-weight: normal;
  vertical-align: middle;
`;
const seatChar = css`color: #8899aa; font-size: 12px; margin-left: 4px;`;
const youBadge = css`
  background: #3498db; border-radius: 3px; padding: 1px 5px;
  font-size: 10px; color: #fff; margin-left: 6px; font-weight: bold;
`;
const turnBadge = css`
  background: #ffd700; border-radius: 3px; padding: 1px 5px;
  font-size: 10px; color: #000; margin-left: 4px; font-weight: bold;
`;
const lordBadge = css`
  background: #ffd700; border-radius: 3px; padding: 1px 5px;
  font-size: 10px; color: #4a2800; margin-left: 4px; font-weight: bold;
`;
const loyalistBadge = css`
  background: #4a90e2; border-radius: 3px; padding: 1px 5px;
  font-size: 10px; color: #fff; margin-left: 4px; font-weight: bold;
`;
const rebelBadge = css`
  background: #e74c3c; border-radius: 3px; padding: 1px 5px;
  font-size: 10px; color: #fff; margin-left: 4px; font-weight: bold;
`;
const renegadeBadge = css`
  background: #8e44ad; border-radius: 3px; padding: 1px 5px;
  font-size: 10px; color: #fff; margin-left: 4px; font-weight: bold;
`;
const hiddenBadge = css`
  background: #555; border-radius: 3px; padding: 1px 5px;
  font-size: 10px; color: #bbb; margin-left: 4px; font-weight: bold;
`;
const hpFull = css`color: #2ecc71; font-weight: bold; font-size: 13px;`;
const hpMid = css`color: #e67e22; font-weight: bold; font-size: 13px;`;
const hpLow = css`color: #e74c3c; font-weight: bold; font-size: 13px;`;
const equipRow = css`
  font-size: 12px;
  color: #f39c12;
  margin-top: 2px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;
const skillRow = css`margin-bottom: 4px;`;
const skillTag = css`
  display: inline-block; background: #0f3460; border-radius: 4px;
  padding: 1px 6px; margin-right: 4px; font-size: 11px; color: #8899aa;
`;
const infoRow = css`
  font-size: 12px; color: #888; display: flex; flex-wrap: wrap; gap: 8px;
`;
const markRow = css`font-size: 11px; color: #666; margin-top: 2px;`;
const markTag = css`margin-right: 6px;`;
const timerText = css`font-size: 12px; color: #e67e22; margin-top: 4px; font-weight: bold;`;

// Hand cards
const handSection = css`margin-bottom: 12px;`;
const handHeader = css`
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;
`;
const handTitle = css`font-size: 14px; color: #aaa; font-weight: bold;`;
const debugHint = css`color: #666; font-weight: normal; font-size: 12px;`;
const cancelBtn = css`
  border: 1px solid #555; border-radius: 4px; padding: 2px 8px;
  cursor: pointer; background: transparent; color: #aaa; font-size: 11px;
`;
const handList = css`display: flex; flex-wrap: wrap; gap: 8px;`;
const handCard = css`
  border: 2px solid #444; border-radius: 8px; padding: 10px 14px;
  cursor: pointer; background: rgba(22,33,62,0.9); min-width: 70px;
  text-align: center; transition: all 0.15s;
`;
const handCardSelected = css`
  border: 2px solid #3498db; background: rgba(52,152,219,0.2);
  transform: translateY(-4px); box-shadow: 0 4px 12px rgba(52,152,219,0.3);
`;
const handCardDisabled = css`opacity: 0.4; cursor: default;`;
const handCardRespondable = css`
  border: 2px solid #ffd700;
  box-shadow: 0 0 10px rgba(255,215,0,0.4);
  background: rgba(255,215,0,0.08);
`;
const discardCardSelected = css`
  opacity: 0.5;
  border: 2px solid #e74c3c;
  border-radius: 6px;
  background: rgba(231,76,60,0.18);
`;
const cardName = css`font-weight: bold; font-size: 15px; margin-bottom: 2px;`;
const cardSuit = css`font-size: 12px;`;
const emptyHand = css`color: #555; font-size: 13px; padding: 12px;`;

// ─── 动画状态样式 ───
const handCardNew = css`
  animation: drawCardIn 0.45s cubic-bezier(0.23, 1, 0.32, 1) both;
`;
const hpFlash = css`
  animation: damageFlash 0.6s ease-out both;
`;
const seatShaking = css`
  animation: damageShake 0.5s ease-out both;
`;
const seatDamageOverlay = css`
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 8px;
    pointer-events: none;
    animation: damageOverlay 0.6s ease-out both;
  }
  position: relative;
`;
const phaseAnimating = css`
  animation: phaseIn 0.35s ease-out both;
`;
const turnGlowing = css`
  animation: newTurnGlow 0.8s ease-out both;
`;

// Action bar
const actionBar = css`
  display: flex; gap: 12px; align-items: center; margin-bottom: 12px;
`;
const playBtn = css`
  border: none; border-radius: 6px; padding: 8px 20px;
  cursor: pointer; background: #27ae60; color: #fff; font-weight: bold; font-size: 14px;
`;
const endTurnBtn = css`
  border: none; border-radius: 6px; padding: 8px 20px;
  cursor: pointer; background: #e74c3c; color: #fff; font-weight: bold; font-size: 14px;
`;
const targetHint = css`font-size: 13px; color: #ffd700;`;

// Target selection
const targetSection = css`margin-bottom: 12px;`;
const targetTitle = css`font-size: 13px; color: #aaa; margin-bottom: 8px; font-weight: bold;`;
const targetList = css`display: flex; gap: 8px; flex-wrap: wrap;`;
const targetBtn = css`
  border: 1px solid #444; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; background: rgba(22,33,62,0.8); color: #e0e0e0; font-size: 13px;
`;
const targetBtnActive = css`border: 2px solid #e74c3c; background: rgba(231,76,60,0.2);`;
const targetBtnDisabled = css`opacity: 0.35; cursor: not-allowed; border-style: dashed;`;
// Skill buttons
const skillSection = css`margin-bottom: 8px;`;
const skillTitle = css`font-size: 13px; color: #aaa; margin-bottom: 6px; font-weight: bold;`;
const skillList = css`display: flex; gap: 8px; flex-wrap: wrap;`;
const skillBtn = css`
  border: 1px solid #9b59b6; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; background: rgba(155,89,182,0.15); color: #bb8fce; font-size: 13px; font-weight: bold;
  &:hover { background: rgba(155,89,182,0.3); }
`;

// Debug panel
const debugPanel = css`
  margin-top: 16px; border: 1px solid #333; border-radius: 8px;
  background: rgba(0,0,0,0.2);
`;
const debugSummary = css`
  padding: 8px 12px; cursor: pointer; color: #888; font-size: 12px;
`;
const debugContent = css`padding: 8px 12px; font-size: 12px; color: #aaa; font-family: monospace;`;
const debugHr = css`border: none; border-top: 1px solid #333; margin: 8px 0;`;
const debugPlayer = css`margin-bottom: 4px;`;
const debugDead = css`text-decoration: line-through; opacity: 0.5;`;

// Log panel
const logPanel = css`
  margin-top: 12px; border: 1px solid #333; border-radius: 8px;
  background: rgba(0,0,0,0.2);
`;
const logSummary = css`
  padding: 8px 12px; cursor: pointer; color: #888; font-size: 12px;
`;
const logContent = css`
  padding: 8px 12px; font-size: 12px; color: #aaa;
  max-height: 200px; overflow-y: auto;
`;
const logEmpty = css`color: #555; font-style: italic;`;
const logEntry = css`
  display: flex; gap: 8px; padding: 2px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
`;
const logTime = css`color: #666; min-width: 40px; flex-shrink: 0;`;
const logPlayer = css`color: #3498db; font-weight: bold; min-width: 40px; flex-shrink: 0;`;
const logText = css`color: #ccc;`;
