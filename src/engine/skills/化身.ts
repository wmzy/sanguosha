// 化身(左慈·群·主动技):游戏开始时,你随机获得两张未登场的武将牌作为化身牌,
//   然后亮出其中一张,你获得该化身牌上的一个技能(限定技、觉醒技、主公技除外)。
//   回合开始或结束时,你可以更改化身牌。
//
// 分析(步骤1):
//   类型:主动技(实际为被动触发,无需玩家按按钮——游戏开始/回合开始/回合结束自动结算)
//   触发时机:1.游戏开始时 2.回合开始阶段 3.回合结束阶段
//   限制:获得的技能不能是 限定技/觉醒技/主公技
//
// 原子操作分解:
//   初始化(游戏开始):
//     1. 从未登场武将随机抽 2 张 → player.vars['化身/牌池']
//     2. 亮出第一张(player.vars['化身/亮出']=0)
//     3. 请求回应(选技能) → 添加技能(skillId=所选) → 记录 player.vars['化身/当前技能']
//   回合开始/结束切换:
//     1. 请求回应(confirm 是否更换)
//     2. 若更换:移除技能(当前技能) → 亮出另一张 → 请求回应(选技能) → 添加技能
//
// 钩子挂载时机:
//   - 回合开始 after-hook(ownerId 实例):首次触发→初始化;后续且 atom.player===ownerId→询问切换
//   - 回合结束 after-hook(ownerId 实例):atom.player===ownerId→询问切换
//
// 缺失 atom 检查:无。所需 atom(添加技能/移除技能/请求回应/回合开始/回合结束)均已存在。
//
// 契约清单(跨 atom 通信,全部自包含于左慈):
//   | 通道                          | 类型        | 读/写 | 对端文件   | 已实现 |
//   | player.vars['化身/牌池']      | player.vars | 写/读 | 新生.ts(读) | ✅     |
//   | player.vars['化身/亮出']      | player.vars | 写/读 | 本文件      | ✅     |
//   | player.vars['化身/当前技能']  | player.vars | 写/读 | 本文件      | ✅     |
//   | localVars['化身/init/<id>']   | localVars   | 写/读 | 本文件      | ✅     |
//   | allCharacters / getCharacterMeta | 静态导入 | 读     | cards/characters | ✅ |
//
// 通用机制:不涉及出杀次数/装备/横切规则。
//
// 简化标注(允许,见任务说明):
//   - "游戏开始时":引擎无 per-player 的开局 hook,采用"首次任意玩家 回合开始 时初始化"
//     (主公第一回合开始即游戏开始,此时所有左慈实例同步初始化)。
//   - 技能选择 UI(从亮出武将挑一个技能):用 confirm prompt + respond{skill} 实现,
//     完整的武将牌+技能选择面板 UI 为"待澄清/后续"。
//   - 只有一个可选技能时自动选取(无需询问)。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
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
const SELECTED_KEY = '化身/selectedSkill';
const SWITCH_CHOICE_KEY = '化身/switchChoice';

// ── 请求回应 requestType ──
const SKILL_REQUEST = '化身/选技能';
const SWITCH_REQUEST = '化身/是否切换';
// 选技能询问时,把候选技能列表暂存到 localVars(供 respond validate 校验)
const CANDIDATES_KEY = (ownerId: number) => `化身/candidates/${ownerId}`;

