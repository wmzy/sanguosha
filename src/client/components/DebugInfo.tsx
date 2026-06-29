// src/client/components/DebugInfo.tsx
// 调试信息面板(底部 details)。
// debug 专属:显示引擎内部状态(phase/pending/各玩家 HP/手牌/装备/技能)。
// 由上层 debug 入口(DebugLobby)渲染,正式模式不出现。
import * as styles from './gameViewStyles';
import type { GameView, PendingView } from '../../engine/types';
import { DEFAULT_SKILLS as ENGINE_DEFAULT_SKILLS } from '../../engine/atoms/选将';

const DEFAULT_SKILLS = new Set(ENGINE_DEFAULT_SKILLS);

export interface DebugInfoProps {
  view: GameView;
  perspectiveName: string;
  pending: PendingView | null;
}

/** 装备名(从 cardMap 查,失败回退 cardId) */
function equipName(cardMap: GameView['cardMap'], cardId: string): string {
  return cardMap[cardId]?.name ?? cardId;
}

export function DebugInfo({ view, perspectiveName, pending }: DebugInfoProps) {
  const currentPlayerName = view.players[view.currentPlayerIndex].name;

  return (
    <details className={styles.debugPanel}>
      <summary className={styles.debugSummary}>调试信息</summary>
      <div className={styles.debugContent}>
        <div>
          phase: {view.phase} | round: {view.turn.round} | currentPlayer: {currentPlayerName}
        </div>
        <div>
          viewer: {view.players[view.viewer].name} | perspective: {perspectiveName}
        </div>
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
              <span key={slot}>
                {' '}
                [{slot}:{equipName(view.cardMap, cardId)}]
              </span>
            ))}
            {p.skills.filter((s) => !DEFAULT_SKILLS.has(s)).length > 0 && (
              <span> 技能:{p.skills.filter((s) => !DEFAULT_SKILLS.has(s)).join(',')}</span>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
