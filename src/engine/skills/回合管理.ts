// src/engine/skills/回合管理.ts
// ============================================================
// 技能描述(系统级):
//   每玩家一个实例,负责回合/阶段的自动推进:
//   1) 监听上家 回合结束 → 若我是下家则启动我的回合(回合开始+阶段开始 准备)
//   2) 监听 阶段结束 → 推进到下一阶段;自动阶段(准备/判定/摸牌)直接结束
//   3) 主动 end action:玩家在出牌阶段点"结束回合"
//   4) 主动 start action:仅主公位首次开局触发(currentPlayerIndex===0)
//
// 关键原子操作:
//   end 路径:阶段结束(出牌) → 阶段结束(弃牌) → 清过期标记 → 回合结束 → 下一玩家
//   start 路径:回合开始 → 阶段开始(准备) → 阶段结束(准备)
//   阶段结束 hook:阶段开始(next) → 若 next==='摸牌' 则摸牌(2) → 若自动阶段则阶段结束
//   回合结束 hook:若 next alive 是我 → 回合开始 + 阶段开始(准备) + 阶段结束(准备)
//
// 关键时机:
//   - 阶段推进:阶段结束 after hook(同玩家实例处理)
//   - 回合移交:回合结束 after hook,所有玩家实例同时收到,只有"是下家"的实例响应
//
// 已知问题/不完整实现:
//   1. **PHASE_ORDER 写死**:扩展包/特殊技能(如某些武将的"额外阶段")无法插入。
//      应通过 atom/hook 让技能可动态修改阶段链。
//   2. **判定阶段自动 skip**:第 51 行 `next==='判定'` 直接结束 →
//      跳过判定区延时锦囊(乐不思蜀/兵粮寸断/闪电)的判定处理!
//      回合管理直接跳过判定阶段是严重 bug。
//   3. **摸牌阶段固定 2 张**:第 47 行硬编码 count=2,
//      "屯田"/"再起"等修改摸牌数的技能无法 hook 介入。
//      应改为发"摸牌阶段开始"事件让技能修改,或开放 before hook。
//   4. **弃牌阶段无交互**:end action 直接 阶段结束(弃牌),
//      未让玩家选弃哪些牌(超过手牌上限时违反规则)。
//      正确应该是询问 prompt(useCard, min=超出张数)。
//   5. **清过期标记 ordering 问题**:end 路径中清过期标记在 回合结束 之前调用,
//      但很多 mark 的 duration='turn' 语义是"本回合结束时清理"——
//      技能 hook 监听 回合结束 时可能预期 mark 仍在,顺序应该是 回合结束 → 清过期标记。
//   6. **start action 主公判断脆弱**:`currentPlayerIndex === 0` 假设主公在 0 位,
//      与 开局.ts 一样,若初始 currentPlayerIndex 设到非 0(如选将时主公位变化),会 fail。
//      应通过 player.vars.身份==='主公' 判断。
//   7. **回合开始/下一玩家 顺序混乱**:end 中先 回合结束(触发下家 hook 开启回合),
//      然后再 下一玩家(推进 currentPlayerIndex)——这意味着下家"回合开始"时
//      currentPlayerIndex 还是上家,各种依赖 currentPlayerIndex 的技能会读到错误值。
//   8. **死亡玩家未跳过自动 trigger**:hook 回合结束 检查 me 是否是 nextAlive,
//      但若 me 已死亡,findNextAlive 不会返回 me,所以理论上不触发——
//      不过 unloadSkillInstance 时会清 hook,死亡玩家若没及时清,可能短暂触发。
// ============================================================
import type { GameState, GameView, Json, Skill  } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const PHASE_ORDER = ['准备', '判定', '摸牌', '出牌', '弃牌', '回合结束'] as const;

function nextPhase(current: string): string | null {
  const idx = PHASE_ORDER.indexOf(current as typeof PHASE_ORDER[number]);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1];
}

