// src/components/debug/DebugPlayerList.tsx — 调试大厅的游戏视图
//
// T10 拆分：把 DebugLobby 中 state!==null 分支的 gameData 构造 +
// GameBoard 渲染抽出来。本组件为纯展示（受控组件），所有状态/回调来自父组件。
//
// 这里保留：PendingPrompt 派生（extractPendingPrompt）、defaultMe 默认值。
// 这些 helper 只服务于 GameBoardData 构造，不被 DebugLobby 其它部分使用。

import { useMemo } from 'react';
import type { GameAction, GameState, Json, ValidAction, PlayerState, PromptOption } from '../../../engine/types';
import type { Card } from '../../../shared/types';
import type { SelfView } from '../../../engine/view/types';
import { computeValidActions } from '../../../engine/validate';
import { getDistance } from '../../../engine/distance';
import { getPlayer } from '../../../engine/state';
import { buildPlayerView } from '../../../engine/view/buildView';
import type { Operation } from '../../../shared/log';
import { getSingleActivePlayer } from '../../utils/activePlayer';
import { saveState } from '../../utils/logFile';
import { rotatePlayers } from '../../utils/rotatePlayers';
import { GameBoard } from '../GameBoard';
import type { GameBoardData, PlayerEntry } from '../GameBoard';

interface PendingPrompt {
  type: string;
  text: string;
  responder?: string;
  responders?: string[];
  attacker?: string;
  validCards?: string[];
  dyingPlayer?: string;
  savers?: string[];
  currentSaver?: string;
  requiredCard?: string;
  targetPlayer?: string;
  targetCardIds?: string[];
  selectMode?: 'discard' | 'steal';
  options?: PromptOption[];
  wuxieChain?: { attacker: string; cardId: string }[];
  sourceName?: string;
  sourceUser?: string;
  trickTarget?: string;
}

function extractPendingPrompt(state: GameState): PendingPrompt | null {
  const pending = state.pending;
  if (!pending) return null;
  switch (pending.type) {
    case 'responseWindow':
      switch (pending.window.type) {
        case 'killResponse':
          return {
            type: 'killResponse',
            text: `${pending.window.attacker} 对你使用了杀！`,
            responder: pending.window.defender,
            attacker: pending.window.attacker,
            validCards: pending.window.validCards,
          };
        case 'aoeResponse':
          return {
            type: 'aoeResponse',
            text: pending.window.requiredCard === '杀' ? '南蛮入侵：请出杀响应' : '万箭齐发：请出闪响应',
            responder: pending.window.defender,
            attacker: pending.window.attacker,
            validCards: pending.window.validCards,
            requiredCard: pending.window.requiredCard,
          };
        case 'dyingResponse':
          return {
            type: 'dyingResponse',
            text: `${pending.window.defender} 濒死！`,
            responder: pending.window.defender,
            validCards: pending.window.validCards,
          };
        case 'duelResponse':
          return {
            type: 'duelResponse',
            text: '请出杀响应决斗',
            responder: pending.window.defender,
            validCards: pending.window.validCards,
          };
        case 'trickResponse': {
          const passedResponders = pending.window.passedResponders ?? [];
          const activeResponders = pending.window.responders?.filter(p => !passedResponders.includes(p));
          const win = pending.window;
          const chain = win.wuxieChain ?? [];
          const sourceName = (win.sourceCard ? state.cardMap[win.sourceCard]?.name : undefined) ?? '锦囊';
          const sourceUser = win.sourceUser ?? win.attacker;
          const trickTarget = win.trickTarget;
          const nextStatus = chain.length % 2 === 0 ? '失效' : '生效';
          const text = chain.length === 0
            ? `${sourceUser} 对 ${trickTarget} 用了 ${sourceName}，是否出无懈可击让它${nextStatus}？`
            : `是否出无懈可击？若出，锦囊将${nextStatus}。`;
          const result: PendingPrompt = {
            type: 'trickResponse',
            text,
            responder: win.defender,
            validCards: win.validCards,
            wuxieChain: chain,
            sourceName,
            sourceUser,
            trickTarget,
          };
          if (activeResponders && activeResponders.length > 0) {
            result.responders = activeResponders;
          }
          return result;
        }
      }
      break;
    case 'discardPhase':
      return { type: 'discardPhase', text: `请弃掉 ${pending.min}~${pending.max} 张牌` };
    case 'dyingWindow':
      return {
        type: 'dyingWindow',
        text: `${pending.dyingPlayer} 濒死！需要桃来救援`,
        dyingPlayer: pending.dyingPlayer,
        savers: pending.savers,
        currentSaver: pending.savers[pending.currentSaverIndex],
      };
    case 'skillPrompt':
      return { type: 'skillPrompt', text: pending.prompt.text, options: pending.prompt.options };
    case 'selectCard':
      return {
        type: 'selectCard',
        text: pending.mode === 'steal' ? '顺手牵羊：选择要获得的牌' : '过河拆桥：选择要弃掉的牌',
        targetPlayer: pending.target,
        targetCardIds: pending.cardIds,
        selectMode: pending.mode,
      };
    case 'harvestSelection':
      return {
        type: 'harvestSelection',
        text: `五谷丰登：${pending.pickOrder[pending.currentPickerIndex]} 选牌`,
        responder: pending.pickOrder[pending.currentPickerIndex],
        targetCardIds: pending.revealedCards,
        targetPlayer: pending.pickOrder[pending.currentPickerIndex],
      };
  }
  return null;
}

