// 回复体力:target 玩家回复 amount 体力(不超过 maxHealth)
// 与 失去体力 同构(sign=+1、clamp=true),由 _helpers.makeHealthDeltaAtom 统一产出;
// source 字段由调用方携带(如 桃 的使用者),本 atom 不消费。
import type { AtomDefinition } from '../types';
import { makeHealthDeltaAtom } from './_helpers';

export const 回复体力: AtomDefinition<{ target: number; amount: number; source?: number }> =
  makeHealthDeltaAtom('回复体力', {
    sign: 1,
    clamp: true,
    effect: { sound: 'heal', particles: 'ice', duration: 800 },
    logVerb: '回复',
  });
