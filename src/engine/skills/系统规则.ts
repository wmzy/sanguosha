// 系统规则(系统级):注册引擎级 after hooks——判定清理、技能生命周期、濒死流程。
// 这些是三国杀全局规则,不是单个技能职责,通过 after hooks 统一处理。
// applyAtom 只管通用管线(before → validate → apply → emit → after hooks → pending)。
import type { Card, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, instantiateSkill, unloadSkillInstance } from '../skill';
import { DEFAULT_SKILLS } from '../atoms/选将';
import { skillLoaders } from './index';

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
    const atom = ctx.atom as { skillId: string; player: number };
    await instantiateSkill(ctx.state, atom.skillId, atom.player);
  });

  // ── 移除技能 after hook:卸载技能实例 ──
  registerAfterHook(state, '系统规则', -1, '移除技能', async (ctx) => {
    const atom = ctx.atom as { skillId: string; player: number };
    unloadSkillInstance(ctx.state, atom.skillId, atom.player);
  });

  // ── 弃置 after hook:卸载被弃装备自带的技能实例 ──
  // 换装备(装备通用)走显式 移除技能 序列,技能正常卸载;
  // 但 制衡/寒冰剑/麒麟弓/过河拆桥/弃牌阶段 等用 弃置 atom 直接 equipment→弃牌堆,
  // 没走 装备通用 → 装备技能实例(hook/vars/action)残留。这里统一兜底:
  // 弃置 apply 后,被弃的牌若原属装备区且其 name 是已挂载的装备技能,触发 移除技能 卸载。
  // apply 后 equipment 已不含该牌,用 skillLoaders(name 判据)+ player.skills(是否挂载)双判。
  registerAfterHook(state, '系统规则', -1, '弃置', async (ctx) => {
    const atom = ctx.atom as { player: number; cardIds: string[] };
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

  // ── 造成伤害 after hook:濒死检查(最后执行,确保遗计等技能先触发) ──
  registerAfterHook(state, '系统规则', -1, '造成伤害', async (ctx) => {
    const atom = ctx.atom as { target?: number; source?: number };
    if (typeof atom.target !== 'number') return;
    const target = ctx.state.players[atom.target];
    if (target && target.alive && target.health <= 0) {
      // 记录致死来源供死亡奖惩使用(伤害致死才有来源)
      ctx.state.localVars['死亡/killer'] = atom.source;
      await runDyingFlow(ctx.state, atom.target);
    }
  });

  // ── 失去体力 after hook:濒死检查(最后执行) ──
  registerAfterHook(state, '系统规则', -1, '失去体力', async (ctx) => {
    const atom = ctx.atom as { target?: number };
    if (typeof atom.target !== 'number') return;
    const target = ctx.state.players[atom.target];
    if (target && target.alive && target.health <= 0) {
      // 体力致死无来源——清除可能残留的来源记录
      delete ctx.state.localVars['死亡/killer'];
      await runDyingFlow(ctx.state, atom.target);
    }
  });

  // ── 击杀 after hook:死亡奖惩(杀死反贼→摸3张,主公杀忠臣→弃所有牌) ──
  // 来源由 造成伤害 after hook 记入 localVars;体力致死无来源→无奖惩。
  registerAfterHook(state, '系统规则', -1, '击杀', async (ctx) => {
    const deadIdx = (ctx.atom as { player?: number }).player;
    if (typeof deadIdx !== 'number') return;
    const dead = ctx.state.players[deadIdx];
    const killer = ctx.state.localVars['死亡/killer'] as number | undefined;
    delete ctx.state.localVars['死亡/killer'];
    if (killer === undefined) return; // 体力致死等无来源——无奖惩
    if (killer === deadIdx) return; // 自杀——无奖惩
    const killerPlayer = ctx.state.players[killer];
    if (!killerPlayer?.alive) return; // 凶手已亡——无奖惩

    if (dead.identity === '反贼') {
      await applyAtom(ctx.state, { type: '摸牌', player: killer, count: 3 });
    } else if (dead.identity === '忠臣' && killerPlayer.identity === '主公') {
      const allCards = [
        ...killerPlayer.hand,
        ...(Object.values(killerPlayer.equipment).filter(Boolean) as string[]),
      ];
      if (allCards.length > 0) {
        await applyAtom(ctx.state, { type: '弃置', player: killer, cardIds: allCards });
      }
    }
  });

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
 * 濒死求桃流程:从濒死玩家开始,按座次依次询问每个存活玩家是否使用桃救援。
 */
async function runDyingFlow(state: GameState, targetIdx: number): Promise<void> {
  await applyAtom(state, { type: '陷入濒死', target: targetIdx });

  // 不屈(周泰·锁定技):陷入濒死 after-hook 翻创牌判定,点数不重复时回复至1体力并设存活标记。
  // 命中则濒死已化解——跳过求桃循环与击杀。
  if (state.localVars['不屈/存活'] === targetIdx) {
    delete state.localVars['不屈/存活'];
    return;
  }

  const n = state.players.length;
  for (let i = 0; i < n; i++) {
    const playerIdx = (targetIdx + i) % n;
    const player = state.players[playerIdx];
    if (!player.alive) continue;
    if (state.players[targetIdx].health > 0) return;

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
      if (state.players[targetIdx].health > 0) return;
    }
  }

  if (state.players[targetIdx].health <= 0) {
    await applyAtom(state, { type: '击杀', player: targetIdx });
  }
}
