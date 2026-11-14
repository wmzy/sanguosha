// src/engine/view/projectPlayer.ts
// GameState.players[i] → GameView.players[i] 的权威投影(单一实现,两处共用)。
//
// 使用方:
//   - buildView(全量快照/重连视图:按 viewer/debug 红化选将保密字段、手牌与身份)
//   - choosePlayerCandidates(choosePlayer prompt 的 candidates 计算:引擎进程内
//     跑 ChoosePlayerPrompt.filter 的轻量 view,viewer=-1 —— candidates 随 pending
//     广播给所有 viewer,不能按单一视角红化)
//
// 收敛动机:此前两处各写一份字段集(轻量版 11 字段 vs 权威版 18 字段),
// GameView.players 新增字段时轻量版不跟 → 技能 filter 访问缺失字段抛错 →
// 保守全纳入(后端 validate 兜底),candidates 退化为「所有存活」。共用本投影后
// filter 与前端 UI 看到同一字段集;新增字段只改这一处。
import type { GameState, GameView, Json } from '../types';
import { getDistanceAttackMod, getDistanceDefenseMod, getDistanceAttackRange } from '../rules/vars-keys';

export interface ProjectPlayerOpts {
  /** 观看者座次;-1 = 无特定期望视角(不投影任何人的手牌,身份仅公开信息可见) */
  viewer: number;
  /** debug 视角:跳过选将保密与手牌红化(测试/调试专用) */
  debug?: boolean;
}

/** 投影单个玩家为 GameView.players[i]。行为契约见各字段行内注释。 */
export function projectPlayer(
  state: GameState,
  i: number,
  opts: ProjectPlayerOpts,
): GameView['players'][number] {
  const { viewer, debug = false } = opts;
  const p = state.players[i];
  // 选将保密:选将进行中,非本人视角不投影角色/势力/技能(名字投影昵称);
  // 选将结束由 亮将 原子统一公开。debug 视角不受限。
  const hideChar = state.charSelecting === true && !debug && i !== viewer;
  return {
    // 名牌回退链 nickname→name:nickname 只在 分配武将.apply 时写入,分配前的
    // 窗口内 undefined——直接投影空串会让他人/旁观视角名牌全空(CharSelectWaitingOverlay
    // 拼出「、、、、正在选将」)。回退 p.name 无泄漏:分配前 name 仍是原昵称
    // (分配武将 apply 才覆写为武将名并留存 nickname);分配后 nickname 已留存,
    // 优先取昵称,武将名不会经 name 通道泄漏(角色保密由 character/skills 红化控制)。
    index: i,
    name: hideChar ? (p.nickname ?? p.name) : p.name,
    character: hideChar ? '' : p.character,
    faction: hideChar ? undefined : p.faction,
    health: p.health,
    maxHealth: p.maxHealth,
    alive: p.alive,
    equipment: { ...p.equipment },
    skills: hideChar ? [] : [...p.skills],
    handCount: p.hand.length,
    hand: (i === viewer || debug) ? p.hand.map((id) => state.cardMap[id]).filter(Boolean) : undefined,
    marks: [...p.marks],
    tags: [...p.tags],
    // 距离修正 vars(只投影距离相关三个 key,不暴露身份等敏感 vars)
    distanceVars: {
      attackMod: getDistanceAttackMod(p.vars),
      defenseMod: getDistanceDefenseMod(p.vars),
      attackRange: getDistanceAttackRange(p.vars),
    },
    // 回合用量仅来自显式「回合用量」atom 的 state 镜像。
    // 镜像按玩家归属存储，支持他人回合中的强制用牌；不再从 player.vars
    // 自动投影 /usedThisTurn 等内部门控标记。
    turnUsage: Object.fromEntries(
      Object.entries(state.turn.vars)
        .map(([k, v]) => {
          const prefix = `__view/${i}/`;
          return k.startsWith(prefix) ? [k.slice(prefix.length), v] : null;
        })
        .filter((entry): entry is [string, Json] => entry !== null),
    ),
    // 判定区:延时锦囊的 cardId 列表(乐不思蜀/闪电/兵粮寸断)
    pendingTricks: p.pendingTricks.map((t) => t.card.id),
    ...(() => {
      const rawIdentity = p.identity;
      if (!rawIdentity) return { identity: undefined, identityHidden: false };
      // 自己:可见
      if (i === viewer) return { identity: rawIdentity, identityHidden: false };
      // 主公:公开
      if (rawIdentity === '主公') return { identity: rawIdentity, identityHidden: false };
      // 死亡:揭示
      if (!p.alive) return { identity: rawIdentity, identityHidden: false };
      // 其他玩家:隐藏
      return { identity: undefined, identityHidden: true };
    })(),
  };
}
