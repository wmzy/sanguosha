// src/engine/atoms/询问杀.ts
// 询问杀:等待型 atom — 等待 target 出杀(决斗/南蛮入侵/借刀杀人/激将 等)。
// 与 询问闪 逐行同构(差异仅 atom type 与响应牌名),由 makeCardAskAtom 工厂生成;
// 响应牌名登记于 core/card-response-availability 的 ASK_CARD_NAME(单点)。
import { makeCardAskAtom } from './_helpers';

export const 询问杀 = makeCardAskAtom('询问杀', '杀');
