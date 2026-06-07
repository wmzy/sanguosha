import { useMemo } from 'react';
import { css } from '@linaria/core';
import { ActionPanel } from './ActionPanel';
import { allCharacters } from '../../engine/characters';
import type { PendingAction } from '../../engine/types';
import { toCardInfoMap } from '../../engine/view/buildView';
import { colors } from '../theme';
import { useCountdownSeconds } from './game/Countdown';
import { GameHeader } from './game/GameHeader';
import { SeatingLayout } from './game/SeatingLayout';
import { GamePrompts } from './game/Prompts';
import { SkillButtons } from './game/SkillButtons';
import { HandCardsSection } from './game/HandCardsSection';
import { LogSection } from './game/LogSection';
import { DebugPanel } from './game/DebugPanel';
import type { GameBoardData, PlayerEntry } from './game/GameBoardData';

export type { GameBoardData, PlayerEntry };

const characterMap = Object.fromEntries(allCharacters.map((c) => [c.name, c]));

const pageRoot = css`
  display: flex;
  flex-direction: column;
  padding: 16px;
  background-color: ${colors.bg.page};
  min-height: 100vh;
  color: ${colors.text.primary};
`;

const targetHint = css`
  text-align: center;
  margin-bottom: 12px;
  color: ${colors.accent.amber};
  font-size: 14px;
`;

const sectionMargin12 = css`
  margin-bottom: 12px;
`;

function computeWaitingPlayers(pending: PendingAction | null): Set<string> {
  const s = new Set<string>();
  if (!pending) return s;
  switch (pending.type) {
    case '出牌阶段':
      s.add(pending.player);
      break;
    case '响应窗口':
      if (pending.window.type === 'trickResponse' && pending.window.responders) {
        const passed = pending.window.passedResponders ?? [];
        pending.window.responders
          .filter((r: string) => !passed.includes(r))
          .forEach((r: string) => s.add(r));
      } else {
        s.add(pending.window.defender);
      }
      break;
    case '弃牌阶段':
      s.add(pending.player);
      break;
    case '濒死窗口':
      s.add(pending.savers[pending.currentSaverIndex]);
      break;
    case '选择牌':
      s.add(pending.player);
      break;
    case '收获选牌':
      s.add(pending.pickOrder[pending.currentPickerIndex]);
      break;
    case '技能选择':
      s.add(pending.player);
      break;
  }
  return s;
}

