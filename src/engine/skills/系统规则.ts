// 系统规则(系统级):注册引擎级 after hooks——判定清理、技能生命周期、濒死流程。
// 这些是三国杀全局规则,不是单个技能职责,通过 after hooks 统一处理。
// applyAtom 只管通用管线(before → validate → apply → emit → after hooks → pending)。
import type { Card, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, instantiateSkill, unloadSkillInstance } from '../skill';
import { DEFAULT_SKILLS } from '../atoms/选将';
import { skillLoaders } from './index';
import { runDeathFlow } from '../death-flow';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '系统规则', description: '引擎级规则(判定清理/技能生命周期/濒死)' };
}

// ── 选将/弃牌 respond action:注册到具体玩家座次 ──
// 选将和弃牌 respond 是每个玩家的操作入口,注册到 (系统规则, 座次, actionType),
// dispatch 用精确座次查找即可命中,无需 -1 回退。
// action 体从 slot.atom.target 读取目标玩家,不依赖注册的 ownerId,因此各座次的 entry 逻辑一致。
export function registerSystemRespondActions(state: GameState, ownerId: number): () => void {
  const unloads: Array<() => void> = [];

  // ── 选将 action:玩家选择武将 ──
  // 客户端发 {skillId:'系统规则', actionType:'选将', ownerId: target, params:{character:'刘备'}}
  unloads.push(
    registerAction(
      state,
      '系统规则',
      ownerId,
      '选将',
      (state, params) => {
        const slot = state.pendingSlots.get(ownerId);
        if (!slot) return '当前不需要回应';
        if (slot.atom.type !== '选将询问') return '当前不是选将窗口';
        // 只有被问询的玩家能回应
        if ((slot.atom as { target: number }).target !== ownerId) return '不是你的选将回合';
        // 纵深防御:已选将的玩家禁止重新选将(选将完成后 slot 理论上已 resolve 删除,
        // 但客户端在网络抖动/重复点击下可能重发 action,引擎层必须拒绝二次写入)。
        const selfPlayer = state.players[ownerId];
        if (!selfPlayer) return `player ${ownerId} not found`;
        if (selfPlayer.character) return '已选择武将,不能重新选将';
        const character = params.character as string;
        if (typeof character !== 'string') return 'character required';
        const candidates = (slot.atom as { candidates: Array<{ name: string }> }).candidates;
        if (!candidates.some((c) => c.name === character)) return '选择的武将不在候选人中';
        // 并行选将场景:同一武将不能被两人选(先选先得)。
        // 串行场景下每人候选人本就不重叠,此检查也不会误拒。
        const takenByOther = state.players.some(
          (p) => p.index !== ownerId && p.character === character,
        );
        if (takenByOther) return '该武将已被其他玩家选择';
        return null;
      },
      async (state, params) => {
        const slot = state.pendingSlots.get(ownerId)!;
        const target = (slot.atom as { target: number }).target;
        const character = params.character as string;
        const candidates = (slot.atom as { candidates: Array<{ name: string; skills: string[] }> })
          .candidates;
        const selected = candidates.find((c) => c.name === character)!;
        // 走 atom 管线:applyAtom(分配武将) → toViewEvents → applyView → 事件广播
        await applyAtom(state, {
          type: '分配武将',
          target,
          character: selected.name,
          skills: [...DEFAULT_SKILLS, ...selected.skills],
        });
      },
    ),
  );

  // ── 弃牌阶段 respond action:玩家选择弃哪些牌 ──
  unloads.push(
    registerAction(
      state,
      '系统规则',
      ownerId,
      'respond',
      (state: GameState, params: Record<string, Json>) => {
        const slot = state.pendingSlots.get(ownerId);
        if (!slot) return '当前不需要回应';
        if (slot.atom.type !== '请求回应') return '当前不是弃牌窗口';
        const atom = slot.atom as { requestType?: string; target: number };
        if (atom.requestType !== '__弃牌') return '当前不是弃牌窗口';
        if (atom.target !== ownerId) return '不是你的弃牌回合';
        const cardIds = params.cardIds;
        if (!Array.isArray(cardIds)) return 'cardIds required';
        if (cardIds.length === 0) return '不能弃 0 张牌';
        const player = state.players[atom.target];
        if (!player) return 'target not found';
        for (const id of cardIds) {
          if (typeof id !== 'string' || !player.hand.includes(id)) return `card ${id} not in hand`;
        }
        return null;
      },
      async (state: GameState, params: Record<string, Json>) => {
        const slot = state.pendingSlots.get(ownerId)!;
        const target = (slot.atom as { target: number }).target;
        const cardIds = params.cardIds as string[];
        await applyAtom(state, { type: '弃置', player: target, cardIds });
      },
    ),
  );

  // ── 设置手牌顺序 action(盲选重放辅助):重排目标 player.hand 顺序 ──
  // 该 action 不由客户端直接发起,而是由"过河拆桥/顺手牵羊"的 use execute 在盲选前
  // 以 ClientMessage 形式插入 actionLog,保证重放时目标手牌顺序先恢复、盲选后执行。
  // params: { target: 目标座次, order: 卡牌ID数组(须为当前 hand 的合法排列) }
  unloads.push(
    registerAction(
      state,
      '系统规则',
      ownerId,
      '设置手牌顺序',
      (state, params) => {
        const target = params.target as number | undefined;
        if (typeof target !== 'number') return 'target required';
        const player = state.players[target];
        if (!player) return 'target not found';
        const order = params.order;
        if (!Array.isArray(order)) return 'order required';
        if (order.length !== player.hand.length) return 'order length mismatch';
        const handSet = new Set(player.hand);
        for (const id of order) {
          if (typeof id !== 'string' || !handSet.has(id)) return `card ${id} not in hand`;
        }
        return null;
      },
      async (state, params) => {
        const target = params.target as number;
        const order = params.order as string[];
        const player = state.players[target];
        if (!player) return;
        player.hand = [...order];
      },
    ),
  );

  return () => unloads.forEach((fn) => fn());
}