/** 从 fromIndex 之后找第一个存活玩家的索引;全死亡时返回 fromIndex */
function findNextAlive(state: { players: { alive: boolean }[] }, fromIndex: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    if (state.players[idx].alive) return idx;
  }
  return fromIndex;
}

export function createSkill(id: string, ownerId: string): Skill {
  return { id, ownerId, name: '回合管理', description: '监听上家回合结束,自动开始自己的回合' };
}

export function onInit(skill: Skill, ownerId: string): () => void {
  const me = skill.ownerId;

  // ─── 阶段结束 → 自动推进到下一阶段(自己回合内) ───
  registerAfterHook(skill.id, ownerId, '阶段结束', async (ctx) => {
    if (ctx.atom.type !== '阶段结束') return;
    const { player, phase } = ctx.atom;
    // 只让本回合所属玩家实例处理,避免和其他玩家的实例重复
    if (player !== me) return;

    const next = nextPhase(phase);
    if (!next) return;

    await applyAtom(ctx.state, { type: '阶段开始', player, phase: next });

    // 摸牌阶段自动摸 2 张
    if (next === '摸牌') {
      await applyAtom(ctx.state, { type: '摸牌', player, count: 2 });
    }

    // 自动阶段(准备/判定/摸牌)立即结束,推进到下一阶段
    if (next === '准备' || next === '判定' || next === '摸牌') {
      await applyAtom(ctx.state, { type: '阶段结束', player, phase: next });
    }
  });

  // ─── 上家回合结束 → 如果我是下一家,启动自己的回合 ───
  registerAfterHook(skill.id, ownerId, '回合结束', async (ctx) => {
    if (ctx.atom.type !== '回合结束') return;
    const finishedName = ctx.atom.player;
    const state = ctx.state;
    const finishedIndex = state.players.findIndex(p => p.name === finishedName);
    if (finishedIndex < 0) return;

    const nextIndex = findNextAlive(state, finishedIndex);
    const nextName = state.players[nextIndex].name;
    // 不是我就跳过——只有轮到的玩家启动自己的回合
    if (nextName !== me) return;

    await applyAtom(ctx.state, { type: '回合开始', player: me });
    await applyAtom(ctx.state, { type: '阶段开始', player: me, phase: '准备' });
    // 触发阶段结束,让本实例的阶段推进钩子接着跑(准备→判定→摸牌→出牌)
    await applyAtom(ctx.state, { type: '阶段结束', player: me, phase: '准备' });
  });

  // ─── 主动结束回合 ───
  registerAction(skill.id, ownerId, 'end', (state: GameState, params: Record<string, Json>) => null, async (state: GameState, params: Record<string, Json>) => {
      
      const player = ownerId;

      await applyAtom(state, { type: '阶段结束', player, phase: '出牌' });
      await applyAtom(state, { type: '阶段结束', player, phase: '弃牌' });
      // 清理回合级标记(如 杀/killsPlayed)
      await applyAtom(state, { type: '清过期标记', player });
      // 触发所有 onAtomAfter('回合结束') 钩子——下家实例发现自己接手,启动回合
      await applyAtom(state, { type: '回合结束', player });
      // 推进 currentPlayerIndex 到下一家
      await applyAtom(state, { type: '下一玩家' });
    }, );

  // ─── 首次开局(由主公位玩家触发)───
  registerAction(skill.id, ownerId, 'start', (state: GameState, params: Record<string, Json>) => {
      if (state.currentPlayerIndex !== 0) return '只有主公位可以开局';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      
      const player = ownerId;
      await applyAtom(state, { type: '回合开始', player });
      await applyAtom(state, { type: '阶段开始', player, phase: '准备' });
      // 触发阶段结束,让阶段推进钩子跑(准备→判定→摸牌→出牌)
      await applyAtom(state, { type: '阶段结束', player, phase: '准备' });
    }, );

  return () => {};
}

export default { createSkill, onInit };
