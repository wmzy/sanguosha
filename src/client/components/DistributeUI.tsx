// 分配 UI(distribute 类 prompt)— 受控版
//
// 选牌已下沉到手牌区(由 GameView 驱动 HandCard 高亮),
// 本组件只保留:提示文案 + 目标分配按钮(allocate 模式)+ 提交/清空。
// 所有状态(selected/allocations)由父组件持有,本组件纯展示 + 回调。
//
// 两种模式(由 prompt.mode 决定):
//  - 'allocate'(默认,遗计/仁德):选牌 → 点目标分配 → 提交 `allocation=[{target,cardIds}]`。
//  - 'select'(制衡):只选牌 → 提交 `cardIds=[...]`,无目标。
import { css } from '@linaria/core';
import type { GameView, Json, DistributePrompt } from '../../engine/types';

export interface DistributeUIProps {
  /** distribute prompt(含 mode/source/cardIds/maxPerTarget 等配置) */
  prompt: DistributePrompt;
  /** 可选牌 id 列表(已由调用方按 source 解析好) */
  cardIds: string[];
  players: GameView['players'];
  /** 当前视角座次(allocate 模式下用于 allowSelf 判断) */
  viewer: number;
  /** 已选中的牌(在手牌区点选,父组件持有) */
  selected: Set<string>;
  /** 已分配记录(allocate 模式,父组件持有) */
  allocations: Array<{ target: number; cardIds: string[] }>;
  /** 切换某张牌的选中态(手牌区点击时调用) */
  onToggleCard: (id: string) => void;
  /** 把当前 selected 分配给某目标(allocate 模式) */
  onAllocate: (targetIdx: number) => void;
  /** 清空 selected + allocations */
  onClear: () => void;
  /** 提交(select → cardIds;allocate → allocation) */
  onSubmit: () => void;
  /** 外部目标选择模式(仁德主动技):目标由座位区点选,本组件不渲染目标按钮,
   *  仅显示提示 + 已选目标 + 确定。需配合 externalTargetName 使用。 */
  externalTargetSelection?: boolean;
  /** 外部目标选择模式下,当前已选目标玩家名(null=未选) */
  externalTargetName?: string | null;
}

export function DistributeUI({
  prompt,
  cardIds,
  players,
  viewer,
  selected,
  allocations,
  onAllocate,
  onClear,
  onSubmit,
  externalTargetSelection,
  externalTargetName,
}: DistributeUIProps) {
  void cardIds; // 候选牌已下沉到手牌区,这里仅用于派生提示文案的 total
  const mode = prompt.mode ?? 'allocate';
  const maxPerTarget = prompt.maxPerTarget ?? 99;
  const minTotal = prompt.minTotal ?? 1;
  const maxTotal = prompt.maxTotal ?? 99;
  const allowSelf = prompt.allowSelf ?? true;

  const totalCandidate = cardIds.length;
  // 每目标已分配计数
  const perTargetCount = new Map<number, number>();
  for (const a of allocations)
    perTargetCount.set(a.target, (perTargetCount.get(a.target) ?? 0) + a.cardIds.length);

  // ─── select 模式:只选牌,提交 cardIds ─────────────────────
  if (mode === 'select') {
    const totalSelected = selected.size;
    const canSubmit = totalSelected >= minTotal && totalSelected <= maxTotal;
    const rangeHint = minTotal > 1 || maxTotal < 99 ? `(选 ${minTotal}-${maxTotal} 张)` : '';
    return (
      <div className={promptActionsCol}>
        <div className={promptHint}>
          {prompt.title}
          {rangeHint} · 已选 {totalSelected}
        </div>
        <div className={actionRow}>
          <button className={promptBtn} onClick={onClear} disabled={totalSelected === 0}>
            清空
          </button>
          <button className={promptBtnPrimary} onClick={onSubmit} disabled={!canSubmit}>
            确认({totalSelected})
          </button>
        </div>
      </div>
    );
  }

  // ─── allocate 模式:分配牌给目标 ────────────────────────
  const totalAllocated = allocations.flatMap((a) => a.cardIds).length;
  const allAllocated = totalAllocated >= totalCandidate;

  // ─── 外部目标选择模式(仁德):目标由座位区选,本组件只显示提示 + 确定 ──
  if (externalTargetSelection) {
    const canSubmit =
      selected.size >= minTotal && selected.size <= maxTotal && !!externalTargetName;
    return (
      <div className={promptActionsCol}>
        <div className={promptHint}>
          {prompt.title} · 已选 {selected.size} 张
          {externalTargetName ? (
            <>
              {' '}
              · 目标 <span className={allocSelHint}>{externalTargetName}</span>
            </>
          ) : (
            <span className={allocSelHint}> · 点玩家选目标</span>
          )}
        </div>
        <div className={actionRow}>
          <button
            className={promptBtn}
            onClick={onClear}
            disabled={selected.size === 0 && !externalTargetName}
          >
            清空
          </button>
          <button className={promptBtnPrimary} onClick={onSubmit} disabled={!canSubmit}>
            确定({selected.size}){externalTargetName ? ` → ${externalTargetName}` : ''}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={promptActionsCol}>
      <div className={promptHint}>
        {prompt.title} · 已分配 {totalAllocated}/{totalCandidate}
        {selected.size > 0 && (
          <span className={allocSelHint}> · 已选 {selected.size} 张,点击玩家分配</span>
        )}
      </div>
      <div className={targetRow}>
        {players.map((p, i) => {
          if (!p.alive) return null;
          if (!allowSelf && i === viewer) return null;
          if (prompt.targetFilter && !prompt.targetFilter({ players } as GameView, i)) return null;
          const already = perTargetCount.get(i) ?? 0;
          const atLimit = already >= maxPerTarget;
          const blocked = selected.size === 0 || already + selected.size > maxPerTarget || atLimit;
          return (
            <button key={i} className={promptBtn} disabled={blocked} onClick={() => onAllocate(i)}>
              {p.name}
              {already > 0 ? ` (${already}/${maxPerTarget})` : ''}
            </button>
          );
        })}
      </div>
      <div className={actionRow}>
        <button
          className={promptBtn}
          onClick={onClear}
          disabled={totalAllocated === 0 && selected.size === 0}
        >
          清空
        </button>
        {!allAllocated && (
          <button
            className={promptBtnPrimary}
            onClick={onSubmit}
            disabled={totalAllocated < minTotal}
          >
            提交分配({totalAllocated})
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───
const promptActionsCol = css`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  flex-wrap: wrap;
`;
const promptBtn = css`
  border: 1px solid #888;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.3);
  color: #e0e0e0;
  font-size: 13px;
`;
const promptBtnPrimary = css`
  border: 1px solid #27ae60;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  background: rgba(39, 174, 96, 0.2);
  color: #2ecc71;
  font-size: 13px;
  font-weight: bold;
`;
const promptHint = css`
  text-align: center;
  color: #f1c40f;
  font-size: 13px;
  font-weight: bold;
`;
const actionRow = css`
  display: flex;
  gap: 6px;
  justify-content: center;
`;
const targetRow = css`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
`;
const allocSelHint = css`
  color: #2ecc71;
  font-weight: normal;
  font-size: 12px;
`;
