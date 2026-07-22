// 界化身(界左慈·群·主动技):游戏开始时,你随机获得三张武将牌作为"化身"牌,
//   然后展示其中一张,获得此"化身"牌上的一个技能(限定技、觉醒技、主公技除外),
//   且性别和势力视为与之相同。回合开始时和回合结束后,你可以选择一项:
//   1. 替换展示的"化身"牌及因此获得的技能;
//   2. 移去至多两张"化身"牌并获得等量新的"化身"牌。
//
// 分析(步骤1):
//   类型:主动技(实际为被动触发,无需玩家按按钮——游戏开始/回合开始/回合结束自动结算)
//   触发时机:1.游戏开始时 2.回合开始阶段 3.回合结束阶段
//   限制:获得的技能不能是 限定技/觉醒技/主公技
//
// 与标版 化身 的差异(OL 界限突破):
//   1. **初始 3 张化身牌**(标版为 2 张)。
//   2. **回合行动二选一**(标版仅"替换展示"):1.替换展示 2.移去至多两张并获得等量新的。
//   3. **性别和势力视为与展示牌相同**(标版无此效果)。
//
// 原子操作分解:
//   初始化(游戏开始):
//     1. 从未登场武将随机抽 3 张 → player.vars['化身/牌池']
//     2. 亮出第一张(player.vars['化身/亮出']=0)
//     3. 请求回应(选技能) → 添加技能(skillId=所选) → 记录 player.vars['化身/当前技能']
//   回合开始/结束(选择行动):
//     1. 请求回应(选择行动:1=替换,2=移去,3=不操作)
//     2. 若选 1(替换):移除当前技能 → 亮出另一张 → 请求回应(选技能) → 添加技能
//     3. 若选 2(移去):请求回应(张数 1 或 2)→ 从池中移除该数量(保留展示牌)
//        → 抽等量新牌追加到池
//
// 钩子挂载时机:
//   - 回合开始 after-hook(ownerId 实例):首次触发→初始化;后续且 atom.player===ownerId→询问行动
//   - 回合结束 after-hook(ownerId 实例):atom.player===ownerId→询问行动
//
// 缺失 atom 检查:无。所需 atom(添加技能/移除技能/请求回应/回合开始/回合结束)均已存在。
//
// 契约清单(跨 atom 通信):
//   | 通道                            | 类型        | 读/写   | 对端文件     | 已实现 |
//   | player.vars['化身/牌池']        | player.vars | 写/读   | 新生.ts(读)  | ✅     |
//   | player.vars['化身/亮出']        | player.vars | 写/读   | 本文件        | ✅     |
//   | player.vars['化身/当前技能']    | player.vars | 写/读   | 本文件        | ✅     |
//   | localVars['界化身/init/<id>']   | localVars   | 写/读   | 本文件        | ✅     |
//   | localVars['界化身/actionChoice']| localVars   | 写/读   | 本文件        | ✅     |
//   | localVars['界化身/swapCount']   | localVars   | 写/读   | 本文件        | ✅     |
//   | allCharacters / getCharacterMeta| 静态导入    | 读      | cards/...    | ✅     |
//
// 通用机制:不涉及出杀次数/装备/横切规则。
//
// 简化标注(允许,见任务说明):
//   - "游戏开始时":引擎无 per-player 开局 hook,采用"首次任意玩家 回合开始 时初始化"
//     (主公第一回合开始即视为游戏开始,所有界左慈实例同步初始化)。与标版 化身 一致。
//   - 技能选择 UI(从亮出武将挑一个技能):用 confirm prompt + respond{skill} 实现,
//     完整的武将牌+技能选择面板 UI 为"待澄清/后续"。与标版 化身 一致。
//   - 只有一个可选技能时自动选取(无需询问)。
//   - "移去至多两张":简化为移去池末尾的卡片(不弹面板让玩家选具体哪张),
//     但**始终保留展示牌**(避免歧义——展示牌被移去后技能归属未明确)。
//   - **性别/势力视为与之相同**:本引擎 PlayerState 无 runtime gender 字段(性别由
//     `getGender(p.character)` 从角色名派生);势力 `p.faction` 虽可变,但改动需通过
//     atom + 视图事件传播才能保持 buildView/processedView 一致。此处**未实现**性别/势力
//     覆盖(待新增"设置化身身份" atom + 视图事件 + 6 个消费者更新)。
//     影响:结姻/界结姻/离间/肉林/界燕语/界荐言 等性别相关技能仍按界左慈原角色判定。
import type { AtomAfterContext, Faction, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { createRng } from '../../shared/rng';
import { registerAction, registerAfterHook } from '../skill';
import { allCharacters } from '../cards/characters';
import { getCharacterMeta } from '../character-meta';

// ── player.vars / localVars 命名空间 ──
const POOL_KEY = '化身/牌池';
const LIT_KEY = '化身/亮出';
const CURRENT_KEY = '化身/当前技能';
const INIT_KEY = (ownerId: number) => `化身/init/${ownerId}`;
const SELECTED_KEY = '界化身/selectedSkill';
const ACTION_CHOICE_KEY = '界化身/actionChoice';
const SWAP_COUNT_KEY = '界化身/swapCount';

// ── 请求回应 requestType ──
const SKILL_REQUEST = '界化身/选技能';
const ACTION_REQUEST = '界化身/选择行动';
const SWAP_COUNT_REQUEST = '界化身/移除数量';
// 选技能询问时,把候选技能列表暂存到 localVars(供 respond validate 校验)
const CANDIDATES_KEY = (ownerId: number) => `界化身/candidates/${ownerId}`;
const CHARACTER_REQUEST = '界化身/选化身牌';
const CHARACTER_CHOICE_KEY = '界化身/characterChoice';

/** 初始化身牌数量:界版为 3(标版为 2)。 */
const INITIAL_POOL_SIZE = 3;
/** 回合行动二选一:1=替换展示,2=移去并获得等量新,3=不操作。 */
const ACTION_REPLACE = 1;
const ACTION_SWAP = 2;
const ACTION_SKIP = 3;

/**
 * 不可作为化身技能的技能集合:限定技、觉醒技、主公技。
 * 描述明确"限定技、觉醒技、主公技除外"。与标版 化身 一致。
 */
const EXCLUDED_SKILLS: ReadonlySet<string> = new Set([
  // 限定技
  '乱武',
  '涅槃',
  // 觉醒技
  '凿险',
  '志继',
  '若愚',
  '魂姿',
  // 主公技
  '护驾',
  '救援',
  '暴虐',
  '激将',
  '颂威',
  '黄天',
  '制霸',
]);

/** 本局已登场的武将名(state.players 的 character)。化身牌池须排除这些。 */
function debutedCharacters(state: GameState): Set<string> {
  const set = new Set<string>();
  for (const p of state.players) {
    if (p.character) set.add(p.character);
  }
  return set;
}

/**
 * 从未登场武将中随机抽取 n 张(不重复,排除本局已登场 + 该 owner 化身牌池已有的)。
 * 用 state.rngSeed 派生 RNG 并推进写回,保证确定性。
 * 池不足时返回所能抽到的全部(不报错——左慈 FAQ 允许池小)。
 */
function draw化身Cards(state: GameState, ownerId: number, n: number): string[] {
  const debuted = debutedCharacters(state);
  const existingPool = (state.players[ownerId]?.vars[POOL_KEY] as string[] | undefined) ?? [];
  const taken = new Set<string>([...debuted, ...existingPool]);
  const available = allCharacters.map((c) => c.name).filter((name) => !taken.has(name));
  if (available.length === 0) return [];
  // Fisher-Yates 洗牌 available,取前 n 张
  const rng = createRng(state.rngSeed);
  for (let i = available.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = available[i];
    available[i] = available[j];
    available[j] = tmp;
  }
  state.rngSeed = rng.getState();
  return available.slice(0, Math.min(n, available.length));
}

/** 武将的可选化身技能:排除 限定/觉醒/主公技。 */
function getUsableSkills(characterName: string): string[] {
  const meta = getCharacterMeta(characterName);
  if (!meta) return [];
  return meta.skills.filter((s) => !EXCLUDED_SKILLS.has(s));
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '化身',
    description:
      '游戏开始时随机获得三张未登场武将牌作为化身牌,亮出一张并获得其一个技能;回合开始或结束时可选择替换展示或移去至多两张并获得等量新的',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:处理"选技能"/"选择行动"/"移除数量"三类询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      const rt = atom['requestType'] as string;
      if (rt === ACTION_REQUEST) {
        // 选择行动:1=替换 2=移去 3=不操作
        const action = Number(params.option);
        if (!Number.isInteger(action) || ![ACTION_REPLACE, ACTION_SWAP, ACTION_SKIP].includes(action)) {
          return '需要 option(1=替换, 2=移去, 3=不操作)';
        }
        const pool = (st.players[ownerId]?.vars[POOL_KEY] as string[] | undefined) ?? [];
        if (action === ACTION_REPLACE && pool.length < 2) {
          return '化身牌不足,无法替换';
        }
        if (action === ACTION_SWAP && pool.length < 2) {
          return '化身牌不足,无法移去';
        }
        return null;
      }
      if (rt === SWAP_COUNT_REQUEST) {
        const count = Number(params.option);
        if (!Number.isInteger(count) || ![1, 2].includes(count)) {
          return '需要 option(1 或 2)';
        }
        const pool = (st.players[ownerId]?.vars[POOL_KEY] as string[] | undefined) ?? [];
        // 保留展示牌:最多移去 pool.length - 1 张
        const maxRemovable = Math.min(2, pool.length - 1);
        if (count > maxRemovable) return `最多移去 ${maxRemovable} 张`;
        return null;
      }
      if (rt === SKILL_REQUEST) {
        const candidates = (st.localVars[CANDIDATES_KEY(ownerId)] as string[] | undefined) ?? [];
        const selected = params.option;
        if (typeof selected !== 'string') return '需要 option(技能名)';
        if (candidates.length > 0 && !candidates.includes(selected)) return '该技能不在候选中';
        return null;
      }
      if (rt === CHARACTER_REQUEST) {
        const pool = (st.players[ownerId]?.vars[POOL_KEY] as string[] | undefined) ?? [];
        const charName = params.option as string | undefined;
        if (typeof charName !== 'string') return '需要 option(武将名)';
        if (!pool.includes(charName)) return '该武将不在化身牌池中';
        return null;
      }
      return '当前不是界化身询问';
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId)!;
      const rt = (slot.atom as Record<string, unknown>).requestType as string;
      if (rt === ACTION_REQUEST) {
        st.localVars[ACTION_CHOICE_KEY] = Number(params.option);
      } else if (rt === SWAP_COUNT_REQUEST) {
        st.localVars[SWAP_COUNT_KEY] = Number(params.option);
      } else if (rt === CHARACTER_REQUEST) {
        st.localVars[CHARACTER_CHOICE_KEY] = params.option;
      } else if (rt === SKILL_REQUEST) {
        st.localVars[SELECTED_KEY] = params.option;
        delete st.localVars[CANDIDATES_KEY(ownerId)];
      }
    },
  );

  // ── 回合开始 after-hook:初始化(首次)/ 询问行动(自己回合) ──
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx: AtomAfterContext) => {
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;
    // 首次触发(任意玩家的首个回合开始 ≈ 游戏开始):初始化化身
    if (!st.localVars[INIT_KEY(ownerId)]) {
      st.localVars[INIT_KEY(ownerId)] = true;
      await initialize化身(st, ownerId);
      return;
    }
    // 后续:自己的回合开始 → 询问行动
    const atom = ctx.atom as { player?: number };
    if (atom.player !== ownerId) return;
    await offerTurnAction(st, ownerId);
  });

  // ── 回合结束 after-hook:自己回合结束 → 询问行动 ──
  registerAfterHook(state, skill.id, ownerId, '回合结束', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { player?: number };
    if (atom.player !== ownerId) return;
    if (!ctx.state.players[ownerId]?.alive) return;
    await offerTurnAction(ctx.state, ownerId);
  });

  return () => {};
}

