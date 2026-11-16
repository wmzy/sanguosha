// src/engine/data/characters/index.ts — 武将定义汇总(按势力文件聚合)。

export * from './wei';
export * from './shu';
export * from './wu';
export * from './qun';

import { weiCharacters } from './wei';
import { shuCharacters } from './shu';
import { wuCharacters } from './wu';
import { qunCharacters } from './qun';

export const allCharacters = [
  ...weiCharacters,
  ...shuCharacters,
  ...wuCharacters,
  ...qunCharacters,
];
