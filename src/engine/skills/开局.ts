// 开局(系统级):开局流程。由 index.bootstrap() 在游戏开始时调用。
//   start action:抽身份 → 选将 → 初始化洗牌 → 发牌 → 回合开始(主公) → 阶段开始(主公,准备)
import type { ActionEntry, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply';
import { createRng } from '../util/rng';
import { registerActionEntry, unregisterActionEntry } from '../core/skill';
import { instantiateSkill } from './lifecycle';

import { getCharacterBaseId, isLord } from '../data/character-meta';
import { loadRuleset } from '../rules/registry';
import { resolveGameMode } from '../core';
import type { SkillModule } from '../types';

/**
 * system 命名空间占位 ownerId(座次下标 -1,不对应任何玩家槽位)。
 * 客户端永远不发这个值(WS handler 注入的 ownerId 是绑定玩家名),
 * engine 内部 dispatch 只在 bootstrap 路径用到它。
 */
const SYSTEM_OWNER = -1;

/** 按身份的候选数不再本地硬编码——由规则包 ruleset.opening.candidatesPerIdentity
 *  提供(身份局/1v1 各自不同),见 rules/ 目录(ADR 0029)。 */

/** 主公候选的拆分:从常备主公池随机取 5,从非常备池随机取 2,合并为 7 张候选人。
 *  当池不足时按"先常备后非常备、不重复"补到 7,仍不够则给全部。 */
const CANDIDATES_LORD = 5;
const CANDIDATES_NON_LORD = 2;

/** 武将组:同一武将(baseId)的多个版本(标/界/SP)归为一组。
 *  选将时作为一个候选位置展示,玩家 hover 展开后选择具体版本。 */
interface CharGroup {
  baseId: string;
  versions: Array<{ name: string; skills: string[] }>;
}

/** 把扁平武将列表按 baseId 分组。
 *  打乱后的顺序保留——组内版本按打乱顺序排列,组间顺序由首次出现决定。 */
function groupByBaseId(pool: Array<{ name: string; skills: string[] }>): CharGroup[] {
  const map = new Map<string, CharGroup>();
  for (const c of pool) {
    const baseId = getCharacterBaseId(c.name);
    let g = map.get(baseId);
    if (!g) {
      g = { baseId, versions: [] };
      map.set(baseId, g);
    }
    g.versions.push(c);
  }
  return [...map.values()];
}

/** 把武将组列表展开为扁平候选列表(带 baseId 字段供前端分组)。 */
function flattenGroups(
  groups: CharGroup[],
): Array<{ name: string; skills: string[]; baseId: string }> {
  return groups.flatMap((g) => g.versions.map((v) => ({ ...v, baseId: g.baseId })));
}

/** 从已分组的 charGroups 中拆分主公候选组:常备 5 + 非常备 2(总 7 组)。
 *  - charGroups 需为 seed 打乱后的顺序,取前 N 即随机抽取。
 *  - 常备判断基于 baseId(界版主公也正确识别)。
 *  - 兑底:常备 < 5 时,用非常备补足到 7;总数仍不足则给现有全部。 */
function pickLordCandidateGroups(groups: CharGroup[]): CharGroup[] {
  const target = CANDIDATES_LORD + CANDIDATES_NON_LORD; // 7
  const lordPicked: CharGroup[] = [];
  const nonLordPicked: CharGroup[] = [];
  for (const g of groups) {
    if (lordPicked.length >= CANDIDATES_LORD && nonLordPicked.length >= CANDIDATES_NON_LORD) break;
    // 组内任一版本是主公(isLord)即归入主公候选池;覆盖界版新增主公技武将
    // (如界袁绍:baseId='袁绍'不在 LORD_CANDIDATES,但 isLord('界袁绍')=true)
    const hasLordVersion = g.versions.some((v) => isLord(v.name));
    if (hasLordVersion) {
      if (lordPicked.length < CANDIDATES_LORD) lordPicked.push(g);
    } else {
      if (nonLordPicked.length < CANDIDATES_NON_LORD) nonLordPicked.push(g);
    }
  }
  const result = [...lordPicked, ...nonLordPicked];
  // 兑底:常备不足 5 时,用非常备补足
  if (result.length < target) {
    const used = new Set(result.map((g) => g.baseId));
    for (const g of groups) {
      if (result.length >= target) break;
      if (used.has(g.baseId)) continue;
      used.add(g.baseId);
      result.push(g);
    }
  }
  return result;
}

/** 开局配置 */
interface GameConfig {
  /** 可用武将列表 */
  characters: Array<{ name: string; skills: string[] }>;
  /** 玩家数量 */
  playerCount: number;
  /** 随机种子 */
  seed: number;
  /** 每人初始手牌数(默认 4) */
  handSize?: number;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '开局',
    description: '游戏开局:抽身份、选将、洗牌、发牌、启动第一回合',
  };
}

