// 界血裔(界袁绍·群·主公技,OL 界限突破官方逐字):
//   主公技,游戏开始时,你获得X枚"裔"标记(X为群势力角色数的两倍)。
//   出牌阶段开始时,你可以移除1枚"裔"并摸一张牌。
//   你每有1枚"裔",手牌上限便+1。
//
// 与标版袁绍区别:
//   - 标版袁绍无"血裔"技能。
//   - 界袁绍新增此主公技(三段效果)。必须独立界版文件。
//
// 实现要点:
//   - 主公技:仅 ownerId===0(主公固定 0 号位)时生效。其他座次时 hook 注册但不触发。
//   - 裔存储:每枚裔 = 一个 mark,id 形如 `血裔/裔:N`(N=state.seq 唯一,
//     参考 界巧变的"变"、屯田的"田")。count = marks 中此前缀数量。
//     加/减经 加标记/去标记 atom(view 自动同步)。
//   - 游戏开始初始化(化身/界巧变先例):'回合开始' after-hook,首次触发时给本玩家
//     加 X 枚裔 mark。X = 2 × 群势力存活角色数(含主公自己,主公本身是群势力)。
//     主公首回合开始 ≈ 游戏开始,所有座次的界血裔实例同步初始化。
//   - 出牌阶段开始:'阶段开始' after-hook(phase='出牌', player=ownerId) → 若裔>0,
//     请求回应 confirm 询问是否发动。确认 → 去 1 mark + 摸 1 牌。
//   - 手牌上限+裔数:registerHandLimitProvider 返回 默认公式(health+bonus) + 裔数。
//     永久常驻,随技能实例注册/卸载。裔数动态计算(裔变动后立即反映)。
//
// 命名:文件名/loader key/character skill name 均为 '界血裔'(标版无血裔,直接用 界 前缀);
//   内部 Skill.name = '血裔'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';
import { registerHandLimitProvider } from '../hand-limit';

const SKILL_ID = '界血裔';
const DISPLAY_NAME = '血裔';
/** 裔 mark id 前缀。每枚裔 = 1 个 mark。 */
const YI_PREFIX = `${SKILL_ID}/裔:`;
/** 游戏开始初始化标记(localVars,per-owner,首次触发后置 true) */
const INIT_KEY = (ownerId: number) => `${SKILL_ID}/init/${ownerId}`;
/** "出牌阶段开始时是否发动"请求回应的 requestType */
const USE_RT = `${SKILL_ID}/use`;
/** localVars key:玩家发动选择(respond 写,after-hook 读) */
const USE_CHOICE_KEY = `${SKILL_ID}/useChoice`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '主公技:游戏开始时获得X枚裔标记(X为群势力角色数的两倍);出牌阶段开始时可移除1枚裔并摸一张牌;每枚裔手牌上限+1',
  };
}

/** 数当前玩家的裔标记数 */
function yiCount(state: GameState, player: number): number {
  return state.players[player]?.marks.filter((m) => m.id.startsWith(YI_PREFIX)).length ?? 0;
}

/** 加 1 枚裔 mark(经 加标记 atom,view 自动同步) */
async function addYi(state: GameState, player: number): Promise<void> {
  await applyAtom(state, {
    type: '加标记',
    player,
    mark: { id: `${YI_PREFIX}${state.seq}`, scope: player },
  });
}

/** 移除 1 枚裔 mark(按加入顺序依次移除) */
async function removeYi(state: GameState, player: number): Promise<void> {
  const marks = state.players[player]?.marks ?? [];
  const target = marks.find((m) => m.id.startsWith(YI_PREFIX));
  if (!target) return;
  await applyAtom(state, { type: '去标记', player, markId: target.id });
}

/** 全场存活群势力角色数(含主公自己) */
function countQunAlive(state: GameState): number {
  let n = 0;
  for (const p of state.players) {
    if (p.alive && p.faction === '群') n += 1;
  }
  return n;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 手牌上限覆盖提供者:默认公式 + 裔数 ──
  //   永久常驻:随技能实例注册/卸载(走 setSkillInstanceUnload 统一清理)。
  //   返回 health + bonus + 裔数(动态:裔变动后立即反映)。
  //   主公技:仅主公(ownerId===0)时生效;非主公座次时 provider 仍注册但不覆盖
  //   (内部判断 ownerId===0)。
  const unloadProvider = registerHandLimitProvider(state, ownerId, (st, player) => {
    if (player !== ownerId) return undefined;
    if (ownerId !== 0) return undefined; // 主公技:仅主公
    const p = st.players[player];
    if (!p) return undefined;
    const bonus = (st.turn.vars[`手牌上限/bonus:${player}`] as number | undefined) ?? 0;
    return (p.health ?? 0) + bonus + yiCount(st, player);
  });

  // ── 游戏开始初始化(化身/界巧变先例):'回合开始' after-hook,首次触发加 X 枚裔 ──
  //   主公技:仅 ownerId===0(主公)时触发。
  const unloadInitHook = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '回合开始',
    async (ctx) => {
      if (ownerId !== 0) return; // 主公技:仅主公
      const st = ctx.state;
      const me = st.players[ownerId];
      if (!me?.alive) return;
      if (st.localVars[INIT_KEY(ownerId)]) return; // 仅首次触发
      st.localVars[INIT_KEY(ownerId)] = true;
      const count = countQunAlive(st);
      const total = count * 2;
      for (let i = 0; i < total; i++) {
        await addYi(st, ownerId);
      }
    },
  );

  // ── 出牌阶段开始时:可移除 1 裔 + 摸 1 牌 ──
  //   主公技:仅 ownerId===0(主公)时触发。
  //   流程:'阶段开始'(player=ownerId, phase='出牌') after-hook → 若裔>0,
  //   请求回应 confirm 询问 → 确认 → 去 1 裔 + 摸 1 牌。
  const unloadPhaseHook = registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx) => {
      if (ownerId !== 0) return; // 主公技:仅主公
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '出牌') return;
      const st = ctx.state;
      const me = st.players[ownerId];
      if (!me?.alive) return;
      if (yiCount(st, ownerId) <= 0) return; // 无裔,无法发动

      // 询问是否发动
      delete st.localVars[USE_CHOICE_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: USE_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '血裔:是否移除 1 枚裔标记并摸一张牌?',
          confirmLabel: '移除裔并摸牌',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 20,
      });

      const choice = st.localVars[USE_CHOICE_KEY];
      delete st.localVars[USE_CHOICE_KEY];
      if (choice !== true) return; // 不发动

      // 移除 1 裔 + 摸 1 牌
      await removeYi(st, ownerId);
      if (st.players[ownerId]?.alive) {
        await applyAtom(st, { type: '摸牌', player: ownerId, count: 1 });
      }
    },
  );

  // ── respond action:处理 confirm 询问(是否发动血裔) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不是血裔询问';
      if (atom.requestType !== USE_RT) return '当前不是血裔询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      st.localVars[USE_CHOICE_KEY] = params.confirmed === true;
    },
  );

  return () => {
    unloadProvider();
    unloadInitHook();
    unloadPhaseHook();
  };
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 主公技:无主动 use action 声明;仅 confirm 询问响应由 respond action 处理。
  // 前端不渲染独立按钮——触发时机由"出牌阶段开始"被动询问驱动。
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
