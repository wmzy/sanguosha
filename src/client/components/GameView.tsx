// src/client/components/GameView.tsx
// 新 ENGINE-DESIGN 完整游戏界面 — 参照老 GameBoard + DebugPlayerList 设计
//
// 布局: GameHeader → 提示区 → 座位布局(5人) → 手牌区 → 操作面板 → 调试面板
// 特性: 视角切换、倒计时、装备区、座位布局、操作提示、弃牌选择
import { useState, useMemo, useCallback, useEffect } from 'react';
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

// ─── 基本技能(不在 UI 上显示) ───
const BASIC_SKILLS = new Set([
  '回合管理', '装备通用', '杀', '闪', '桃', '酒',
  '过河拆桥', '顺手牵羊', '无中生有', '桃园结义', '借刀杀人',
  '决斗', '南蛮入侵', '万箭齐发', '乐不思蜀', '无懈可击', '反馈',
]);

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

// ─── 主组件 ───
export function GameViewComponent({ view, onAction, onDeleteRoom }: Props) {
  // 视角: 默认看自己,可切换
  const [perspectiveIdx, setPerspectiveIdx] = useState(view.viewer);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedForDiscard, setSelectedForDiscard] = useState<Set<string>>(new Set());

  // 同步 viewer(服务器可能重连后变化)
  // 有待回应请求时,自动切换视角到目标玩家
  useEffect(() => {
    if (view.pending) {
      const targetIdx = view.pending.target;
      if (targetIdx >= 0 && targetIdx < view.players.length) setPerspectiveIdx(targetIdx);
    } else {
      // 无 pending 时回到当前玩家视角
      setPerspectiveIdx(view.currentPlayerIndex);
    }
  }, [view.pending?.target, view.currentPlayerIndex]);
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
  // view 变化时,重新注册所有玩家的技能前端 actions(defineAction)
  const skillActionsKey = view.players.map(p => `${p.name}:${p.skills.join(',')}`).join('|');
  const skillActions = useMemo(() => {
    clearRegistry();
    for (const p of view.players) {
      registerSkillActions(p.index, p.skills);
    }
    // 返回当前视角玩家的 action 定义
    return getActionsForPlayer(perspectiveIdx);
  }, [skillActionsKey, perspectiveIdx]);

  // 视角玩家的手牌(debug 模式所有人可见)
  const perspectiveHand: Card[] = perspective?.hand ?? [];
  const viewerHand: Card[] = view.players[view.viewer]?.hand ?? [];

  // 待回应:调试模式下自动跟到 pending target 的视角
  const pending = view.pending;
  const pendingTargetIdx = pending?.target ?? -1;
  const isPerspectiveAwaiting = pending !== null && pendingTargetIdx === perspectiveIdx;
  // debug 模式:viewer 可以代打任何玩家;正式模式:必须视角=自己
  const canOperate = true; // debug 模式永远允许操作
  const isMyAwaiting = isPerspectiveAwaiting && canOperate;

  // 调试模式:pending 出现时自动切换视角到 target 玩家
  useEffect(() => {
    if (pending && pendingTargetIdx >= 0 && pendingTargetIdx !== perspectiveIdx) {
      setPerspectiveIdx(pendingTargetIdx);
      setSelectedCardId(null);
      setSelectedTarget(null);
    }
  }, [pendingTargetIdx, pending]);

  // 倒计时:pending 回应优先,否则用 turnDeadline
  const deadline = pending?.deadline ?? view.turnDeadline;
  const remainingSeconds = useCountdownSeconds(deadline);

  // 倒计时到 0 自动跳过
  useEffect(() => {
    if (remainingSeconds !== null && remainingSeconds <= 0) {
      if (isMyAwaiting) {
        // 有 pending 回应 → 自动不出
        handleRespond();
      } else if (isMyTurn && canOperate) {
        // 自己回合 → 自动结束
        handleEndTurn();
      }
    }
  }, [remainingSeconds]);

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
    return canAttack(perspectiveIdx, i);
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
      if (idx >= 0) params.targets = [idx];
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
        params.targets = [nameToIndex(selectedTarget)];
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
    if (cardId) {
      const card = perspectiveHand.find(c => c.id === cardId);
      if (card) send(card.name, 'respond', { cardId });
    } else {
      // 不出闪/杀:用对应 skill respond 但不带 cardId(后端 skill 收到空 cardId → 不做操作)
      // 根据当前 pending 的 atom type 决定用哪个 skill
      const atomType = pending?.atom?.type;
      const skillId = atomType === '询问杀' ? '杀' : '闪';
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
    // 回应模式(只有自己视角才能操作)
    if (isMyAwaiting) {
      if (card.name === '闪' || card.name === '杀') {
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


  return (
    <div className={pageRoot}>
      {/* ─── 头部 ─── */}
      <div className={headerBar}>
        <button className={backBtn} onClick={onDeleteRoom}>← 退出</button>
        <div className={headerCenter}>
          <span className={roundBadge}>第 {view.turn.round} 轮</span>
          <span className={phaseBadge}>{PHASE_LABELS[view.phase] ?? view.phase}</span>
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
        </div>
      </div>

      {/* ─── 操作提示 ─── */}
      {isPerspectiveAwaiting && pending && (
        <div className={promptBox}>
          <div className={promptTitle}>⚡ 需要回应 — {perspectiveName}</div>
          <div className={promptDesc}>
            {pending.prompt.title}
            {pending.prompt.description && <span> — {pending.prompt.description}</span>}
          </div>
          {canOperate && (
            <div className={promptActions}>
              <button className={promptBtn} onClick={() => handleRespond()}>不出</button>
              {perspectiveHand.filter(c => c.name === '闪' || c.name === '杀').map(c => (
                <button key={c.id} className={promptBtnPrimary} onClick={() => handleRespond(c.id)}>
                  {c.name} {c.suit}{c.rank}
                </button>
              ))}
            </div>
          )}
          {!canOperate && <div className={waitingHint}>等待 {perspectiveName} 回应...</div>}
        </div>
      )}

      {!isPerspectiveTurn && !isPerspectiveAwaiting && (
        <div className={waitingHint}>等待 {currentPlayerName} 操作...</div>
      )}
      {isPerspectiveTurn && view.phase === '出牌' && !isPerspectiveAwaiting && (
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
      {isPerspectiveTurn && view.phase === '弃牌' && !isPerspectiveAwaiting && (
        <div className={promptBox}>
          <div className={promptTitle}>🗑️ {perspectiveName} — 弃牌阶段</div>
          <div className={promptDesc}>{canOperate ? '请弃置多余的手牌' : `${perspectiveName} 正在弃牌...`}</div>
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
        <div className={handList}>
          {perspectiveHand.map((card, i) => {
            const isSelected = selectedCardId === card.id;
            const canPlay = isMyTurn && canOperate;
            const isAwaiting = isMyAwaiting && (card.name === '闪' || card.name === '杀');
            const suitColor = SUIT_COLOR[card.suit] ?? '#ccc';
            return (
              <div
                key={card.id}
                className={cx(handCard, isSelected && handCardSelected, (!canPlay && !isAwaiting) && handCardDisabled)}
                onClick={() => (canPlay || isAwaiting) && handleCardClick(card)}
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
      {isMyTurn && canOperate && view.phase === '出牌' && skillActions.length > 0 && (
        <div className={skillSection}>
          <div className={skillTitle}>武将技能:</div>
          <div className={skillList}>
            {skillActions.map(action => (
              <button key={`${action.skillId}:${action.actionType}`}
                className={skillBtn}
                onClick={() => handleSkillAction(action)}
                title={action.prompt.title}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}


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
      {selectedCardId && canOperate && isMyTurn && !isMyAwaiting && (
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
              {p.skills.filter(s => !BASIC_SKILLS.has(s)).length > 0 && (
                <span> 技能:{p.skills.filter(s => !BASIC_SKILLS.has(s)).join(',')}</span>
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
}

function PlayerSeatView({
  player, index, view, isCurrentPlayer, isPerspective,
  needsTarget, isTargetable, selectedTarget, remainingSeconds,
  onTargetClick, onPerspectiveChange,
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
      )}
      onClick={() => isClickable && onTargetClick(player.name)}
      onDoubleClick={() => onPerspectiveChange(index)}
    >
      <div className={seatHeader}>
        <div>
          <span className={seatName}>{player.name}</span>
          {player.character && <span className={seatChar}>({player.character})</span>}
          {isPerspective && <span className={youBadge}>视角</span>}
          {isCurrentPlayer && <span className={turnBadge}>回合</span>}
          {isDead && <span> 💀</span>}
        </div>
        <div className={player.health >= player.maxHealth ? hpFull : hpLow}>
          ♥ {player.health}/{player.maxHealth}
        </div>
      </div>
      <div className={skillRow}>
        {player.skills.filter(s => !BASIC_SKILLS.has(s)).map(s => (
          <span key={s} className={skillTag}>{s}</span>
        ))}
      </div>
      <div className={infoRow}>
        <span>手牌: {player.handCount}</span>
        {Object.entries(player.equipment).map(([slot, cardId]) => {
          const card = view.cardMap[cardId as string];
          return <span key={slot} className={equipTag}>[{slot}:{card?.name ?? cardId}]</span>;
        })}
      </div>
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
  display: flex; justify-content: center; gap: 12px; margin-bottom: 8px;
`;
const seatRowSpread = css`
  display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;
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
const seatChar = css`color: #8899aa; font-size: 12px; margin-left: 4px;`;
const youBadge = css`
  background: #3498db; border-radius: 3px; padding: 1px 5px;
  font-size: 10px; color: #fff; margin-left: 6px; font-weight: bold;
`;
const turnBadge = css`
  background: #ffd700; border-radius: 3px; padding: 1px 5px;
  font-size: 10px; color: #000; margin-left: 4px; font-weight: bold;
`;
const hpFull = css`color: #2ecc71; font-weight: bold; font-size: 13px;`;
const hpLow = css`color: #e74c3c; font-weight: bold; font-size: 13px;`;
const skillRow = css`margin-bottom: 4px;`;
const skillTag = css`
  display: inline-block; background: #0f3460; border-radius: 4px;
  padding: 1px 6px; margin-right: 4px; font-size: 11px; color: #8899aa;
`;
const infoRow = css`
  font-size: 12px; color: #888; display: flex; flex-wrap: wrap; gap: 8px;
`;
const equipTag = css`color: #f39c12;`;
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
const cardName = css`font-weight: bold; font-size: 15px; margin-bottom: 2px;`;
const cardSuit = css`font-size: 12px;`;
const emptyHand = css`color: #555; font-size: 13px; padding: 12px;`;

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
