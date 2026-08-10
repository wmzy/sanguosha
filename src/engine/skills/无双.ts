// 无双(吕布·锁定技):
//   1. 你使用【杀】指定一名角色为目标时,该角色需连续使用两张【闪】才能抵消
//   2. 与你进行【决斗】的角色每次需连续打出两张【杀】
//
// 实现方式(杀部分):在「询问闪」after-hook 中处理。
//   闪 skill 的 生效前 after-hook 发出 询问闪 → 目标 respond(出闪,设置标记+移牌) →
//   询问闪 resolve → 无双的 询问闪 after-hook 检测到标记被设置 →
//   第一次: 清除标记 + drain闪 + 追加第二次询问闪。
//   第二次: 放行(标记保持设置)。
//
// 实现方式(决斗部分):在「询问杀」after-hook 中处理(决斗.ts 不感知无双)。
//   决斗循环每轮 applyAtom(询问杀) → 玩家 respond(出杀,杀进处理区) →
//   询问杀 resolve → 无双的 询问杀 after-hook:
//     第一次: 消费处理区第一张杀 + 追加第二次询问杀;
//     第二次: 放行(第二张杀留给决斗循环消费)。
//
// 选择 after-hook(而非 before-hook)的原因:
//   after-hook 在 atom resolve 后触发,此时玩家已回应(出杀/超时),处理区状态确定。
//   且等待型 atom 的 after-hook 在 skip/silent/超时 情况下均会触发(见 applyAtom 管线)。

import type { GameState, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { registerAfterHook } from '../core/skill';
import { isCancelled, clearCancelled } from '../core/frame';
import { consumePlayedSlashes } from './cards/play-card';
import type { SkillModule } from '../core/skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '无双',
    description: '锁定技:你使用【杀】的目标需连续出两张【闪】才能抵消;与你【决斗】的角色每次需连续打出两张【杀」',
    isLocked: true,
  };
}

function dodgeCountKey(killCardId: string, target: number): string {
  return `无双/dodgeCount/${killCardId}/${target}`;
}

/** 无双决斗:每轮决斗内、针对某个被询问出杀者的双杀计数键(防第二次询问杀的 after-hook 再追加) */
function duelKillCountKey(duelCardId: string, target: number): string {
  return `无双/duelCount/${duelCardId}/${target}`;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 询问闪 after-hook:无双杀的目标出闪后,拦截第一次 ──
  // 新模型:闪走 runUseFlow,闪牌自动移入弃牌堆;闪 resolve 设杀帧 cancelled=true。
  // 无双只需清除 cancelled + 追加第二次询问闪;第二次闪 resolve 自动重设 cancelled。
  registerAfterHook(state, skill.id, ownerId, '询问闪', async (ctx) => {
    const atom = ctx.atom as { target: number; source: number };
    // 检查杀的 source 是否拥有无双(ownerId)
    if (atom.source !== ownerId) return;
    if (!ctx.state.players[ownerId]?.skills.includes('无双')) return;

    const target = atom.target;
    // 无双仅对【杀】生效;万箭齐发等同样使用询问闪的牌不应触发双闪
    const killCardId = getKillCardId(ctx.state);
    if (ctx.state.cardMap[killCardId]?.name !== '杀') return;
    // 闪的 resolve 已设杀帧 cancelled=true;未出闪则不拦截
    if (!isCancelled(ctx.state, killCardId, target)) return;

    // 计数器
    const countKey = dodgeCountKey(killCardId, target);
    const count = (ctx.state.localVars[countKey] as number) ?? 0;
    if (count >= 1) {
      // 第二次闪:放行(cancelled 保持 true)
      delete ctx.state.localVars[countKey];
      return;
    }

    // 第一次闪:清除 cancelled + 追加第二次询问
    // 闪牌已由 runUseFlow 自动移入弃牌堆,无需手动 drain
    clearCancelled(ctx.state, killCardId, target);
    ctx.state.localVars[countKey] = count + 1;

    // 追加第二次询问闪:玩家出第二张闪 → resolve 自动设 cancelled;超时 → cancelled 保持 false
    await applyAtom(ctx.state, { type: '询问闪', target, source: ownerId });
    delete ctx.state.localVars[countKey];
  });

  // ── 询问杀 after-hook:无双决斗中,被要求出杀的一方需连续打出两张杀 ──
  // 决斗循环每轮 applyAtom(询问杀) resolve 后触发本 hook(与无双杀的 询问闪 hook 同构)。
  // 决斗.ts 不再感知无双:本 hook 内部完成「消费第一张杀 + 追加第二次询问杀」。
  //   第一次杀:消费处理区已打出的杀 → 追加第二次询问杀;
  //   第二次杀:放行(不再追加),第二张杀由决斗循环的 consumePlayedSlashes 消费。
  //   count 计数器(同无双杀)防止第二次询问杀的 after-hook 再次追加导致无限循环。
  registerAfterHook(state, skill.id, ownerId, '询问杀', async (ctx) => {
    const atom = ctx.atom as { target: number; source: number };
    // 仅当要求出杀的一方(source)拥有无双时生效(无双 owner 是决斗中"要求对方出杀"的一方)
    if (atom.source !== ownerId) return;
    if (!ctx.state.players[ownerId]?.skills.includes('无双')) return;

    // 仅在决斗上下文(结算帧顶的牌是决斗);南蛮入侵等同样用询问杀的牌不触发
    const frame = ctx.state.settlementStack[ctx.state.settlementStack.length - 1];
    const frameCardId = frame?.params?.cardId as string | undefined;
    if (!frameCardId || ctx.state.cardMap[frameCardId]?.name !== '决斗') return;

    const target = atom.target;
    const countKey = duelKillCountKey(frameCardId, target);
    const count = (ctx.state.localVars[countKey] as number) ?? 0;
    if (count >= 1) {
      // 第二次杀:放行(第二张杀留给决斗循环消费)
      delete ctx.state.localVars[countKey];
      return;
    }

    // 第一次杀:消费处理区已打出的杀;若未出杀则不追加(对方直接输)
    const firstKills = await consumePlayedSlashes(ctx.state);
    if (firstKills.length === 0) return;

    // 标记已询问第一次,追加第二次询问杀
    ctx.state.localVars[countKey] = count + 1;
    await applyAtom(ctx.state, { type: '询问杀', target, source: ownerId });
    delete ctx.state.localVars[countKey];
  });

  return () => {};
}

/** 从结算帧栈顶部找到杀的 cardId */
function getKillCardId(state: GameState): string {
  const frame = state.settlementStack[state.settlementStack.length - 1];
  return (frame?.params?.cardId as string) ?? '';
}

export default { createSkill, onInit } satisfies SkillModule;
