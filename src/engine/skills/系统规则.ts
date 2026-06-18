// 系统规则(系统级):注册引擎级 after hooks——判定清理、技能生命周期、濒死流程。
// 这些是三国杀全局规则,不是单个技能职责,通过 after hooks 统一处理。
// applyAtom 只管通用管线(before → validate → apply → emit → after hooks → pending)。
import type { GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, instantiateSkill, unloadSkillInstance, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '系统规则', description: '引擎级规则(判定清理/技能生命周期/濒死)' };
}

// ── 选将/弃牌 respond action:注册到具体玩家座次 ──
// 选将和弃牌 respond 是每个玩家的操作入口,注册到 (系统规则, 座次, actionType),
// dispatch 用精确座次查找即可命中,无需 -1 回退。
// action 体从 slot.atom.target 读取目标玩家,不依赖注册的 ownerId,因此各座次的 entry 逻辑一致。
export function registerSystemRespondActions(ownerId: number): () => void {
  const unloads: Array<() => void> = [];

  // ── 选将 action:玩家选择武将 ──
  // 客户端发 {skillId:'系统规则', actionType:'选将', ownerId: target, params:{character:'刘备'}}
  unloads.push(registerAction('系统规则', ownerId, '选将', (state, params) => {
    const slot = state.pendingSlots.get(ownerId);
    if (!slot) return '当前不需要回应';
    if (slot.atom.type !== '选将询问') return '当前不是选将窗口';
    // 只有被问询的玩家能回应
    if ((slot.atom as { target: number }).target !== ownerId) return '不是你的选将回合';
    const character = params.character as string;
    if (typeof character !== 'string') return 'character required';
    const candidates = (slot.atom as { candidates: Array<{ name: string }> }).candidates;
    if (!candidates.some(c => c.name === character)) return '选择的武将不在候选人中';
    return null;
  }, async (state, params) => {
    const slot = state.pendingSlots.get(ownerId)!;
    const target = (slot.atom as { target: number }).target;
    const character = params.character as string;
    const candidates = (slot.atom as { candidates: Array<{ name: string; skills: string[] }> }).candidates;
    const selected = candidates.find(c => c.name === character)!;
    const p = state.players[target];
    if (!p) return;
    p.character = selected.name;
    p.name = selected.name;
    // 保留 DEFAULT_SKILLS 引擎里已定义的默认技能列表
    const DEFAULT = ['回合管理', '装备通用', '杀', '闪', '桃', '酒', '过河拆桥', '顺手牵羊', '无中生有', '桃园结义', '借刀杀人', '决斗', '南蛮入侵', '万箭齐发', '乐不思蜀', '无懈可击'];
    p.skills = [...selected.skills, ...DEFAULT];
  }));

  // ── 弃牌阶段 respond action:玩家选择弃哪些牌 ──
  unloads.push(registerAction('系统规则', ownerId, 'respond', (state: GameState, params: Record<string, Json>) => {
    const slot = state.pendingSlots.get(ownerId);
    if (!slot) return '当前不需要回应';
    if (slot.atom.type !== '请求回应') return '当前不是弃牌窗口';
    const atom = slot.atom as { requestType?: string; target: number };
    if (atom.requestType !== '__弃牌') return '当前不是弃牌窗口';
    if (atom.target !== ownerId) return '不是你的弃牌回合';
    const cardIds = params.cardIds;
    if (!Array.isArray(cardIds)) return 'cardIds required';
    const player = state.players[atom.target];
    if (!player) return 'target not found';
    for (const id of cardIds) {
      if (typeof id !== 'string' || !player.hand.includes(id)) return `card ${id} not in hand`;
    }
    return null;
  }, async (state: GameState, params: Record<string, Json>) => {
    const slot = state.pendingSlots.get(ownerId)!;
    const target = (slot.atom as { target: number }).target;
    const cardIds = params.cardIds as string[];
    await applyAtom(state, { type: '弃置', player: target, cardIds });
  }));

  return () => unloads.forEach(fn => fn());
}

export function onInit(_skill: Skill, _ownerId: number): () => void {
  // ── 添加技能 after hook:实例化技能(注册 action/hook) ──
  registerAfterHook('系统规则', -1, '添加技能', async (ctx) => {
    const atom = ctx.atom as { skillId: string; player: number };
    await instantiateSkill(atom.skillId, atom.player);
  });

  // ── 移除技能 after hook:卸载技能实例 ──
  registerAfterHook('系统规则', -1, '移除技能', async (ctx) => {
    const atom = ctx.atom as { skillId: string; player: number };
    unloadSkillInstance(atom.skillId, atom.player);
  });

  // ── 造成伤害 after hook:濒死检查(最后执行,确保遗计等技能先触发) ──
  registerAfterHook('系统规则', -1, '造成伤害', async (ctx) => {
    const atom = ctx.atom as { target?: number };
    if (typeof atom.target !== 'number') return;
    const target = ctx.state.players[atom.target];
    if (target && target.alive && target.health <= 0) {
      await runDyingFlow(ctx.state, atom.target);
    }
  });

  // ── 失去体力 after hook:濒死检查(最后执行) ──
  registerAfterHook('系统规则', -1, '失去体力', async (ctx) => {
    const atom = ctx.atom as { target?: number };
    if (typeof atom.target !== 'number') return;
    const target = ctx.state.players[atom.target];
    if (target && target.alive && target.health <= 0) {
      await runDyingFlow(ctx.state, atom.target);
    }
  });

  // ── 选将/弃牌 respond 已移到 registerSystemRespondActions,注册到每个玩家座次 ──

  return () => {};
}

/**
 * 濒死求桃流程:从濒死玩家开始,按座次依次询问每个存活玩家是否使用桃救援。
 */
async function runDyingFlow(state: GameState, targetIdx: number): Promise<void> {
  await applyAtom(state, { type: '陷入濒死', target: targetIdx });

  const n = state.players.length;
  for (let i = 0; i < n; i++) {
    const playerIdx = (targetIdx + i) % n;
    const player = state.players[playerIdx];
    if (!player.alive) continue;
    if (state.players[targetIdx].health > 0) return;

    await applyAtom(state, {
      type: '请求回应',
      requestType: '求桃',
      target: playerIdx,
      prompt: { type: 'confirm', title: `${state.players[targetIdx].name} 濒死,是否使用桃救援?`, confirmLabel: '出桃', cancelLabel: '不救' },
      timeout: 15,
    });

    const rescuedByPeach = state.localVars['求桃/已救'] as boolean | undefined;
    if (rescuedByPeach) {
      await applyAtom(state, { type: '回复体力', target: targetIdx, amount: 1, source: playerIdx });
      delete state.localVars['求桃/已救'];
      if (state.players[targetIdx].health > 0) return;
    }
  }

  if (state.players[targetIdx].health <= 0) {
    await applyAtom(state, { type: '击杀', player: targetIdx });
  }
}
