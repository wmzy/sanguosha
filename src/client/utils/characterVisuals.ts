// src/client/utils/characterVisuals.ts
// 武将卡视觉派生共用工具:座位卡(PlayerSeatView)/视角大卡(PlayerCardLarge)/
// 选将等待遮罩(CharSelectWaitingOverlay)三处共用的「武将名 → 势力/势力色/立绘」
// 派生、立绘加载失败回退、身份章样式选择,收敛于此,组件不再各留副本。

import type { SyntheticEvent } from 'react';
import { FACTION_BG } from '../components/gameViewConstants';
import { getCharacterMeta } from '../../engine/data/character-meta';
import { getCharacterImage } from '../assets/imageAssets';

/** 未注册武将的势力回退(群)与势力色回退(紫) */
export const DEFAULT_FACTION = '群';
export const DEFAULT_FACTION_COLOR = '#8e44ad';

export interface CharacterCardVisuals {
  /** 势力名(魏/蜀/吴/群),未注册武将回退 '群' */
  faction: string;
  /** 势力背景色(FACTION_BG 查表),查不到回退紫色 */
  factionColor: string;
  /** 立绘资源 URL;无武将/无素材时 null(由调用方走势力色/文字回退) */
  charImg: string | null;
  /** 最大体力(选将等待遮罩的血点数用),未注册武将回退 4 */
  maxHealth: number;
}

/** 武将名 → 势力/势力色/立绘 统一派生(纯函数,无 hook 依赖)。 */
export function getCharacterCardVisuals(character: string): CharacterCardVisuals {
  const charInfo = character ? getCharacterMeta(character) : undefined;
  const faction = charInfo?.faction ?? DEFAULT_FACTION;
  return {
    faction,
    factionColor: FACTION_BG[faction] ?? DEFAULT_FACTION_COLOR,
    charImg: character ? getCharacterImage(character) : null,
    maxHealth: charInfo?.maxHealth ?? 4,
  };
}

/** 立绘 <img> 加载失败(无素材/404):隐藏 <img>,让卡牌保留势力色底/文字回退。
 *  刻意不改组件 state(座次很多,每张卡挂 state 会拖慢重渲染),只动内联 display。 */
export function hideImgOnError(e: SyntheticEvent<HTMLImageElement>): void {
  e.currentTarget.style.display = 'none';
}

/** 身份章样式表:主公金/忠臣蓝/反贼红/内奸紫;hidden 为非四身份的回退样式
 *  (座位卡传暗章样式,大卡传空串走 base 样式)。 */
export interface IdentityStampClasses {
  lord: string;
  loyalist: string;
  rebel: string;
  renegade: string;
  hidden: string;
}

/** 身份 → 身份章样式类(替代组件内四级嵌套三元;样式本体随卡型各持一套)。 */
export function identityStampClass(
  identity: string | undefined | null,
  classes: IdentityStampClasses,
): string {
  switch (identity) {
    case '主公':
      return classes.lord;
    case '忠臣':
      return classes.loyalist;
    case '反贼':
      return classes.rebel;
    case '内奸':
      return classes.renegade;
    default:
      return classes.hidden;
  }
}
