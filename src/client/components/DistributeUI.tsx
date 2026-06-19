// src/client/components/DistributeUI.tsx
// 分配 UI(distribute 类 prompt)
//
// 两种模式(由 prompt.mode 决定):
//  - 'allocate'(默认,遗计/仁德):手牌逐张分配给若干目标,提交 `allocation=[{target,cardIds}]`。
//  - 'select'(制衡):只选若干张牌,提交 `cardIds=[...]`,无目标。
//
// 两种调用来源(由调用方决定):
//  - 被动 pending(GameView 在 pending 区渲染):actionType='respond',静态 cardIds(遗计摸出的两张)。
//  - 主动技(GameView 点技能按钮弹出):actionType 由 SkillActionDef 给出(如 'use'),
//    source='hand'/'handAndEquip' 动态从视角手牌/装备取。
import { useState, useMemo } from 'react';
import { css } from '@linaria/core';
import type { GameView, Card, Json, DistributePrompt } from '../../engine/types';

export interface DistributeUIProps {
  skillId: string;
  /** 提交时使用的 actionType(被动='respond',主动='use') */
  actionType: string;
  /** distribute prompt(含 mode/source/cardIds/maxPerTarget 等配置) */
  prompt: DistributePrompt;
  /** 可选牌列表(已由调用方按 source 解析好):静态 cardIds 或动态手牌/装备 */
  cardIds: string[];
  players: GameView['players'];
  /** 当前视角座次(allocate 模式下用于 allowSelf 判断) */
  viewer: number;
  onSend: (skillId: string, actionType: string, params: Record<string, Json>) => void;
  cardMap: GameView['cardMap'];
}

export function DistributeUI({ skillId, actionType, prompt, cardIds, players, viewer, onSend, cardMap }: DistributeUIProps) {
  const mode = prompt.mode ?? 'allocate';
  const maxPerTarget = prompt.maxPerTarget ?? 99;
  const minPerTarget = prompt.minPerTarget ?? 1;
  const minTotal = prompt.minTotal ?? 1;
  const maxTotal = prompt.maxTotal ?? 99;
  const allowSelf = prompt.allowSelf ?? true;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allocations, setAllocations] = useState<Array<{ target: number; cardIds: string[] }>>([]);

  const perTargetCount = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of allocations) map.set(a.target, (map.get(a.target) ?? 0) + a.cardIds.length);
    return map;
  }, [allocations]);

  // ─── select 模式:只选牌,提交 cardIds ─────────────────────
  if (mode === 'select') {
    const toggle = (id: string) => setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    const totalSelected = selected.size;
    const atMax = totalSelected >= maxTotal;
    const canSubmit = totalSelected >= minTotal && totalSelected <= maxTotal;
    const submit = () => {
      if (!canSubmit) return;
      onSend(skillId, actionType, { cardIds: [...selected] });
      setSelected(new Set());
    };
    return (
      <div className={promptActions} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className={promptHint}>
          {prompt.title}{minTotal > 1 || maxTotal < 99 ? `(选 ${minTotal}-${maxTotal} 张)` : ''} · 已选 {totalSelected}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {cardIds.map(id => {
            const c: Card | undefined = cardMap[id];
            const sel = selected.has(id);
            const disabled = !sel && atMax;
            return (
              <button
                key={id}
                className={sel ? promptBtnPrimary : promptBtn}
                disabled={disabled}
                onClick={() => toggle(id)}
              >
                {c?.name ?? id} {c ? `${c.suit}${c.rank}` : ''}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          <button className={promptBtn} onClick={() => setSelected(new Set())} disabled={totalSelected === 0}>清空</button>
          <button className={promptBtnPrimary} onClick={submit} disabled={!canSubmit}>确认({totalSelected})</button>
        </div>
      </div>
    );
  }

  // ─── allocate 模式:分配牌给目标 ────────────────────────
  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const give = (targetIdx: number) => {
    if (selected.size === 0) return;
    const already = perTargetCount.get(targetIdx) ?? 0;
    if (already + selected.size > maxPerTarget) return;
    const newAlloc = [...allocations, { target: targetIdx, cardIds: [...selected] }];
    setAllocations(newAlloc);
    setSelected(new Set());
    if (newAlloc.flatMap(a => a.cardIds).length >= cardIds.length) {
      onSend(skillId, actionType, { allocation: newAlloc });
      setAllocations([]);
    }
  };
  const submitAlloc = () => {
    const total = allocations.flatMap(a => a.cardIds).length;
    if (total < minTotal) return;
    onSend(skillId, actionType, { allocation: allocations });
    setAllocations([]);
    setSelected(new Set());
  };
  const givenIds = new Set(allocations.flatMap(a => a.cardIds));
  const remaining = cardIds.filter(id => !givenIds.has(id) && !selected.has(id));
  const totalAllocated = allocations.flatMap(a => a.cardIds).length;

  return (
    <div className={promptActions} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div className={promptHint}>
        {prompt.title} · 已分配 {totalAllocated}/{cardIds.length}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {remaining.map(id => {
          const c: Card | undefined = cardMap[id];
          return (
            <button
              key={id}
              className={selected.has(id) ? promptBtnPrimary : promptBtn}
              onClick={() => toggle(id)}
              style={selected.has(id) ? { borderColor: '#2ecc71', borderWidth: 2 } : undefined}
            >
              {c?.name ?? id} {c ? `${c.suit}${c.rank}` : ''}
            </button>
          );
        })}
        {selected.size > 0 && <span style={{ fontSize: 12, color: '#aaa', alignSelf: 'center' }}>已选 {selected.size} 张,点击下方玩家分配</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {players.map((p, i) => {
          if (!p.alive) return null;
          if (!allowSelf && i === viewer) return null;
          if (prompt.targetFilter && !prompt.targetFilter({ players } as GameView, i)) return null;
          const already = perTargetCount.get(i) ?? 0;
          const atLimit = already >= maxPerTarget;
          return (
            <button key={i} className={promptBtn} disabled={selected.size === 0 || atLimit} onClick={() => give(i)}>
              {p.name}{already > 0 ? ` (${already}/${maxPerTarget})` : ''}
            </button>
          );
        })}
        <button className={promptBtn} onClick={submitAlloc} disabled={totalAllocated < minTotal}>
          提交分配
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
        <button className={promptBtn} onClick={() => { setAllocations([]); setSelected(new Set()); }} disabled={totalAllocated === 0}>
          清空
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
const promptHint = css`
  text-align: center; color: #f1c40f; font-size: 13px; font-weight: bold;
`;