const defaultMe: PlayerState = {
  info: { name: '', characterId: '', role: '反贼', alive: false, gender: '男', faction: '群' },
  health: 0,
  maxHealth: 0,
  hand: [],
  equipment: {},
  pendingTricks: [],
  vars: {},
  tags: [],
  chained: false,
};

export interface DebugPlayerListUI {
  perspective: string;
  playerOrder: string[];
  selectedCardId: string | null;
  selectedTarget: string | null;
  selectedForDiscard: Set<string>;
  selectedSkillCards: Set<string>;
}

export interface DebugPlayerListActions {
  setPerspective: (p: string) => void;
  setPlayerOrder: (o: string[]) => void;
  setSelectedCardId: (id: string | null) => void;
  setSelectedTarget: (t: string | null) => void;
  toggleSelectedForDiscard: (id: string) => void;
  clearSelectedForDiscard: () => void;
  toggleSelectedSkillCard: (id: string) => void;
  clearSelectedSkillCards: () => void;
}

export interface DebugPlayerListProps {
  state: GameState;
  ui: DebugPlayerListUI;
  actions: DebugPlayerListActions;
  operations: Operation[];
  sendGameAction: (action: GameAction) => void;
}

export function DebugPlayerList({
  state,
  ui,
  actions,
  operations,
  sendGameAction,
}: DebugPlayerListProps) {
  const {
    perspective,
    playerOrder,
    selectedCardId,
    selectedTarget,
    selectedForDiscard,
    selectedSkillCards,
  } = ui;
  const {
    setPerspective,
    setPlayerOrder,
    setSelectedCardId,
    setSelectedTarget,
    toggleSelectedForDiscard,
    clearSelectedForDiscard,
    toggleSelectedSkillCard,
    clearSelectedSkillCards,
  } = actions;

  const gameData = useMemo<GameBoardData>(() => {
    const myName = perspective;
    const me: PlayerState = state.players[myName] ?? defaultMe;
    const isMyTurn = state.currentPlayer === myName;

    const validActions: ValidAction[] = computeValidActions(state, myName);
    const playCardAction = validActions.find(a => a.type === 'playCard');
    const playableCards = playCardAction?.cards ?? [];
    const respondAction = validActions.find(a => a.type === 'respond');
    const discardAction = validActions.find(a => a.type === 'discard');
    const useSkillAction = validActions.find(a => a.type === 'useSkill');
    const availableSkills = useSkillAction?.skills ?? [];

    const selectedCardEntry = selectedCardId !== null
      ? playableCards.find(pc => pc.cardId === selectedCardId)
      : undefined;
    const needsTarget = selectedCardId !== null && !!selectedCardEntry && selectedCardEntry.targets.length > 0;
    const validTargetList = selectedCardEntry?.targets ?? [];
    const canPlay = selectedCardId !== null
      && isMyTurn
      && state.phase === '出牌'
      && (!state.pending || state.pending.type === 'playPhase')
      && !!selectedCardEntry;
    const needsDiscard = discardAction != null;
    const discardMin = discardAction?.min ?? 0;
    const discardMax = discardAction?.max ?? 0;
    const pendingPrompt = extractPendingPrompt(state);
    const hasDodge = (respondAction?.cards?.length ?? 0) > 0;
    const playableCardIds = new Set(playableCards.map(pc => pc.cardId));
    const myHand: Card[] = me.hand.map(id => state.cardMap[id]).filter(Boolean);
    const selectedCardIndex = selectedCardId !== null ? me.hand.indexOf(selectedCardId) : null;

    // debug 模式：所有玩家都看得到完整 SelfView
    const orderedPlayers: PlayerEntry[] = playerOrder
      .filter(name => state.players[name])
      .map((name): PlayerEntry => {
        const player = state.players[name];
        const selfView: SelfView = buildPlayerView(state, name).self;
        return {
          name,
          panelData: { kind: 'self', data: selfView },
          characterId: player.info.characterId,
          role: player.info.role,
          alive: player.info.alive,
        };
      });

    return {
      state,
      cardMap: state.cardMap,
      me,
      myName,
      playerOrder,
      isMyTurn,
      selectedCardId,
      selectedCardIndex,
      selectCard: (cardId: string | null) => {
        setSelectedCardId(cardId);
        setSelectedTarget(null);
      },
      selectedTarget,
      setSelectedTarget,
      canPlay,
      validActions,
      playableCards,
      playableCardIds,
      needsTarget,
      validTargetList,
      handlePlayCard: () => {
        if (!selectedCardId || !isMyTurn) return;
        sendGameAction({ type: 'playCard', player: myName, cardId: selectedCardId, target: selectedTarget ?? undefined });
        setSelectedCardId(null);
        setSelectedTarget(null);
      },
      handleEndTurn: () => {
        if (!isMyTurn) return;
        if (needsDiscard) {
          if (selectedForDiscard.size === discardMin) {
            sendGameAction({ type: 'discard', player: myName, cardIds: [...selectedForDiscard] });
            clearSelectedForDiscard();
            setSelectedCardId(null);
          }
          return;
        }
        if (state.pending && state.pending.type !== 'playPhase') return;
        sendGameAction({ type: 'endTurn', player: myName });
        setSelectedCardId(null);
        setSelectedTarget(null);
        clearSelectedForDiscard();
      },
      needsDiscard,
      discardCount: discardMin,
      discardCards: discardAction?.cards ?? [],
      selectedForDiscard,
      toggleDiscardSelection: (cardId: string) => {
        if (selectedForDiscard.has(cardId)) {
          toggleSelectedForDiscard(cardId);
        } else if (selectedForDiscard.size < discardMax) {
          toggleSelectedForDiscard(cardId);
        }
      },
      handleDiscard: () => {
        if (!needsDiscard || selectedForDiscard.size !== discardMin) return;
        sendGameAction({ type: 'discard', player: myName, cardIds: [...selectedForDiscard] });
        clearSelectedForDiscard();
        setSelectedCardId(null);
      },
      pendingPrompt,
      hasDodge,
      respondAction,
      respondToKill: (playDodge: boolean) => {
        if (state.pending?.type !== 'responseWindow' || state.pending.window.defender !== myName) return;
        const respondCards = respondAction?.cards ?? [];
        const cardId = playDodge ? respondCards[0] : undefined;
        sendGameAction({ type: 'respond', player: myName, cardId });
      },
      respond: (cardId?: string) => {
        if (state.pending?.type !== 'responseWindow') return;
        if (state.pending.window.type === 'trickResponse' && state.pending.window.responders) {
          const passed = state.pending.window.passedResponders ?? [];
          const active = state.pending.window.responders.filter(p => !passed.includes(p));
          if (!active.includes(myName)) return;
        } else if (state.pending.window.defender !== myName) {
          return;
        }
        sendGameAction({ type: 'respond', player: myName, cardId });
      },
      respondToDying: (saverName: string | null) => {
        if (state.pending?.type !== 'dyingWindow') return;
        const currentSaver = state.pending.savers[state.pending.currentSaverIndex];
        if (!saverName) {
          sendGameAction({ type: 'respond', player: currentSaver });
          return;
        }
        if (saverName !== currentSaver) return;
        const saver = getPlayer(state, saverName);
        const peachId = saver.hand.find(id => state.cardMap[id]?.name === '桃');
        sendGameAction({ type: 'respond', player: saverName, cardId: peachId });
      },
      selectTargetCard: (cardId: string) => {
        if (state.pending?.type !== 'selectCard') return;
        sendGameAction({ type: 'respond', player: myName, cardIds: [cardId] });
      },
      selectHarvestCard: (cardId: string) => {
        if (state.pending?.type !== 'harvestSelection') return;
        const currentPicker = state.pending.pickOrder[state.pending.currentPickerIndex];
        if (currentPicker !== myName) return;
        sendGameAction({ type: 'respond', player: myName, cardId });
      },
      availableSkills,
      handleActivateSkill: (skillId: string, target?: string) => {
        if (!isMyTurn) return;
        sendGameAction({ type: 'useSkill', player: myName, skillId, target });
      },
      selectedSkillCards,
      toggleSkillCardSelection: (cardId: string) => {
        toggleSelectedSkillCard(cardId);
      },
      handleSkillChoice: (choice: Json) => {
        if (state.pending?.type !== 'skillPrompt') return;
        sendGameAction({ type: 'skillChoice', player: myName, choice });
        clearSelectedSkillCards();
      },
      myHand,
      orderedPlayers,
      switchPerspective: () => {
        const idx = state.playerOrder.indexOf(myName);
        const nextName = state.playerOrder[(idx + 1) % state.playerOrder.length];
        setPerspective(nextName);
        setPlayerOrder(rotatePlayers(state.playerOrder, nextName));
        setSelectedCardId(null);
        setSelectedTarget(null);
      },
      setPerspective: (playerName: string) => {
        setPerspective(playerName);
        setPlayerOrder(rotatePlayers(state.playerOrder, playerName));
        setSelectedCardId(null);
        setSelectedTarget(null);
      },
      goToCurrentPlayer: () => {
        const target = getSingleActivePlayer(state) ?? state.currentPlayer;
        setPerspective(target);
        setPlayerOrder(rotatePlayers(state.playerOrder, target));
        setSelectedCardId(null);
        setSelectedTarget(null);
      },
      handleSaveLog: () => {
        saveState(state);
      },
      toggleAutoSkipWuxie: () => {
        sendGameAction({ type: 'toggleAutoSkipWuxie' });
      },
      getDistance: (from: string, to: string) => getDistance(state, from, to),
      pending: state.pending,
      playerOps: operations,
    };
  }, [
    state,
    perspective,
    playerOrder,
    selectedCardId,
    selectedTarget,
    selectedForDiscard,
    selectedSkillCards,
    operations,
    sendGameAction,
    setPerspective,
    setPlayerOrder,
    setSelectedCardId,
    setSelectedTarget,
    toggleSelectedForDiscard,
    clearSelectedForDiscard,
    toggleSelectedSkillCard,
    clearSelectedSkillCards,
  ]);

  return <GameBoard data={gameData} />;
}