/**
 * 初始化化身:抽 3 张未登场武将牌,亮出第一张,获得其一个可选技能。
 */
async function initialize化身(state: GameState, ownerId: number): Promise<void> {
  const player = state.players[ownerId];
  if (!player) return;
  const pool = draw化身Cards(state, ownerId, INITIAL_POOL_SIZE);
  player.vars[POOL_KEY] = pool;
  player.vars[LIT_KEY] = 0;
  if (pool.length === 0) return;

  await lightAndGainSkill(state, ownerId, 0);
}

/**
 * 亮出牌池中第 litIdx 张,询问并添加其一个可选技能。
 * 若该武将无可选技能,自动尝试亮出另一张;都无则放弃。
 */
async function lightAndGainSkill(
  state: GameState,
  ownerId: number,
  litIdx: number,
  excludeIdx?: number,
): Promise<void> {
  const player = state.players[ownerId];
  if (!player) return;
  const pool = player.vars[POOL_KEY] as string[] | undefined;
  if (!pool || pool.length === 0) return;

  // 找出所有有可选技能的武将牌(排除指定索引,如替换时排除当前展示)
  const usableIndices = pool
    .map((_, i) => i)
    .filter((i) => getUsableSkills(pool[i]).length > 0)
    .filter((i) => i !== excludeIdx);
  if (usableIndices.length === 0) return; // 整个池无可选技能
  // 多张可选 → 询问玩家选化身牌;单张 → 自动选
  let chosenIdx: number;
  if (usableIndices.length === 1) {
    chosenIdx = usableIndices[0];
  } else {
    chosenIdx = await askSelectCharacter(state, ownerId, pool, usableIndices);
    if (chosenIdx < 0) chosenIdx = usableIndices[0]; // 超时兜底
  }
  player.vars[LIT_KEY] = chosenIdx;

  const litChar = pool[chosenIdx];
  const usable = getUsableSkills(litChar);
  const selected = await askSelectSkill(state, ownerId, litChar, usable);
  if (!selected) return;

  await applyAtom(state, { type: '添加技能', player: ownerId, skillId: selected });
  player.vars[CURRENT_KEY] = selected;
}

