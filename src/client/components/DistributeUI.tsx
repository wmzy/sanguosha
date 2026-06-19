// src/client/components/DistributeUI.tsx
// 分配 UI(distribute 类 prompt,如遗计) — 从 GameView.tsx 抽出
import { useState, useMemo } from 'react';
import { css } from '@linaria/core';
import type { GameView, Card, Json } from '../../engine/types';

export interface DistributeUIProps {
  skillId: string;
  cardIds: string[];
  players: GameView['players'];
  viewer: number;
  maxPerTarget: number;
  onSend: (skillId: string, actionType: string, params: Record<string, Json>) => void;
  cardMap: GameView['cardMap'];
}

export function DistributeUI({ skillId, cardIds, players, viewer, maxPerTarget, onSend, cardMap }: DistributeUIProps) {
  void viewer; // 保留参数:可能用于高亮自己(viewer 不分配给自己)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allocations, setAllocations] = useState<Array<{ target: number; cardIds: string[] }>>([]);
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  /** 每个目标已分配的卡牌数 */
  const perTargetCount = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of allocations) map.set(a.target, (map.get(a.target) ?? 0) + a.cardIds.length);
    return map;
  }, [allocations]);
  const give = (targetIdx: number) => {
    if (selected.size === 0) return;
    const already = perTargetCount.get(targetIdx) ?? 0;
    if (already + selected.size > maxPerTarget) return; // 超过上限
    const newAlloc = [...allocations, { target: targetIdx, cardIds: [...selected] }];
    setAllocations(newAlloc);
    setSelected(new Set());
    if (newAlloc.flatMap(a => a.cardIds).length >= cardIds.length) {
      onSend(skillId, 'respond', { allocation: newAlloc });
      setAllocations([]);
    }
  };
  const givenIds = new Set(allocations.flatMap(a => a.cardIds));
  const remaining = cardIds.filter(id => !givenIds.has(id) && !selected.has(id));
  return (
    <div className={promptActions} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {remaining.map(id => {
          const c: Card | undefined = cardMap[id];
          return (
            <button key={id} className={promptBtnPrimary} onClick={() => toggle(id)} style={selected.has(id) ? { borderColor: '#2ecc71', borderWidth: 2 } : undefined}>
              {c?.name ?? id} {c ? `${c.suit}${c.rank}` : ''}
            </button>
          );
        })}
        {selected.size > 0 && <span style={{ fontSize: 12, color: '#aaa', alignSelf: 'center' }}>已选 {selected.size} 张,点击下方玩家分配</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {players.map((p, i) => {
          if (!p.alive) return null;
          const already = perTargetCount.get(i) ?? 0;
          const atLimit = already >= maxPerTarget;
          return (
            <button key={i} className={promptBtn} disabled={selected.size === 0 || atLimit} onClick={() => give(i)}>
              {p.name}{already > 0 ? ` (${already}/${maxPerTarget})` : ''}
            </button>
          );
        })}
        <button className={promptBtn} onClick={() => { onSend(skillId, 'respond', { allocation: allocations }); setAllocations([]); setSelected(new Set()); }} disabled={allocations.length === 0}>
          提交分配
        </button>
      </div>
    </div>
  );
}

// ─── Styles ───
const promptActions = css`display: flex; gap: 8px; flex-wrap: wrap;`;
const promptBtn = css`
  border: 1px solid #888; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; background: rgba(0,0,0,0.3); color: #e0e0e0; font-size: 13px;
`;
const promptBtnPrimary = css`
  border: 1px solid #27ae60; border-radius: 6px; padding: 6px 14px;
  cursor: pointer; background: rgba(39,174,96,0.2); color: #2ecc71; font-size: 13px; font-weight: bold;
`;
