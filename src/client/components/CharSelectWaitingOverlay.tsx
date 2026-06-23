// src/client/components/CharSelectWaitingOverlay.tsx
// 选将期间的等待遮罩。两种场景:
//   A) 并行选将:当前视角已选完但其他人还在选 → 展示已选武将卡 + 等待提示
//   B) 串行选将(主公先选):当前视角还没轮到选 → 仅展示等待提示(无武将卡)
// 选将完成后(场景 A):遮罩中央展示玩家已选的武将卡(势力色背景 + 武将名 + 体力 + 技能),
// 明确反馈选择结果,禁止重新选将。
// 倒计时只在当前视角连接有选将 pending 时显示(场景 A 中自己还没选完的 slot);
// 不会显示其他玩家的倒计时(避免「共用倒计时」混淆)。

import type { GameView } from '../../engine/types';
import { CountdownBar } from './CountdownBar';
import { FACTION_BG } from './gameViewConstants';
import { getCharacterMeta } from '../../engine/character-meta';
import { DEFAULT_SKILLS as ENGINE_DEFAULT_SKILLS } from '../../engine/atoms/选将';
import * as styles from './gameViewStyles';

const DEFAULT_SKILLS = new Set(ENGINE_DEFAULT_SKILLS);

export interface CharSelectWaitingOverlayProps {
  view: GameView;
  perspectiveIdx: number;
  perspectiveName: string;
  onSwitchPerspective?: () => void;
}

export function CharSelectWaitingOverlay({
  view, perspectiveIdx, perspectiveName, onSwitchPerspective,
}: CharSelectWaitingOverlayProps) {
  // debug 多 WS 模型下,每个座次连接的 view.pending 直接就是该座次的选将询问;
  // 当前视角连接的 pending 是选将询问时,直接取其 deadline 用于倒计时。
  const isPendingCharSelect = view.pending?.atom?.type === '选将询问';
  const selectDeadline = isPendingCharSelect ? (view.pending!.deadline ?? null) : null;
  const selectTotalMs = isPendingCharSelect ? (view.pending!.totalMs ?? 60_000) : 60_000;
  // 找下一个未选将的座次名(用于切换按钮显示)
  const nextUnselected = view.players.find(p => !p.character && p.index !== perspectiveIdx);
  const nextName = nextUnselected?.name ?? view.players[(perspectiveIdx + 1) % view.players.length]?.name;
  const selectingNames = view.players.filter(p => !p.character).map(p => p.name).join('、');

  // 当前视角玩家已选的武将信息(用于展示选择结果)
  const me = view.players[perspectiveIdx];
  const selectedChar = me?.character ?? '';
  const charInfo = selectedChar ? getCharacterMeta(selectedChar) : undefined;
  const faction = charInfo?.faction ?? '群';
  const factionColor = FACTION_BG[faction] ?? '#8e44ad';
  const maxHealth = charInfo?.maxHealth ?? 4;
  // player.skills 包含默认技能,只展示武将自身技能(过滤掉默认技能)
  const charSkills = (me?.skills ?? []).filter(s => !DEFAULT_SKILLS.has(s));

  return (
    <div className={styles.charSelectWaitingOverlay}>
      {/* 已选武将卡:明确反馈选择结果,禁止重新选将 */}
      {selectedChar && (
        <div className={styles.selectedCharCard} style={{ background: factionColor }}>
          <div className={styles.selectedCharLabel}>你的选择</div>
          <div className={styles.selectedCharName}>{selectedChar}</div>
          <div className={styles.selectedCharFaction}>{faction}</div>
          <div className={styles.selectedCharHpRow}>
            {Array.from({ length: maxHealth }, (_, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#e74c3c',
                  boxShadow: '0 0 4px rgba(231, 76, 60, 0.5)',
                }}
              />
            ))}
          </div>
          {charSkills.length > 0 && (
            <div className={styles.selectedCharSkills}>{charSkills.join(' / ')}</div>
          )}
        </div>
      )}
      <div>{selectedChar ? '✅ 已选择武将,等待其他玩家选将...' : '⏳ 等待其他玩家选将...'}</div>
      <div className={styles.charSelectWaitingSub}>{selectingNames} 正在选将</div>
      {/* 选将倒计时 */}
      <div className={styles.charSelectWaitingCountdown}>
        <CountdownBar deadline={selectDeadline} totalMs={selectTotalMs} />
      </div>
      {/* debug 模式:切换到未选玩家代其选将 */}
      {onSwitchPerspective && (
        <button className={styles.charSelectWaitingSwitchBtn} onClick={onSwitchPerspective}>
          切换视角 → {nextName}
        </button>
      )}
    </div>
  );
}
