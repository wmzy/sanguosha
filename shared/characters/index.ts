export { 曹操, 司马懿, 夏侯惇, 张辽, 许褚, 郭嘉, 甄姬, weiCharacters } from './wei';
export { 刘备, 关羽, 张飞, 赵云, 诸葛亮, 黄月英, 马超, shuCharacters } from './shu';
export { 孙权, 甘宁, 吕蒙, 黄盖, 周瑜, 大乔, 陆逊, 孙尚香, wuCharacters } from './wu';
export { 华佗, 吕布, 貂蝉, qunCharacters } from './qun';

import type { CharacterConfig } from '../types';
import { weiCharacters } from './wei';
import { shuCharacters } from './shu';
import { wuCharacters } from './wu';
import { qunCharacters } from './qun';

export const allCharacters: CharacterConfig[] = [
  ...weiCharacters,
  ...shuCharacters,
  ...wuCharacters,
  ...qunCharacters,
];