export function GameBoard({ data }: { data: GameBoardData }) {
  const {
    state,
    me,
    myName,
    isMyTurn,
    selectedCardIndex,
    selectCard,
    selectedTarget,
    setSelectedTarget,
    canPlay,
    playableCardIds,
    needsTarget,
    validTargetList,
    handlePlayCard,
    handleEndTurn,
    switchPerspective,
    goToCurrentPlayer,
    availableSkills,
    handleActivateSkill,
    selectedSkillCards,
    toggleSkillCardSelection,
    handleSkillChoice,
    pendingPrompt,
    hasDodge,
    respondAction,
    respondToKill,
    respond,
    respondToDying,
    selectTargetCard,
    selectHarvestCard,
    needsDiscard,
    discardCount,
    selectedForDiscard,
    handleDiscard,
    handleSaveLog,
    myHand,
    orderedPlayers,
    getDistance,
    toggleAutoSkipWuxie,
    setPerspective,
    pending,
    playerOps,
  } = data;

  const getSeatNumber = (playerName: string): number =>
    state.playerOrder.indexOf(playerName) + 1;

  const deadline = pending?.deadline ?? null;
  const remainingSeconds = useCountdownSeconds(deadline);
  const waitingPlayers = computeWaitingPlayers(pending);

  const isKillResponse = pendingPrompt?.type === 'killResponse';
  const isAoeResponse = pendingPrompt?.type === 'aoeResponse';
  const isDyingWindow = pendingPrompt?.type === '濒死窗口';
  const isSkillPrompt = pendingPrompt?.type === '技能选择';
  const isCurrentPickerForSkill =
    isSkillPrompt && pending?.type === '技能选择' && pending.player === myName;

  const viewCardMap = useMemo(() => toCardInfoMap(state.cardMap), [state.cardMap]);
  const seatsWithAbilities = useMemo(
    () =>
      orderedPlayers.map((entry) => ({
        ...entry,
        abilities: characterMap[entry.characterId]?.abilities,
      })),
    [orderedPlayers],
  );

  return (
    <div className={pageRoot}>
      <GameHeader
        myName={myName}
        onSwitchPerspective={switchPerspective}
        onGoToCurrentPlayer={goToCurrentPlayer}
        hideGoToCurrentPlayer={isKillResponse || isDyingWindow}
      />

      {needsTarget && <div className={targetHint}>请选择目标玩家（点击玩家面板）</div>}

      <GamePrompts
        state={state}
        pendingPrompt={pendingPrompt}
        pending={pending}
        respondAction={respondAction}
        selectedSkillCards={selectedSkillCards}
        needsDiscard={needsDiscard}
        discardCount={discardCount}
        selectedForDiscard={selectedForDiscard}
        myName={myName}
        hasDodge={hasDodge}
        respondToKill={respondToKill}
        respond={respond}
        respondToDying={respondToDying}
        selectTargetCard={selectTargetCard}
        selectHarvestCard={selectHarvestCard}
        handleSkillChoice={handleSkillChoice}
        handleDiscard={handleDiscard}
      />

      <SeatingLayout
        ordered={seatsWithAbilities}
        cardMap={viewCardMap}
        myName={myName}
        currentPlayer={state.currentPlayer}
        needsTarget={needsTarget}
        validTargetList={validTargetList}
        selectedTarget={selectedTarget}
        selectedCardId={data.selectedCardId}
        remainingSeconds={remainingSeconds}
        waitingPlayers={waitingPlayers}
        round={state.meta.round}
        phase={state.phase}
        gameStatus={state.meta.status}
        deckCount={state.zones.deck.length}
        discardCount={state.zones.discardPile.length}
        isMyTurn={isMyTurn}
        isKillResponse={isKillResponse}
        isAoeResponse={isAoeResponse}
        isDyingWindow={isDyingWindow}
        getSeatNumber={getSeatNumber}
        getDistance={getDistance}
        setSelectedTarget={setSelectedTarget}
        setPerspective={setPerspective}
      />

      <div className={sectionMargin12}>
        <HandCardsSection
          hand={myHand}
          me={me}
          selectedIndex={selectedCardIndex}
          isMyTurn={isMyTurn}
          isKillResponse={isKillResponse}
          isDyingWindow={isDyingWindow}
          isSkillPrompt={isSkillPrompt}
          needsDiscard={needsDiscard}
          isCurrentPickerForSkill={isCurrentPickerForSkill}
          playableCardIds={playableCardIds}
          selectedForDiscard={selectedForDiscard}
          selectedSkillCards={selectedSkillCards}
          onSelectCard={selectCard}
          onToggleDiscard={data.toggleDiscardSelection}
          onToggleSkillCard={toggleSkillCardSelection}
        />
      </div>

      <div className={sectionMargin12}>
        <ActionPanel
          canPlay={canPlay}
          canEndTurn={
            isMyTurn &&
            (state.phase === '出牌' || state.phase === '弃牌') &&
            !isKillResponse &&
            !isDyingWindow
          }
          onPlayCard={handlePlayCard}
          onEndTurn={handleEndTurn}
        />
      </div>

      <SkillButtons availableSkills={availableSkills} onActivate={handleActivateSkill} />

      <LogSection operations={playerOps} onSaveLog={handleSaveLog} />

      <DebugPanel state={state} myName={myName} onToggleAutoSkipWuxie={toggleAutoSkipWuxie} />
    </div>
  );
}