export function onInit(_skill: Skill, state: GameState): () => void {
  // ── 添加技能 after hook:实例化技能(注册 action/hook) ──
  registerAfterHook(state, '系统规则', -1, '添加技能', async (ctx) => {
    const atom = ctx.atom;
    await instantiateSkill(ctx.state, atom.skillId, atom.player);
  });

  // ── 移除技能 after hook:卸载技能实例 ──
  registerAfterHook(state, '系统规则', -1, '移除技能', async (ctx) => {
    const atom = ctx.atom;
    unloadSkillInstance(ctx.state, atom.skillId, atom.player);
  });

  // ── 弃置 after hook:卸载被弃装备自带的技能实例 ──
  // 换装备(装备通用)走显式 移除技能 序列,技能正常卸载;
  // 但 制衡/寒冰剑/麒麟弓/过河拆桥/弃牌阶段 等用 弃置 atom 直接 equipment→弃牌堆,
  // 没走 装备通用 → 装备技能实例(hook/vars/action)残留。这里统一兜底:
  // 弃置 apply 后,被弃的牌若原属装备区且其 name 是已挂载的装备技能,触发 移除技能 卸载。
  // apply 后 equipment 已不含该牌,用 skillLoaders(name 判据)+ player.skills(是否挂载)双判。
  registerAfterHook(state, '系统规则', -1, '弃置', async (ctx) => {
    const atom = ctx.atom;
    const player = ctx.state.players[atom.player];
    if (!player) return;
    for (const cardId of atom.cardIds) {
      const card = ctx.state.cardMap[cardId];
      // 只处理装备牌且其 name 是已挂载的装备技能(双重过滤):
      //   card.type==='装备牌' 排除同名基本牌(如 弃一张 name='杀' 的牌不应卸载 杀 技能);
      //   skillLoaders[name] 判断该装备是否自带技能;
      //   player.skills.includes 确认确实挂载着(避免对未挂载的装备多发 移除技能)。
      if (
        card?.type === '装备牌' &&
        card?.name &&
        skillLoaders[card.name] &&
        player.skills.includes(card.name)
      ) {
        await applyAtom(ctx.state, { type: '移除技能', player: atom.player, skillId: card.name });
      }
    }
  });

  // ── 造成伤害 after hook 已删除:伤害走 runDamageFlow → 扣减体力,
  // 濒死检查由 扣减体力 after-hook 负责,killer 由 runDecreaseLifeFlow 写入。

  // ── 扣减体力 after hook:濒死检查 ──
  // 仅处理非伤害路径(失去体力 → runDecreaseLifeFlow → 扣减体力)。
  // 伤害路径(runDamageFlow)设置 __inDamageFlow 标志,濒死检查延迟到 伤害结算结束时
  // (确保 放逐/断肠 等受伤后技能先于濒死检查执行)。
  registerAfterHook(state, '系统规则', -1, '扣减体力', async (ctx) => {
    if (ctx.state.localVars['__inDamageFlow']) return; // 伤害路径:延迟到 伤害结算结束时
    const atom = ctx.atom;
    if (typeof atom.target !== 'number') return;
    const target = ctx.state.players[atom.target];
    if (target && target.alive && target.health <= 0) {
      await runDyingFlow(ctx.state, atom.target);
    }
  });

  // ── 伤害结算结束时:濒死检查(伤害路径专用)──
  // 扣减体力 在 造成伤害后/受到伤害后 之前执行,但濒死检查延迟到此时机
  // (在所有受伤后技能执行完毕后),与旧 造成伤害 after-hook 的系统规则最后执行语义一致。
  registerAfterHook(state, '系统规则', -1, '伤害结算结束时', async (ctx) => {
    const atom = ctx.atom;
    if (typeof atom.target !== 'number') return;
    const target = ctx.state.players[atom.target];
    if (target && target.alive && target.health <= 0) {
      await runDyingFlow(ctx.state, atom.target);
    }
  });

  // ── 失去体力 after hook:濒死检查(最后执行) ──
  registerAfterHook(state, '系统规则', -1, '失去体力', async (ctx) => {
    const atom = ctx.atom;
    if (typeof atom.target !== 'number') return;
    const target = ctx.state.players[atom.target];
    if (target && target.alive && target.health <= 0) {
      // 体力致死无来源——清除可能残留的来源记录
      delete ctx.state.localVars['死亡/killer'];
      await runDyingFlow(ctx.state, atom.target);
    }
  });

  // ── 击杀 after hook(死亡奖惩)已删除:奖惩搬入 runDeathFlow(death-flow.ts)。
  // runDyingFlow 末尾改调 runDeathFlow,由其内联 applyDeathPenalty 处理奖惩。

  // ── 选将/弃牌 respond 已移到 registerSystemRespondActions,注册到每个玩家座次 ──

  return () => {};
}

