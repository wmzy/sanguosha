// src/client/components/OverlaysLayer.tsx
// 选将/身份遮罩层。纯展示组件,不含视角切换逻辑。
// 视角控制 UI 由上层通过 overlaySlot 注入,透传到各遮罩的角落。
import { type ReactNode } from 'react';
import { CharSelectOverlay } from './CharSelectOverlay';
import { CharSelectWaitingOverlay } from './CharSelectWaitingOverlay';
import { IdentityRevealOverlay } from './IdentityRevealOverlay';
import { getCharacterMeta } from '../../engine/character-meta';
import type { GameView, PendingView, Json } from '../../engine/types';

export interface OverlaysLayerProps {
  view: GameView;
  perspectiveIdx: number;
  // 选将状态(由 useCharSelect 派生,父组件传入)
  isCharSelectPending: boolean;
  charSelect: {
    candidates: Array<{ name: string; skills: string[] }>;
    target: number;
    pending: PendingView | null;
  } | null;
  charSelectInProgress: boolean;
  // 身份揭示态(父组件持有)
  showIdentityReveal: boolean;
  onIdentityConfirm: () => void;
  onAction: (action: {
    skillId: string;
    actionType: string;
    ownerId: number;
    params: Record<string, Json>;
  }) => void;
  /** 遮罩角落插槽:上层渲染视角控制等 debug UI。 */
  overlaySlot?: ReactNode;
}

export function OverlaysLayer(props: OverlaysLayerProps) {
  const {
    view,
    perspectiveIdx,
    isCharSelectPending,
    charSelect,
    charSelectInProgress,
    showIdentityReveal,
    onIdentityConfirm,
    onAction,
    overlaySlot,
  } = props;

  const charCandidates = charSelect?.candidates ?? [];
  const charSelectTarget = charSelect ? charSelect.target : -1;
  const charSelectPending = charSelect?.pending ?? null;

  return (
    <>
      {/* 身份揭示弹窗:身份分配后立即显示,盖在选将遮罩之上(zIndex 10000 > 9999)。
          玩家点「确认」后 showIdentityReveal 置 false,露出下方的选将界面。
          因此身份揭示发生在选将之前,符合开局先亮身份再选将的流程。 */}
      {showIdentityReveal && view.players[view.viewer]?.identity && (
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
          lordCharacter={view.players.find((p) => p.identity === '主公')?.character}
          overlaySlot={overlaySlot}
        />
      )}

      {/* ─── 选将阶段等待遮罩 ───
          两种场景统一用 CharSelectWaitingOverlay:
          A) 并行选将:当前视角已选但其他人还在选(perspectiveCharSelected=true)
          B) 串行选将(主公先选):当前视角还没轮到选,但选将正在进行
             (isCharSelectPending=false, charSelectInProgress=true, perspectiveCharSelected=false)
          场景 B 之前靠 buildView 的 fake pending(view.pending 指向主公 slot)驱动
          CharSelectOverlay 渲染「等待主公选将」,但 fake pending 会造成倒计时共用 bug。
          现在 buildView 不再给非选将玩家设 pending,改由这里直接渲染等待遮罩。 */}
      {!isCharSelectPending && charSelectInProgress && (
        <CharSelectWaitingOverlay
          view={view}
          perspectiveIdx={perspectiveIdx}
          overlaySlot={overlaySlot}
        />
      )}
    </>
  );
}
