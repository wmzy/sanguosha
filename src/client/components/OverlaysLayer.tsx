import { CharSelectOverlay } from './CharSelectOverlay';
import { CharSelectWaitingOverlay } from './CharSelectWaitingOverlay';
import { IdentityRevealOverlay } from './IdentityRevealOverlay';
import { getCharacterMeta } from '../../engine/character-meta';
import type { GameView, PendingView, Json } from '../../engine/types';

export interface OverlaysLayerProps {
  view: GameView;
  perspectiveIdx: number;
  perspectiveName: string;
  currentPlayerName: string;
  // 选将状态(由 useCharSelect 派生,父组件传入)
  isCharSelectPending: boolean;
  charSelect: { candidates: Array<{ name: string; skills: string[] }>; target: number; pending: PendingView | null } | null;
  charSelectInProgress: boolean;
  perspectiveCharSelected: boolean;
  // 身份揭示态(父组件持有)
  showIdentityReveal: boolean;
  onIdentityConfirm: () => void;
  // 视角切换回调(透传给选将遮罩)
  onSwitchPerspective?: () => void;
  /** 切到下一个未选将座次(选将等待蒙层用) */
  onSwitchToNextUnselected?: () => void;
  onGoToCurrentPlayer?: () => void;
  autoSwitchCtl?: { enabled: boolean; toggle: () => void };
  onAction: (action: { skillId: string; actionType: string; ownerId: number; params: Record<string, Json> }) => void;
}

export function OverlaysLayer(props: OverlaysLayerProps) {
  const {
    view,
    perspectiveIdx,
    perspectiveName,
    currentPlayerName,
    isCharSelectPending,
    charSelect,
    charSelectInProgress,
    perspectiveCharSelected,
    showIdentityReveal,
    onIdentityConfirm,
    onSwitchPerspective,
    onSwitchToNextUnselected,
    onGoToCurrentPlayer,
    autoSwitchCtl,
    onAction,
  } = props;

  const charCandidates = charSelect?.candidates ?? [];
  const charSelectTarget = charSelect ? charSelect.target : -1;
  const charSelectPending = charSelect?.pending ?? null;

  return (
    <>
      {/* 选将阶段(charSelectPending 或 charSelectInProgress)不显示身份弹窗——
          选将遮罩已含"你的身份"信息,身份弹窗 zIndex 更高会盖住选将界面和倒计时。
          选将完成后若仍未确认过身份,再显示。*/}
      {showIdentityReveal
        && view.players[view.viewer]?.identity
        && !isCharSelectPending
        && !charSelectInProgress && (
        <IdentityRevealOverlay
          identity={view.players[view.viewer].identity!}
          onConfirm={onIdentityConfirm}
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
          autoSwitchCtl={autoSwitchCtl}
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
          onSwitchPerspective={onSwitchToNextUnselected}
        />
      )}
    </>
  );
}