/**
 * 回合开始/结束行动:询问玩家选择 1=替换 / 2=移去 / 3=不操作,并执行。
 */
async function offerTurnAction(state: GameState, ownerId: number): Promise<void> {
  const player = state.players[ownerId];
  if (!player) return;
  const pool = player.vars[POOL_KEY] as string[] | undefined;
  if (!pool || pool.length < 2) return; // 不足两张:无法替换也无法移去,跳过

  delete state.localVars[ACTION_CHOICE_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: ACTION_REQUEST,
    target: ownerId,
    prompt: {
      type: 'chooseOption',
      title: '化身:选择行动',
      options: [
        { value: String(ACTION_REPLACE), label: '替换展示的化身牌及技能' },
        { value: String(ACTION_SWAP), label: '移去化身牌并获得等量新的' },
        { value: String(ACTION_SKIP), label: '不操作' },
      ],
    },
    defaultChoice: String(ACTION_SKIP) as unknown as Json,
    timeout: 30,
  });
  const action = state.localVars[ACTION_CHOICE_KEY];
  delete state.localVars[ACTION_CHOICE_KEY];
  if (action === ACTION_REPLACE) {
    await doReplace(state, ownerId);
  } else if (action === ACTION_SWAP) {
    await doSwap(state, ownerId);
  }
  // action === ACTION_SKIP 或超时:不操作
}

