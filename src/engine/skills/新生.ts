// 新生(左慈·群·被动技):每当你受到 1 点伤害后,你可以获得一张新的化身牌。
//
// 分析(步骤1):
//   类型:被动技(被动触发)
//   触发时机:受到 1 点伤害后(「造成伤害」atom 的 after-hook,target===ownerId)
//   效果:从未登场武将中随机抽 1 张,加入化身牌池
//   限制:无次数限制(每点伤害触发一次)
//
// 原子操作分解:
//   造成伤害 after(target=ownerId,amount>0):
//     1. 请求回应(confirm 是否发动)
//     2. 若确认:从未登场武将随机抽 1 张 → 追加到 player.vars['化身/牌池']
//
// 钩子挂载时机:造成伤害 after-hook(target===ownerId 且 amount>0)
//
// 缺失 atom 检查:无。
//
// 契约清单:
//   | 通道                     | 类型        | 读/写 | 对端文件   | 已实现 |
//   | player.vars['化身/牌池'] | player.vars | 读/写 | 化身.ts(写) | ✅     |
//   | localVars['新生/choice'] | localVars   | 写/读 | 本文件      | ✅     |
//
// 通用机制:不涉及出杀次数/装备/横切规则。
import type { AtomAfterContext, FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';
import { allCharacters } from '../cards/characters';
import { createRng } from '../../shared/rng';

const CONFIRM_REQUEST = '新生/confirm';
const CHOICE_KEY = '新生/choice';
const POOL_KEY = '化身/牌池';

/** 本局已登场武将名集合。 */
function debutedCharacters(state: GameState): Set<string> {
  const set = new Set<string>();
  for (const p of state.players) {
    if (p.character) set.add(p.character);
  }
  return set;
}

/**
 * 从未登场武将中随机抽 1 张(排除本局已登场 + owner 化身牌池已有)。
 * 用 state.rngSeed 派生 RNG 并推进写回,保证确定性。
 * 池为空(所有武将都已登场/在牌池中)时返回 null。
 */
function drawNew化身Card(state: GameState, ownerId: number): string | null {
  const debuted = debutedCharacters(state);
  const existingPool = (state.players[ownerId]?.vars[POOL_KEY] as string[] | undefined) ?? [];
  const taken = new Set<string>([...debuted, ...existingPool]);
  const available = allCharacters.map((c) => c.name).filter((name) => !taken.has(name));
  if (available.length === 0) return null;
  const rng = createRng(state.rngSeed);
  const idx = rng.nextInt(available.length);
  state.rngSeed = rng.getState();
  return available[idx];
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '新生',
    description: '每当你受到 1 点伤害后,你可以获得一张新的化身牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:确认是否获得新化身牌 ──
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
      if (atom['requestType'] !== CONFIRM_REQUEST) return '当前不是新生询问';
      if (typeof params.choice !== 'boolean') return '需要 choice(布尔)';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CHOICE_KEY] = params.choice === true;
    },
  );

  // ── 造成伤害 after-hook:ownerId 受伤 → 询问 → 抽牌 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; amount?: number };
    if (atom.target !== ownerId) return;
    const amount = atom.amount ?? 0;
    if (amount <= 0) return;
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;

    // 每 1 点伤害触发一次新生
    for (let i = 0; i < amount; i++) {
      // 先检查是否还有可抽的武将(避免无意义询问)
      const candidate = drawNew化身CardSnapshot(st, ownerId);
      if (candidate === null) break;

      delete st.localVars[CHOICE_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CONFIRM_REQUEST,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '新生:是否获得一张新的化身牌?',
          confirmLabel: '获得',
          cancelLabel: '不获得',
        },
        defaultChoice: false,
        timeout: 30,
      });
      const choice = st.localVars[CHOICE_KEY];
      delete st.localVars[CHOICE_KEY];
      if (choice !== true) continue;

      // 确认 → 从未登场武将抽 1 张加入牌池
      const drawn = drawNew化身Card(st, ownerId);
      if (drawn === null) break;
      const player = st.players[ownerId];
      const pool = (player.vars[POOL_KEY] as string[] | undefined) ?? [];
      pool.push(drawn);
      player.vars[POOL_KEY] = pool;
    }
  });

  return () => {};
}

/**
 * 只读快照:探测是否还有可抽的未登场武将(不推进 rng)。
 * 用于在询问前判断是否值得询问玩家。
 */
function drawNew化身CardSnapshot(state: GameState, ownerId: number): string | null {
  const debuted = debutedCharacters(state);
  const existingPool = (state.players[ownerId]?.vars[POOL_KEY] as string[] | undefined) ?? [];
  const taken = new Set<string>([...debuted, ...existingPool]);
  const available = allCharacters.map((c) => c.name).filter((name) => !taken.has(name));
  return available.length > 0 ? available[0] : null;
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '新生',
    style: 'passive',
    prompt: {
      type: 'confirm',
      title: '新生:是否获得一张新的化身牌?',
      confirmLabel: '获得',
      cancelLabel: '不获得',
    },
  });
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
