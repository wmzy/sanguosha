// src/client/components/ZoneInfoBar.tsx
// 中央信息区:牌堆数 + 处理区 + 弃牌堆。纯展示,数据全部由 view 传入。
// 处理区每张牌额外展示使用者名(由 settlementStack.top.cards 与事件源推导,这里采用简单策略:
//   - 记录进入处理区的牌及其「打牌人」,由打牌事件(打出atom)到达时同步处理区牌→使用者映射。
//   - 响应牌(闪/杀)归到打牌人(等于源使用者或目标,由移动牌事件"from.player"推得)。
// 本组件只读取 view.zones.processing 的 cardId,从引擎 settleStack 与日志查最近的「打出/获得」
// 推得归属,避免改引擎:在 viewRef.processingOwner 推导路径上保留 fallback。)
import { memo } from 'react';
import * as styles from './gameViewStyles';
import type { GameView } from '../../engine/types';
import { SUIT_COLOR } from './gameViewConstants';

export interface ZoneInfoBarProps {
  view: GameView;
}

function ZoneInfoBarImpl(props: ZoneInfoBarProps) {
  const { view } = props;
  const procIds = view.zones?.processing ?? [];

  // 处理区牌 → 使用者名映射:
  //   1) 优先用 settlementStack:每帧 frame.from 是发起者,frame.cards 是该帧内所有处理区牌。
  //      嵌套结算时从栈顶往栈底查,越上层优先级越高。
  //   2) fallback:按最近一条「使用 X」日志条目匹配 card.name。
  const ownerByCardId = new Map<string, string>();
  for (let f = view.settlementStack.length - 1; f >= 0; f--) {
    const frame = view.settlementStack[f];
    const owner = view.players.find((p) => p.index === frame.from)?.name ?? `P${frame.from}`;
    for (const cardId of frame.cards) {
      if (!ownerByCardId.has(cardId)) ownerByCardId.set(cardId, owner);
    }
  }
  // log fallback:仅给未被帧命中的牌赋值
  const recentUserByName = new Map<string, string>();
  for (let i = view.log.length - 1; i >= 0; i--) {
    const entry = view.log[i];
    const m = entry.text.match(/使用\s*([^\s→]+)/);
    if (!m) continue;
    const cardName = m[1];
    if (recentUserByName.has(cardName)) continue;
    const p = view.players.find((q) => q.index === entry.player);
    recentUserByName.set(cardName, p?.name ?? `P${entry.player}`);
    if (recentUserByName.size >= procIds.length) break;
  }

  return (
    <div className={styles.centerZoneInfo}>
      <div className={styles.metaText}>
        牌堆: {view.zones?.deckCount ?? Object.keys(view.cardMap).length} 张
      </div>
      {/* 处理区:中间结算的牌(判定牌 / 闪抵消杀 / 杀 / 锦囊) */}
      {(() => {
        if (procIds.length === 0) return null;
        return (
          <div
            className={styles.processingRow}
            title="处理区:正在结算的中间牌(判定/抵消/锦囊/杀等)"
          >
            <span className={styles.processingLabel}>处理区:</span>
            {procIds.map((cardId: string) => {
              const card = view.cardMap[cardId];
              if (!card) return null;
              const suitColor = SUIT_COLOR[card.suit] ?? '#ccc';
              const desc = card.description ?? '';
              const owner =
                ownerByCardId.get(cardId) ??
                recentUserByName.get(card.name) ??
                undefined;
              const ownerName = owner;
              return (
                <span
                  key={cardId}
                  className={styles.processingTag}
                  style={{ '--suit-color': suitColor } as React.CSSProperties}
                  title={desc || card.name}
                >
                  {ownerName && (
                    <span className={styles.processingOwner}>{ownerName}</span>
                  )}
                  <span className={styles.processingCardName}>{card.name}</span>
                  <span className={styles.processingSuit}>
                    {card.suit}
                    {card.rank}
                  </span>
                </span>
              );
            })}
          </div>
        );
      })()}
      {/* 弃牌堆:右上角一个小图标 + 数字 */}
      <div className={styles.discardPileRow}>
        <span className={styles.discardPileIcon} title="弃牌堆">
          🗂
        </span>
        <span className={styles.discardPileCount}>弃牌: {view.zones?.discardPileCount ?? 0}</span>
      </div>
    </div>
  );
}

/** memo: 只在牌堆数/弃牌堆/处理区变化时重渲染 */
function zoneInfoBarPropsEqual(prev: ZoneInfoBarProps, next: ZoneInfoBarProps): boolean {
  const az = prev.view.zones;
  const bz = next.view.zones;
  // 处理区:比较 cardId 集合 + 对应卡片名(cardMap 查找确定性)
  const aProc = az?.processing ?? [];
  const bProc = bz?.processing ?? [];
  if (aProc.length !== bProc.length) return false;
  for (let i = 0; i < aProc.length; i++) {
    if (aProc[i] !== bProc[i]) return false;
  }
  // 处理区牌相同但玩家名可能变化(分配武将后):比较末尾几条日志与玩家名
  if (prev.view.players.length !== next.view.players.length) return false;
  for (let i = 0; i < prev.view.players.length; i++) {
    if (prev.view.players[i].name !== next.view.players[i].name) return false;
  }
  // 末尾日志条目变化时也需要重算「使用者」映射
  const aLog = prev.view.log;
  const bLog = next.view.log;
  if (aLog.length !== bLog.length) return false;
  if (aLog.length > 0) {
    const aLast = aLog[aLog.length - 1];
    const bLast = bLog[bLog.length - 1];
    if (aLast.text !== bLast.text || aLast.player !== bLast.player) return false;
  }
  return (
    (az?.deckCount ?? 0) === (bz?.deckCount ?? 0) &&
    (az?.discardPileCount ?? 0) === (bz?.discardPileCount ?? 0)
  );
}

export const ZoneInfoBar = memo(ZoneInfoBarImpl, zoneInfoBarPropsEqual);