/**
 * 行动 1:替换展示的化身牌及因此获得的技能。
 * 卸载旧技能,亮出另一张并获得新技能。
 */
async function doReplace(state: GameState, ownerId: number): Promise<void> {
  const player = state.players[ownerId];
  if (!player) return;
  const pool = player.vars[POOL_KEY] as string[] | undefined;
  if (!pool || pool.length < 2) return;

  // 卸载旧化身技能
  const oldSkill = player.vars[CURRENT_KEY] as string | undefined;
  if (oldSkill) {
    await applyAtom(state, { type: '移除技能', player: ownerId, skillId: oldSkill });
    delete player.vars[CURRENT_KEY];
  }

  // 亮出另一张(切换到不同索引)
  const curLit = (player.vars[LIT_KEY] as number | undefined) ?? 0;
  const newLit = (curLit + 1) % pool.length;
  await lightAndGainSkill(state, ownerId, newLit, curLit);
}

/**
 * 行动 2:移去至多两张化身牌并获得等量新的化身牌。
 * 简化:移去池末尾的卡片,始终保留展示牌(避免歧义)。
 * 不改变当前展示的化身牌和技能。
 */
async function doSwap(state: GameState, ownerId: number): Promise<void> {
  const player = state.players[ownerId];
  if (!player) return;
  const pool = player.vars[POOL_KEY] as string[] | undefined;
  if (!pool || pool.length < 2) return;

  const litIdx = (player.vars[LIT_KEY] as number | undefined) ?? 0;
  const maxRemovable = Math.min(2, pool.length - 1); // 保留展示牌

  delete state.localVars[SWAP_COUNT_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: SWAP_COUNT_REQUEST,
    target: ownerId,
    prompt: {
      type: 'chooseOption',
      title: '化身:移去几张化身牌并获得等量新的?',
      options: Array.from({ length: maxRemovable }, (_, i) => ({
        value: String(i + 1),
        label: `移去 ${i + 1} 张并获得 ${i + 1} 张新的（展示牌保留）`,
      })),
    },
    defaultChoice: '1' as unknown as Json,
    timeout: 30,
  });
  const rawCount = state.localVars[SWAP_COUNT_KEY];
  delete state.localVars[SWAP_COUNT_KEY];
  if (typeof rawCount !== 'number') return;
  const count = Math.min(rawCount, maxRemovable);
  if (count < 1) return;

  // 选择要移除的索引:优先末尾的非展示牌
  const toRemove: number[] = [];
  for (let i = pool.length - 1; i >= 0 && toRemove.length < count; i--) {
    if (i !== litIdx) toRemove.push(i);
  }
  const removeSet = new Set(toRemove);
  // 保留池:过滤掉被移除的索引
  const kept: string[] = [];
  let newLitIdx = 0;
  for (let i = 0; i < pool.length; i++) {
    if (removeSet.has(i)) continue;
    if (i === litIdx) newLitIdx = kept.length;
    kept.push(pool[i]);
  }
  // 抽等量新牌追加到池
  const drawn = draw化身Cards(state, ownerId, count);
  kept.push(...drawn);

  player.vars[POOL_KEY] = kept;
  player.vars[LIT_KEY] = newLitIdx;
  // 不改变 CURRENT_KEY(展示牌保留 → 技能不变)
}