export function onInit(_skill: Skill, state: GameState): () => void {
  const entry: ActionEntry = {
    skillId: '开局',
    ownerId: SYSTEM_OWNER,
    actionType: 'start',
    validate: (state: GameState, params: Record<string, Json>) => {
      const config = params as unknown as GameConfig;
      if (config.playerCount < 2) return '至少需要2名玩家';
      return null;
    },
    execute: async (state: GameState, params: Record<string, Json>) => {
      const config = params as unknown as GameConfig;
      const { characters, playerCount, seed, handSize = 4 } = config;

      // 1. 抽身份(每人一张,主公亮明)
      await applyAtom(state, { type: '抽身份', playerCount, seed });

      // 2. 选将(交互式):流程与候选数由规则包 ruleset.opening 决定(ADR 0029)。
      //    身份局:主公先选(串行,常备/非常备 7 候选),其他人并行按身份发候选数。
      //    1v1 等无主公特权模式:全员并行等额选将。
      const ruleset = await loadRuleset(resolveGameMode(state));
      const { candidatesPerIdentity, lordPickEnabled } = ruleset.opening;
      const candidatesFor = (identity: string | undefined): number =>
        candidatesPerIdentity[identity ?? ''] ?? candidatesPerIdentity['反贼'] ?? 4;
      const charRng = createRng(seed + 1);
      const charPool = [...characters].filter((c) => c.name !== '主公');
      // 打乱武将池(打乱扁平列表后分组,等价于随机分配各版本到各组)
      for (let i = charPool.length - 1; i > 0; i--) {
        const j = charRng.nextInt(i + 1);
        const tmp = charPool[i];
        charPool[i] = charPool[j];
        charPool[j] = tmp;
      }
      // 按版本分组:同一武将的标/界/SP 版本归为一组(整组互斥)
      const charGroups = groupByBaseId(charPool);
      const lordIdx = state.players.findIndex((p) => p.identity === '主公');

      // 2a. 主公先选(串行):从池中按 isLord 拆成常备/非常备两组,合并为 7 张候选人。
      //     拆分:常备主公随机 5 + 非常备随机 2(charPool 已 seed 打乱,取前 N 即随机)。
      //     池不足时:常备不足用非常备补足,总数仍不足则给现有全部。
      //     主公选完后,池中【未被选中】的武将全部进入候选池,供其他身份玩家分配。
      //     仅 lordPickEnabled 模式(身份局);1v1 无主公特权,全员走 2b 并行。
      //     选将保密:整个选将期间 charSelecting=true,分配武将广播对他人红化,
      //     视图投影隐藏他人角色;选将结束统一 亮将 公开。
      const used = new Set<string>(); // 追踪 baseId(整组互斥)
      state.charSelecting = true;
      if (lordPickEnabled && lordIdx >= 0) {
        const lordAvail = pickLordCandidateGroups(charGroups);
        if (lordAvail.length > 0) {
          await applyAtom(state, {
            type: '选将询问',
            target: lordIdx,
            candidates: flattenGroups(lordAvail),
          });
          const lordChosen = state.players[lordIdx].character;
          if (lordChosen) used.add(getCharacterBaseId(lordChosen));
        }
      }

      // 2b. 并行选将:主公特权模式下为非主公玩家(候选池=主公未选的剩余武将),
      //     无主公特权模式(1v1)为全员(候选池=全池)。按规则包身份候选数发放。
      //     候选池必须覆盖所有人的需求——池不足时报错（不允许共享候选以避免 data race）。
      const pickers = lordPickEnabled
        ? state.players.map((_, i) => i).filter((i) => i !== lordIdx)
        : state.players.map((_, i) => i);
      if (pickers.length > 0) {
        const candidatePool = charGroups.filter((g) => !used.has(g.baseId));
        const wantByPlayer = pickers.map((idx) => candidatesFor(state.players[idx].identity));
        const totalWant = wantByPlayer.reduce((a, b) => a + b, 0);
        if (candidatePool.length < totalWant) {
          throw new Error(
            `武将池不足: 需要 ${totalWant} 个候选组提供给玩家，当前池中只有 ${candidatePool.length} 个`,
          );
        }

        const selections: Array<{
          target: number;
          candidates: Array<{ name: string; skills: string[] }>;
        }> = [];
        let cursor = 0;
        for (let k = 0; k < pickers.length; k++) {
          const want = wantByPlayer[k];
          const playerGroups = candidatePool.slice(cursor, cursor + want);
          cursor += want;
          selections.push({ target: pickers[k], candidates: flattenGroups(playerGroups) });
        }
        if (selections.length > 0) {
          await applyAtom(state, { type: '并行选将', selections });
        }
      }
      // 选将结束:关闭保密标记,一次性公开全部角色(含体力/势力/技能)。
      // 置于 pickers 条件之外:任何模式(身份局/1v1)选完都必须 亮将。
      state.charSelecting = false;
      await applyAtom(state, {
        type: '亮将',
        assignments: state.players
          .filter((p) => p.character)
          .map((p) => ({
            target: p.index,
            character: p.character,
            faction: p.faction,
            maxHealth: p.maxHealth,
            health: p.health,
            skills: [...p.skills],
          })),
      });

      // 2.5 注册技能实例(回合管理等默认技能)——必须在阶段推进前注册
      //     选将 已设置 player.skills,但技能实例需要 registerSkillsFromState 实例化
      for (const player of state.players) {
        for (const skillId of player.skills) {
          await instantiateSkill(state, skillId, player.index);
        }
      }

      // 3. 初始化洗牌(创建标准牌堆并洗混)
      await applyAtom(state, { type: '初始化洗牌', seed });

      // 4. 发牌(所有玩家 handSize 张,主公不加)
      await applyAtom(state, { type: '发牌', handSize });

      // 5. 启动第一回合(从主公开始)
      const lord = state.players.find((p) => p.identity === '主公');
      if (lord) {
        await applyAtom(state, { type: '回合开始', player: lord.index });
        await applyAtom(state, { type: '阶段开始', player: lord.index, phase: '准备' });
        // 触发阶段结束,让回合管理的阶段推进钩子接着跑(准备→判定→摸牌→出牌)
        await applyAtom(state, { type: '阶段结束', player: lord.index, phase: '准备' });
      }
    },
  };
  registerActionEntry(state, entry);
  return () => unregisterActionEntry(state, '开局', SYSTEM_OWNER, 'start');
}

// module_开局 不再走 SkillModule.onInit 路径 —— bootstrap() 直接调顶层 onInit。
// 这里只暴露 createSkill 让 SkillModule 注册表能找到这个模块(其他代码可能仍按
// SkillModule 接口查询),不再需要 registerSkillModule 注册。
