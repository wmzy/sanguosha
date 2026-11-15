// src/engine/atoms/询问闪.ts
// 询问闪:等待型 atom — 等待 target 出闪(杀/万箭齐发 的目标响应)。
// 与 询问杀 逐行同构(差异仅 atom type 与响应牌名),由 makeCardAskAtom 工厂生成;
// 响应牌名登记于 core/card-response-availability 的 ASK_CARD_NAME(单点)。
import { makeCardAskAtom } from './_helpers';

export const 询问闪 = makeCardAskAtom('询问闪', '闪');