/**
 * 请求玩家从牌池中选择一张化身牌(多张有可选技能时)。
 * 返回选中的 pool 索引,或 -1(超时/未选)。
 */
async function askSelectCharacter(
  state: GameState,
  ownerId: number,
  pool: string[],
  usableIndices: number[],
): Promise<number> {
  delete state.localVars[CHARACTER_CHOICE_KEY];
  const characterCards: Record<string, { faction: Faction; skills: string[] }> = {};
  for (const i of usableIndices) {
    const meta = getCharacterMeta(pool[i]);
    characterCards[pool[i]] = {
      faction: meta?.faction ?? '群',
      skills: getUsableSkills(pool[i]),
    };
  }
  await applyAtom(state, {
    type: '请求回应',
    requestType: CHARACTER_REQUEST,
    target: ownerId,
    prompt: {
      type: 'chooseOption',
      title: '化身:选择一张化身牌',
      options: usableIndices.map((i) => ({ value: pool[i], label: pool[i] })),
      characterCards,
    },
    defaultChoice: pool[usableIndices[0]] as unknown as Json,
    timeout: 30,
  });
  const chosen = state.localVars[CHARACTER_CHOICE_KEY] as string | undefined;
  delete state.localVars[CHARACTER_CHOICE_KEY];
  return chosen ? pool.indexOf(chosen) : -1;
}

/**
 * 请求玩家从 litChar 的 usable 技能中选一个。
 * 只有一个可选技能时自动选取(简化);超时/未选 → 第一个。
 * 返回选中的技能名,或 undefined(无可选)。
 */
async function askSelectSkill(
  state: GameState,
  ownerId: number,
  litChar: string,
  usable: string[],
): Promise<string | undefined> {
  if (usable.length === 0) return undefined;
  if (usable.length === 1) return usable[0];

  delete state.localVars[SELECTED_KEY];
  state.localVars[CANDIDATES_KEY(ownerId)] = usable;
  await applyAtom(state, {
    type: '请求回应',
    requestType: SKILL_REQUEST,
    target: ownerId,
    prompt: {
      type: 'chooseOption',
      title: `化身:从「${litChar}」选择一个技能`,
      options: usable.map((s) => ({ value: s, label: s })),
    },
    defaultChoice: usable[0] as unknown as Json,
    timeout: 30,
  });

  let selected = state.localVars[SELECTED_KEY] as string | undefined;
  delete state.localVars[SELECTED_KEY];
  if (!selected || !usable.includes(selected)) selected = usable[0];
  return selected;
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  // 界化身的 respond(选技能 / 选择行动 / 移除数量)由 pending 驱动,无主动按钮。
  // 完整的"武将牌+技能选择面板"UI 为待澄清/后续工作。
  api.defineAction('respond', {
    label: '化身',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '化身',
      confirmLabel: '确定',
      cancelLabel: '取消',
    },
  });
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