/**
 * 不可作为化身技能的技能集合:限定技、觉醒技、主公技。
 * 描述明确"限定技、觉醒技、主公技除外"。
 * 引擎无正式"技能类型"字段,这里维护静态名单(来源:各技能文件头部注释)。
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
      '游戏开始时随机获得两张未登场武将牌作为化身牌,亮出一张并获得其一个技能(限定/觉醒/主公技除外);回合开始或结束时可更改化身牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:处理"选技能"与"是否切换"两类询问 ──
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
      if (rt === SWITCH_REQUEST) {
        // 是否切换:choice 布尔
        if (typeof params.choice !== 'boolean') return '需要 choice(布尔)';
        return null;
      }
      if (rt === SKILL_REQUEST) {
        // 选技能:skill 必须在候选列表中(候选暂存于 localVars)
        const candidates = (st.localVars[CANDIDATES_KEY(ownerId)] as string[] | undefined) ?? [];
        const skill = params.skill as string | undefined;
        if (typeof skill !== 'string') return '需要 skill(技能名)';
        if (candidates.length > 0 && !candidates.includes(skill)) return '该技能不在候选中';
        return null;
      }
      return '当前不是化身询问';
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId)!;
      const rt = (slot.atom as Record<string, unknown>).requestType as string;
      if (rt === SWITCH_REQUEST) {
        st.localVars[SWITCH_CHOICE_KEY] = params.choice === true;
      } else if (rt === SKILL_REQUEST) {
        st.localVars[SELECTED_KEY] = params.skill as string;
        delete st.localVars[CANDIDATES_KEY(ownerId)];
      }
    },
  );

  // ── 回合开始 after-hook:初始化(首次)/ 询问切换(自己回合) ──
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx: AtomAfterContext) => {
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;
    // 首次触发(任意玩家的首个回合开始 ≈ 游戏开始):初始化化身
    if (!st.localVars[INIT_KEY(ownerId)]) {
      st.localVars[INIT_KEY(ownerId)] = true;
      await initialize化身(st, ownerId);
      return;
    }
    // 后续:自己的回合开始 → 询问是否更换
    const atom = ctx.atom as { player?: number };
    if (atom.player !== ownerId) return;
    await offerSwitch(st, ownerId);
  });

  // ── 回合结束 after-hook:自己回合结束 → 询问是否更换 ──
  registerAfterHook(state, skill.id, ownerId, '回合结束', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { player?: number };
    if (atom.player !== ownerId) return;
    if (!ctx.state.players[ownerId]?.alive) return;
    await offerSwitch(ctx.state, ownerId);
  });

  return () => {};
}

/**
 * 初始化化身:抽 2 张未登场武将牌,亮出第一张,获得其一个可选技能。
 */
async function initialize化身(state: GameState, ownerId: number): Promise<void> {
  const player = state.players[ownerId];
  if (!player) return;
  const pool = draw化身Cards(state, ownerId, 2);
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
): Promise<void> {
  const player = state.players[ownerId];
  if (!player) return;
  const pool = player.vars[POOL_KEY] as string[] | undefined;
  if (!pool || pool.length === 0) return;

  // 选择一张有可选技能的化身牌:优先 litIdx,无技能则尝试其他
  let chosenIdx = -1;
  const order = [litIdx, ...pool.map((_, i) => i).filter((i) => i !== litIdx)];
  for (const i of order) {
    if (getUsableSkills(pool[i]).length > 0) {
      chosenIdx = i;
      break;
    }
  }
  if (chosenIdx < 0) return; // 整个池无可选技能
  player.vars[LIT_KEY] = chosenIdx;

  const litChar = pool[chosenIdx];
  const usable = getUsableSkills(litChar);
  const selected = await askSelectSkill(state, ownerId, litChar, usable);
  if (!selected) return;

  await applyAtom(state, { type: '添加技能', player: ownerId, skillId: selected });
  player.vars[CURRENT_KEY] = selected;
}

/**
 * 询问玩家是否更换化身牌;确认则卸载旧技能,亮出另一张并获得新技能。
 */
async function offerSwitch(state: GameState, ownerId: number): Promise<void> {
  const player = state.players[ownerId];
  if (!player) return;
  const pool = player.vars[POOL_KEY] as string[] | undefined;
  if (!pool || pool.length < 2) return; // 不足两张无法更换

  delete state.localVars[SWITCH_CHOICE_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: SWITCH_REQUEST,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '化身:是否更改化身牌?',
      confirmLabel: '更改',
      cancelLabel: '不更改',
    },
    defaultChoice: false,
    timeout: 30,
  });
  const choice = state.localVars[SWITCH_CHOICE_KEY];
  delete state.localVars[SWITCH_CHOICE_KEY];
  if (choice !== true) return;

  // 卸载旧化身技能
  const oldSkill = player.vars[CURRENT_KEY] as string | undefined;
  if (oldSkill) {
    await applyAtom(state, { type: '移除技能', player: ownerId, skillId: oldSkill });
    delete player.vars[CURRENT_KEY];
  }

  // 亮出另一张(切换到不同索引)
  const curLit = (player.vars[LIT_KEY] as number | undefined) ?? 0;
  const newLit = curLit === 0 ? 1 : 0;
  await lightAndGainSkill(state, ownerId, newLit);
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
      type: 'confirm',
      title: `化身:从「${litChar}」选择一个技能(${usable.join(' / ')})`,
      confirmLabel: '确定',
      cancelLabel: '取消',
    },
    // 超时默认第一个可用技能(不放弃获得技能的机会)
    defaultChoice: usable[0] as unknown as Json,
    timeout: 30,
  });

  let selected = state.localVars[SELECTED_KEY] as string | undefined;
  delete state.localVars[SELECTED_KEY];
  if (!selected || !usable.includes(selected)) selected = usable[0];
  return selected;
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  // 化身的 respond(选技能 / 是否更换)由 pending 驱动,无主动按钮。
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
