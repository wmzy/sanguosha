// core/create.ts — 对局构造与开局:create/bootstrap/registerSkillsFromState + 规则包装载。
// 自 core/index.ts 拆出(逐字搬移,逻辑零改动):导出经 index re-export,import 方零改动。
// bootstrap 在函数体内调用 ./dispatch;dispatch 不反向依赖本模块,无循环依赖。
import type { Card, GameState } from '../types';
import { createGameState } from '../types';
import { setSkillInstanceUnload } from './skill';
// unloadSkillInstance 已迁至 skills/lifecycle.ts（可直接访问 skillLoaders/cardEffectMap）
import { unloadSkillInstance } from '../skills/lifecycle';
import { createStandardDeck } from './deck';
import { SYSTEM_OWNER } from './notify';
import { dispatch } from './dispatch';

// 规则包(游戏模式)动态加载:core 不静态依赖任何具体模式规则(ADR 0029)。
import { loadRuleset } from '../rules/registry';
import type { GameMode, RulesetModule } from '../rules/types';

export interface GameConfig {
  characters: Array<{ name: string; skills: string[] }>;
  playerCount: number;
  seed: number;
  gameId: string;
  handSize?: number;
  /** 操作倒计时秒数(房间配置,绝对值)。正值=秒数; 0=无限。未设置时各 atom 用自身默认秒数。 */
  timeoutSec?: number;
  /** 游戏模式(规则包)。默认 身份局。restore 时用于从快照恢复模式。 */
  mode?: GameMode;
  /** 玩家显示名(座次 i → 昵称)。缺省回退 player-{i}。 */
  playerNames?: string[];
}

/** 解析 state.config 中持久化的模式,缺省回退 身份局(兼容旧快照)。 */
export function resolveGameMode(state: GameState): GameMode {
  return state.config?.mode ?? '身份局';
}

/** 装载 state 当前模式规则包并(默认)跑 onInit:resolveGameMode + loadRuleset +
 *  onInit 三连原在 checkGameOver/bootstrap/registerSkillsFromState 重复 → 收敛单点。
 *  - onInit 注册系统规则全局 hooks(添加/移除技能/弃置/濒死检查)+ 每座次 选将/弃牌
 *    respond action;checkGameOver 只做只读判定,传 { onInit: false } 跳过。
 *  - bootstrap 的模式取 gameConfig 优先:调用方先把 gameConfig.mode 持久化进
 *    state.config 再调本函数(注入 使用牌/打出牌 的差异保留在各调用点)。 */
async function loadCurrentRuleset(
  state: GameState,
  opts: { onInit?: boolean } = {},
): Promise<RulesetModule> {
  const ruleset = await loadRuleset(resolveGameMode(state));
  if (opts.onInit !== false) ruleset.onInit(state);
  return ruleset;
}

/** 检查游戏是否结束。基于 state.config.mode 加载对应规则包判定(默认身份局)。
 *  异步(动态 import):session 在 onStateChange 中 await。具体判定逻辑见
 *  rules/身份局.ts(身份局与 1v1 共用)——core 层不再内嵌模式规则(ADR 0029)。 */
export async function checkGameOver(
  state: GameState,
): Promise<{ gameOver: boolean; winner?: number }> {
  const ruleset = await loadCurrentRuleset(state, { onInit: false });
  return ruleset.checkGameOver(state);
}
export function create(gameConfig: GameConfig): GameState {
  const playerCount = Math.max(2, Math.min(8, gameConfig.playerCount));
  const stubPlayers = Array.from({ length: playerCount }, (_, i) => ({
    index: i,
    name: gameConfig.playerNames?.[i]?.trim() ?? `player-${i}`,
    character: '',
    health: 4,
    maxHealth: 4,
    alive: true,
    hand: [] as string[],
    equipment: {},
    skills: [] as string[],
    vars: {},
    marks: [],
    pendingTricks: [],
    tags: [],
  }));

  // 预填充 cardMap(所有标准牌),确保 initialView 在 bootstrap execute 之前发出时
  // cardMap 不为空。applyView 的 移动牌 通用 fallback 依赖 cardMap 查卡牌对象,
  // 若 cardMap 为空且后续被 state.cardMap = {} 替换引用,视图的 cardMap 引用就永远空了。
  const allCards = createStandardDeck();
  const cardMap: Record<string, Card> = {};
  for (const c of allCards) cardMap[c.id] = c;

  const state = createGameState({ players: stubPlayers, cardMap });
  state.startedAt = state.clock.now();
  // config 持久化到 state(随快照序列化):mode 供 checkGameOver/开局 ruleset 解析,
  // timeoutSec 供各 atom 读取。timeoutSec 未设置时仍写入 config(仅含 mode)。
  state.config = {
    ...(gameConfig.timeoutSec !== undefined ? { timeoutSec: gameConfig.timeoutSec } : {}),
    ...(gameConfig.mode !== undefined ? { mode: gameConfig.mode } : {}),
  };
  return state;
}