/** 求桃救援牌判定:桃/酒(默认技能),急救红牌(华佗)。基于被问玩家技能动态判断。
 *  engine 侧 cardFilter;前端通过 respondFor='桃/求桃' 的 respond action 重建同等语义。 */
function canRescueWith(state: GameState, playerIdx: number): (card: Card) => boolean {
  const skills = state.players[playerIdx]?.skills ?? [];
  return (card) => {
    if (card.name === '桃' && skills.includes('桃')) return true;
    if (card.name === '酒' && skills.includes('酒')) return true;
    if (card.color === '红' && skills.includes('急救')) return true;
    return false;
  };
}

/**
 * 濒死求桃流程(模块 C 修正,对齐 neardeath.md):
 *   1. applyAtom(陷入濒死)——系统通知,触发不屈/涅槃/伏枥/仁心等救援技 after-hook。
 *   2. 不屈存活检查——命中则濒死已化解,跳过求桃与死亡。
 *   3. applyAtom(进入濒死状态时)——补益/随势① 独立时机(先于求桃,可能直接回血化解)。
 *   4. 求桃循环:从当前回合角色起,逆时针询问每个存活玩家;被救仍濒死则发
 *      新的濒死状态时 并从当前响应者重新逆时针。
 *   5. 仍濒死 → runDeathFlow(target, killer)。
 *
 * 关键修正(对比旧实现):
 *   - 起点:从濒死玩家 → 当前回合角色(state.currentPlayerIndex)。
 *   - 方向:顺时针(targetIdx+i) → 逆时针(startIdx-i+n)。
 *   - 新增时机:进入濒死状态时(补益/随势①)、新的濒死状态时(被救仍濒死重置)。
 */
