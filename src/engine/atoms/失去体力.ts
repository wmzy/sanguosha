// 失去体力:target 玩家失去 amount 体力(非伤害——不触发反馈/奸雄等伤害技)。
// 与 造成伤害时 一致:只扣体力,不在此处置 alive——体力归零时由 系统规则 的
// '失去体力' after-hook 触发 濒死(求桃)流程,无人救援才由 系统处理牌 置 alive=false。
// 与 回复体力 同构(sign=-1、无钳制),由 _helpers.makeHealthDeltaAtom 统一产出。
import type { AtomDefinition } from '../types';
import { makeHealthDeltaAtom } from './_helpers';

export const 失去体力: AtomDefinition<{ target: number; amount: number }> =
  makeHealthDeltaAtom('失去体力', {
    sign: -1,
    clamp: false,
    effect: { sound: 'lose_health', animation: 'shake', duration: 800 },
    logVerb: '失去',
  });