/**
 * 异步 bootstrap:在 state 上跑完开局流程。**不可重入**——开局一旦执行,
 * 抽身份/选将/洗牌/发牌的状态变更就开始了,无法回滚。对已开局的 state 再调
 * bootstrap 是调用方 bug,直接抛错暴露,而非"幂等"重跑。
 *
 *   1. 动态 import 开局 skill 模块
 *   2. 调 开局.onInit(skill, state) 注册 start action
 *   3. dispatch 开局 start → 跑完抽身份/选将/洗牌/发牌/启动第一回合
 *   4. registerSkillsFromState(state) 给每个 player 的 skills 注册实例
 *
 * restore 路径同样调 bootstrap —— JSON 快照无法恢复运行时内存状态(skill 实例/hooks/
 * respond actions/pending slot 函数),必须靠 bootstrap 重建,再由 restore 重放 actionLog
 * 推进到正确状态。见 ADR 0027 决策 7 修订。
 */
export async function bootstrap(state: GameState, gameConfig: GameConfig): Promise<void> {
  // 防重入:开局已执行过(玩家已发牌)→ 抛错。不是"幂等"——状态变更不可回滚。
  if (state.players.some((p) => p.hand.length > 0)) {
    throw new Error('bootstrap: state 已开局(玩家已有手牌),不可重复 bootstrap');
  }
  const 开局mod = await import('../skills/开局');
  const syntheticSkill = 开局mod.createSkill('开局', SYSTEM_OWNER);
  // state-bound 注册表幂等:先卸载旧实例(await import 之后、onInit 之前),避免
  // 重入时因微任务交织导致重复注册。
  unloadSkillInstance(state, '开局', SYSTEM_OWNER);
  const off开局 = 开局mod.onInit(syntheticSkill, state);
  // 登记实例 unload,使 unloadSkillInstance 能正确清理 开局:系统
  setSkillInstanceUnload(
    state,
    '开局',
    SYSTEM_OWNER,
    typeof off开局 === 'function' ? off开局 : () => {},
  );

  // 3. dispatch 开局 start(dispatch 返回 boolean:validate 拒绝返回 false,开局失败通过后续 state 检查暴露)
  // 规则包(按 gameConfig.mode 动态加载,默认身份局):注册系统规则全局 hooks
  // (添加技能/移除技能/弃置/濒死检查)+ 每座次 选将/弃牌 respond action。
  // core 不静态依赖具体规则实现(ADR 0029);开局 skill 同样经 registry 读
  // ruleset.opening 驱动选将流程。mode 同时持久化到 state.config——
  // 开局 execute/checkGameOver 均从 state.config.mode 解析(快照恢复同样依赖)。
  const mode = gameConfig.mode ?? resolveGameMode(state);
  state.config = { ...state.config, mode };
  await loadCurrentRuleset(state);
  // 酒增伤/延时锦囊判定/连环传导 全局 hooks 由 使用牌 skill 的 onInit 注册
  // (首次实例化时注册,后续座次跳过)
  // dispatch 后 await settle:等开局 execute 挂起(选将 slot 创建)再返回。
  // 正常对局保证 broadcastNewState 时选将 pending 已就绪;restore 保证重放前 slot 已建。
  const { settle } = await dispatch(state, {
    skillId: '开局',
    actionType: 'start',
    ownerId: SYSTEM_OWNER,
    params: { ...gameConfig },
    baseSeq: 0,
  });
  const settleError = await settle;
  if (settleError) throw settleError;
}

/** 测试/工具用:给预构造 state(未走 bootstrap)注册所有 player.skills 实例 + 选将/弃牌 respond action */
export async function registerSkillsFromState(state: GameState): Promise<void> {
  // 注入统一卡牌入口技能（使用牌/打出牌）到每个玩家的 skills 数组开头（若缺失）。
  // 放开头保证先于角色技能实例化，让 界乱击/界火计 等覆盖能生效（后注册覆盖先注册）。
  // unloadSkillInstance 已通过 cardNameChecker 跳过卡名同名技能的前缀清理，
  // 不会误删使用牌按卡名注册的 use action。
  for (const p of state.players) {
    p.skills = [
      ...(p.skills.includes('使用牌') ? [] : ['使用牌']),
      ...(p.skills.includes('打出牌') ? [] : ['打出牌']),
      ...p.skills,
    ];
  }
  const { registerSkillsFromState: registerSkills } = await import('../skills/lifecycle');
  await registerSkills(state);
  // 注册规则包全局 hooks + 为每个玩家注册选将/弃牌 respond action(与 bootstrap 一致)。
  // 模式取 state.config(测试构造的 state 未走 create 时缺省身份局)。
  await loadCurrentRuleset(state);
  // 酒增伤/延时锦囊判定/连环传导 全局 hooks 由 使用牌 skill 的 onInit 注册
  // (registerSkills 内部按座次逐个实例化,首次实例化的座次负责注册)
}