async function runDyingFlow(state: GameState, targetIdx: number): Promise<void> {
  await applyAtom(state, { type: '陷入濒死', target: targetIdx });

  // 不屈(周泰·锁定技):陷入濒死 after-hook 翻创牌判定,点数不重复时回复至1体力并设存活标记。
  // 命中则濒死已化解——跳过求桃循环与击杀。
  if (state.localVars['不屈/存活'] === targetIdx) {
    delete state.localVars['不屈/存活'];
    return;
  }

  // 新增时机:进入濒死状态时(补益/随势①)。先于求桃,补益等技能可能直接回血化解。
  await applyAtom(state, { type: '进入濒死状态时', target: targetIdx });
  // 进入濒死状态时 的 after-hook(如补益)可能已把 target 救活——检查后提前退出。
  if (state.players[targetIdx].health > 0) return;

  const n = state.players.length;
  // 起点:当前回合角色(规则要求)。逆时针方向:(startIdx - i + n) % n。
  let startIdx = state.currentPlayerIndex;
  // 已问过的玩家集合(防止无限循环:一轮内每个存活玩家最多问一次)。
  let asked = new Set<number>();

  while (state.players[targetIdx].health <= 0) {
    let found = false; // 本轮是否询问了任意玩家(无 → 全员问过,退出)
    for (let i = 0; i < n; i++) {
      const playerIdx = (startIdx - i + n) % n; // 逆时针
      if (asked.has(playerIdx)) continue;
      if (!state.players[playerIdx].alive) continue;

      asked.add(playerIdx);
      found = true;

      await applyAtom(state, {
        type: '请求回应',
        requestType: '桃/求桃',
        target: playerIdx,
        prompt: {
          type: 'useCard',
          title: `${state.players[targetIdx].name} 濒死,使用桃/酒救援`,
          cardFilter: { filter: canRescueWith(state, playerIdx), min: 1, max: 1 },
        },
        timeout: 15,
      });

      const rescuedByPeach = state.localVars['求桃/已救'] as boolean | undefined;
      if (rescuedByPeach) {
        await applyAtom(state, { type: '回复体力', target: targetIdx, amount: 1, source: playerIdx });
        delete state.localVars['求桃/已救'];

        if (state.players[targetIdx].health > 0) return; // 救活了

        // 仍濒死 → 新的濒死状态时 → 重置起点为当前响应者,重新逆时针。
        // 当前响应者本轮已问过(加入 asked),下一轮从其逆时针下一位开始。
        await applyAtom(state, { type: '新的濒死状态时', target: targetIdx });
        startIdx = playerIdx;
        asked = new Set<number>();
        asked.add(playerIdx);
        break; // 重新进入 while 循环
      }
      break; // 未救:退出 for,while 重新扫描(跳过已问玩家)找下一位
    }
    if (!found) break; // 所有存活玩家都问过了
  }

  if (state.players[targetIdx].health <= 0) {
    // 死亡流程拆分(模块 B):runDeathFlow 编排 5 时机(亮身份牌前/亮身份牌/死亡时/
    // 系统处理牌/死亡后),奖惩内联其中。killer 来自 runDecreaseLifeFlow 写入的
    // localVars(伤害有来源;体力致死无来源→undefined),消费后清除避免残留。
    const killer = state.localVars['死亡/killer'] as number | undefined;
    delete state.localVars['死亡/killer'];
    await runDeathFlow(state, targetIdx, killer);
  }
}
