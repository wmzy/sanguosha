// src/engine/death-flow.ts
// 死亡结算编排函数(对齐 flow-redesign.md 模块 B / death.md 5 时机)。
//
// 将单 atom(击杀)模式升级为「编排函数 + 时机标记 atom」模式(与 runUseFlow /
// runDamageFlow / runDecreaseLifeFlow 一致):
//   applyAtom(亮身份牌前) → applyAtom(亮身份牌) → applyAtom(死亡时)
//   → applyAtom(系统处理牌) → 奖惩(内联) → applyAtom(死亡后)
//
// 关键修复(模块 B 核心目标):断肠(移除死者凶手技能)从「系统处理牌之后」提前到
// 「死亡时」(系统处理牌之前)。原实现断肠挂在 击杀 before-hook,本就先于 apply,
// 但与系统奖惩耦合在单 atom 层级;拆分后 死亡时 为独立时机,断肠/行殇/界节命 在
// 系统处理牌弃牌前触发,语义对齐 death.md。
//
// 奖惩(反贼死→凶手摸3;忠臣被主公杀→主公弃牌)原为系统规则的 击杀 after-hook,
// 此处内联为 applyDeathPenalty(异步,await 摸牌/弃置)。
//
// killer 传递:runDyingFlow 调用前,runDecreaseLifeFlow 已把致死来源写入
// state.localVars['死亡/killer'](伤害有来源;失去体力/减上限无来源→undefined)。
// runDyingFlow 读取该值并作为参数传入,runDeathFlow 不再读写 localVars。
import type { GameState } from './types';
import { applyAtom } from './create-engine';

/** 死亡结算编排函数——对齐 death.md 5 时机。
 *
 *  时机1 亮身份牌前:焚心(转移身份)
 *  时机2 亮身份牌:揭示身份(view 层;所有视角可见)
 *  时机3 死亡时:行殇(摸牌)/断肠(移除凶手技能)/界节命(临终摸弃)——系统处理牌之前
 *  时机4 系统处理牌:弃手牌+装备入弃牌堆 + alive=false(原 击杀.apply 逻辑)
 *  奖惩:反贼死→凶手摸3;忠臣被主公杀→主公弃所有牌
 *  时机5 死亡后:功獒(摸牌)/界完杀 cleanup
 *
 *  killer 为致死来源(伤害路径透传;体力致死/自杀为 undefined)。 */
export async function runDeathFlow(
  state: GameState,
  player: number,
  killer?: number,
): Promise<void> {
  // 时机1:亮身份牌前(焚心)
  await applyAtom(state, { type: '亮身份牌前', player });

  // 时机2:亮身份牌(揭示身份)
  await applyAtom(state, { type: '亮身份牌', player });

  // 时机3:死亡时(行殇/断肠/界节命——在系统处理牌之前)
  await applyAtom(state, { type: '死亡时', player, killer });

  // 时机4:系统处理牌(弃手牌+装备、alive=false)
  await applyAtom(state, { type: '系统处理牌', player });

  // 奖惩(系统规则内联)
  await applyDeathPenalty(state, player, killer);

  // 时机5:死亡后(功獒/界完杀 cleanup)
  await applyAtom(state, { type: '死亡后', player, killer });
}

/** 死亡奖惩——搬自系统规则的击杀 after-hook。
 *  反贼被杀:凶手摸3张;忠臣被主公杀:主公弃所有牌。无来源/自杀/凶手已亡→无奖惩。 */
async function applyDeathPenalty(
  state: GameState,
  deadIdx: number,
  killer?: number,
): Promise<void> {
  if (killer === undefined) return; // 体力致死等无来源——无奖惩
  if (killer === deadIdx) return; // 自杀——无奖惩
  const killerPlayer = state.players[killer];
  if (!killerPlayer?.alive) return; // 凶手已亡——无奖惩
  const dead = state.players[deadIdx];

  if (dead.identity === '反贼') {
    await applyAtom(state, { type: '摸牌', player: killer, count: 3 });
  } else if (dead.identity === '忠臣' && killerPlayer.identity === '主公') {
    const allCards = [
      ...killerPlayer.hand,
      ...(Object.values(killerPlayer.equipment).filter(Boolean) as string[]),
    ];
    if (allCards.length > 0) {
      await applyAtom(state, { type: '弃置', player: killer, cardIds: allCards });
    }
  }
}
