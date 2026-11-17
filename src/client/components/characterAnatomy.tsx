// src/client/components/characterAnatomy.tsx
// 武将卡解剖学共享件:座位卡(PlayerSeatView)与视角大卡(PlayerCardLarge)中
// DOM 结构同构、仅样式类名不同的平行段落(名牌徽章组/判定区 chip 行/手牌数角标),
// 收敛于此。组件一律「类名作 props」注入——本文件不 import gameViewStyles,
// 也绝不组合/内插 css``(linaria 铁律,见 AuthPanel.tsx 注释);调用方各传一套
// linaria 类名,DOM 结构与样式定义保持原样。

import type { GameView } from '../../engine/types';
import { SUIT_COLOR } from './gameViewConstants';

/** 名牌徽章组的类名注入表(座位卡/大卡各持一套 linaria 类)。 */
export interface BadgeGroupClasses {
  group: string;
  you: string;
  turn: string;
  chain: string;
  /** 大卡无离线徽章,传空串即可(仅 isOffline=true 时使用) */
  offline: string;
}

export interface BadgeGroupProps {
  classes: BadgeGroupClasses;
  /** 视角玩家本人(「我」徽章) */
  isYou: boolean;
  /** 当前回合玩家(「回合」徽章) */
  isTurn: boolean;
  /** 横置(铁索连环「⛓」徽章) */
  isChained: boolean;
  /** 已断线(「离线」徽章;大卡不渲染,缺省 false) */
  isOffline?: boolean;
}

/** 名牌右侧徽章组:我 / 回合 / ⛓ / 离线(顺序固定,缺席的徽章不渲染)。 */
export function BadgeGroup({
  classes,
  isYou,
  isTurn,
  isChained,
  isOffline = false,
}: BadgeGroupProps) {
  return (
    <div className={classes.group}>
      {isYou && <span className={classes.you}>我</span>}
      {isTurn && <span className={classes.turn}>回合</span>}
      {isChained && (
        <span className={classes.chain} title="横置·铁索连环">
          ⛓
        </span>
      )}
      {isOffline && (
        <span className={classes.offline} title="该玩家已断线,等待重连">
          离线
        </span>
      )}
    </div>
  );
}

/** 判定区 chip 行的类名注入表。 */
export interface JudgeTagRowClasses {
  row: string;
  label: string;
  tag: string;
}

export interface JudgeTagRowProps {
  /** 判定区卡牌 id 列表(pendingTricks),空时本组件不渲染 */
  cardIds: string[];
  cardMap: GameView['cardMap'];
  classes: JudgeTagRowClasses;
}

/** 判定区行(延时锦囊):「判定:」标签 + 每张延时锦囊一枚紫边 chip(牌名 + 花色点数,
 *  花色色板走 SUIT_COLOR,描述/牌名进 title)。cardIds 为空时返回 null。 */
export function JudgeTagRow({ cardIds, cardMap, classes }: JudgeTagRowProps) {
  if (cardIds.length === 0) return null;
  return (
    <div className={classes.row}>
      <span className={classes.label}>判定:</span>
      {cardIds.map((cardId: string) => {
        const card = cardMap[cardId];
        const suitColor = SUIT_COLOR[card?.suit ?? '♠'] ?? '#ccc';
        return (
          <span
            key={cardId}
            className={classes.tag}
            style={{ '--suit-color': suitColor } as React.CSSProperties}
            title={card?.description || card?.name || cardId}
          >
            {card?.name ?? cardId}
            {card ? ` ${card.suit}${card.rank}` : ''}
          </span>
        );
      })}
    </div>
  );
}

/** 手牌数角标:🂠 + 手牌数(title 保留完整手牌信息)。 */
export function HandCountChip({ count, className }: { count: number; className: string }) {
  return (
    <span className={className} title={`手牌: ${count}`}>
      🂠 {count}
    </span>
  );
}
