// 界旋风(界凌统·被动技,OL 界限突破官方逐字):
//   当你失去装备区里的牌后,或一次性失去至少两张牌后,
//   你可以依次弃置至多两名其他角色共计至多两张牌。
//
// 与标版旋风(凌统)的差异:
//   1. 触发条件"失去装备"两版相同。
//   2. 标版触发条件:"于弃牌阶段弃置过至少两张牌"(仅弃牌阶段,手动弃牌)
//      界版触发条件:"一次性失去至少两张牌"(任何时候,任意途径,单次 atom 丢≥2 张)
//      —— 不再限定弃牌阶段,也不限弃置方式(被拆≥2/被技能弃≥2 等均触发)。
//   3. 界版新增"依次"强调可分两步选目标(实现上等价,标版也允许至多 2 名共 2 张)。
//
// 失去装备的三条路径(与枭姬一致,详见 ./枭姬.ts):
//   1. 卸下(装备通用替换):卸下 atom,player===自己 → 装 1 件 → 手牌(再移动牌入弃牌堆)。
//   2. 弃置(过河拆桥拆装备 / 多张弃置):弃置 atom,cardIds 含装备 → 弃牌堆。
//   3. 获得(顺手牵羊顺装备):获得 atom,from===自己,cardId 来自装备区 → 他人手牌。
//   注:移动牌 atom 不支持 from 装备区(见 ./枭姬.ts 注释),故装备流失必经以上三 atom。
//
// 一次性失去≥2 张的检测:
//   仅 弃置 atom 的 cardIds.length ≥ 2 可能成立(获得/卸下均单 cardId/slot)。
//   before 快照本次弃置的"装备流失数"与"总流失数",after 判定触发条件。
//
// 触发去重(关键):
//   单个 弃置 atom 可能同时满足两条件(如一次性弃 2 件装备)。
//   把两条件合并到 弃置 after hook 的单一判定,不分别在 卸下/弃置/获得 after 注册
//   "失装备"与"丢 2+"两套 hook,避免同一 atom 触发两次。
//   获得/卸下 atom 只可能命中"失装备"条件,不会与"丢 2+"重叠,故独立挂 after。
//
// 效果实现:
//   1. confirm 询问:是否发动旋风?
//   2. 若发动:choosePlayer 选第 1 个目标(其他角色且有牌)
//   3. runPickTargetCardPanel:从目标弃 1 张(过河拆桥选牌面板,mode=discard)
//   4. 若仍有可弃目标:confirm 询问:是否继续弃第 2 张?
//   5. 若继续:choosePlayer 选第 2 个目标 → runPickTargetCardPanel 弃 1 张
//   每一步前都校验自身存活与可弃目标存在(死亡/无目标则提前结束)。
//
// 命名:文件名/loader key/character skill name 均为 '界旋风'(避开标旋风冲突);
//   内部 Skill.name = '旋风'(OL 官方技能名,玩家可见)。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  Json,
  Skill,
  GameView,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook, type SkillModule } from '../skill';
import { runPickTargetCardPanel } from './选牌面板';

const SKILL_ID = '界旋风';
const DISPLAY_NAME = '旋风';

// requestType 常量
const CONFIRM_RT = '界旋风/confirm';
const CONTINUE_RT = '界旋风/continue';
const PICK_TARGET_RT = '界旋风/选目标';
const PICK_CARD_RT = '界旋风/选牌';

// localVars 键
const CONFIRM_KEY = '界旋风/confirmed';
const CONTINUE_KEY = '界旋风/continue';
const TARGET_KEY = '界旋风/target';
const DISCARD_EQUIP_KEY = '界旋风/弃置equipLoss';
const DISCARD_TOTAL_KEY = '界旋风/弃置totalLoss';
const OBTAIN_EQUIP_KEY = '界旋风/获得equipLoss';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '失去装备区里的牌,或一次性失去至少两张牌后,可依次弃置至多两名其他角色共计至多两张牌',
  };
}

/** 玩家区域(手牌+装备)是否有牌可被弃 */
function hasDiscardableCards(player: GameState['players'][number]): boolean {
  if (!player) return false;
  if (player.hand.length > 0) return true;
  return Object.values(player.equipment).some((id) => typeof id === 'string');
}

/** 是否存在可被弃牌的其他角色(存活、非自己、有牌) */
function hasValidTargets(state: GameState, ownerId: number): boolean {
  return state.players.some(
    (p) => p.alive && p.index !== ownerId && hasDiscardableCards(p),
  );
}

/** 选一名其他角色作为弃牌目标,并对其弃 1 张牌。
 *  返回 true 表示完成一次弃牌,false 表示玩家未选目标或目标无效。 */
async function pickAndDiscard(state: GameState, ownerId: number, step: 1 | 2): Promise<boolean> {
  // 选目标
  delete state.localVars[TARGET_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: PICK_TARGET_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: `旋风:选择第 ${step} 名要弃置其牌的其他角色`,
      min: 1,
      max: 1,
      filter: (_view: GameView, t: number) =>
        t !== ownerId &&
        state.players[t]?.alive === true &&
        hasDiscardableCards(state.players[t]),
    },
    timeout: 20,
  });
  const targetIdx = state.localVars[TARGET_KEY] as number | undefined;
  delete state.localVars[TARGET_KEY];
  if (typeof targetIdx !== 'number') return false;

  const target = state.players[targetIdx];
  if (!target?.alive || !hasDiscardableCards(target)) return false;

  // 用过河拆桥选牌面板,从目标弃 1 张(明选装备/盲选手牌)
  await runPickTargetCardPanel(state, ownerId, targetIdx, target, {
    mode: 'discard',
    requestType: PICK_CARD_RT,
    title: `旋风:选择要从 ${target.name} 弃置的 1 张牌`,
    includeJudge: false, // 旋风仅限手牌+装备(经典规则不含判定区)
  });
  return true;
}

/** 触发旋风:依次弃置至多 2 名其他角色共计至多 2 张牌 */
async function triggerXuanfeng(state: GameState, ownerId: number): Promise<void> {
  const me = state.players[ownerId];
  if (!me?.alive) return;
  if (!hasValidTargets(state, ownerId)) return; // 无可弃目标 → 不触发

  // ── 1. confirm 询问 ──
  delete state.localVars[CONFIRM_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CONFIRM_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '是否发动旋风?(依次弃至多 2 名角色至多 2 张牌)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
    defaultChoice: false,
    timeout: 10,
  });
  if (!state.localVars[CONFIRM_KEY]) return;

  // ── 2. 第 1 次弃牌 ──
  if (!me.alive || !hasValidTargets(state, ownerId)) return;
  await pickAndDiscard(state, ownerId, 1);

  // ── 3. 询问是否继续第 2 次 ──
  if (!me.alive || !hasValidTargets(state, ownerId)) return;
  delete state.localVars[CONTINUE_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CONTINUE_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: '是否继续弃置第二张牌?',
      confirmLabel: '继续',
      cancelLabel: '结束',
    },
    defaultChoice: false,
    timeout: 10,
  });
  if (!state.localVars[CONTINUE_KEY]) return;

  // ── 4. 第 2 次弃牌 ──
  if (!me.alive || !hasValidTargets(state, ownerId)) return;
  await pickAndDiscard(state, ownerId, 2);
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // respond:旋风本人对各询问的回应。按 requestType 分支写 localVars。
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不是请求回应';
      const rt = atom.requestType;
      const valid = [CONFIRM_RT, CONTINUE_RT, PICK_TARGET_RT, PICK_CARD_RT];
      if (!rt || !valid.includes(rt)) return '当前不是旋风询问';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
        return;
      }
      if (rt === CONTINUE_RT) {
        st.localVars[CONTINUE_KEY] = params.choice === true || params.confirmed === true;
        return;
      }
      if (rt === PICK_TARGET_RT) {
        const t =
          (params.targets as number[] | undefined)?.[0] ??
          (typeof params.target === 'number' ? params.target : undefined);
        if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
        return;
      }
      if (rt === PICK_CARD_RT) {
        // 选牌面板结果(与过河拆桥/反馈共用契约)
        const zone = params.zone;
        if (zone === 'equipment') {
          if (typeof params.cardId !== 'string') return; // validate 应已拦截,容错
        } else if (zone === 'hand') {
          if (typeof params.handIndex !== 'number') return;
        } else {
          return;
        }
        st.localVars['选牌/结果'] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
          handIndex: params.handIndex ?? null,
        };
        return;
      }
    },
  );

  // ── 路径 1:卸下(自己替换装备) ── 必失 1 件装备
  registerAfterHook(state, skill.id, ownerId, '卸下', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { player?: number };
    if (atom.player !== ownerId) return;
    await triggerXuanfeng(ctx.state, ownerId);
  });

  // ── 路径 2:弃置(被拆装备 / 一次性弃≥2) ──
  // before 快照:apply 前记录装备流失数与总流失数
  registerBeforeHook(state, skill.id, ownerId, '弃置', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { player?: number; cardIds?: string[] };
    if (atom.player !== ownerId) return;
    const myEquip = new Set(
      Object.values(ctx.state.players[ownerId].equipment).filter(
        (id): id is string => typeof id === 'string',
      ),
    );
    const cardIds = atom.cardIds ?? [];
    const equipLoss = cardIds.filter((id) => myEquip.has(id)).length;
    // 写入本次 atom 的快照(无论是否触发,after 都会清理)
    ctx.state.localVars[DISCARD_EQUIP_KEY] = equipLoss;
    ctx.state.localVars[DISCARD_TOTAL_KEY] = cardIds.length;
  });
  // after 触发:失装备 OR 一次性≥2
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { player?: number };
    if (atom.player !== ownerId) return;
    const equipLoss = ctx.state.localVars[DISCARD_EQUIP_KEY] as number | undefined;
    const totalLoss = ctx.state.localVars[DISCARD_TOTAL_KEY] as number | undefined;
    delete ctx.state.localVars[DISCARD_EQUIP_KEY];
    delete ctx.state.localVars[DISCARD_TOTAL_KEY];
    const lostEquip = (equipLoss ?? 0) > 0;
    const lostMany = (totalLoss ?? 0) >= 2;
    if (!lostEquip && !lostMany) return;
    await triggerXuanfeng(ctx.state, ownerId);
  });

  // ── 路径 3:获得(他人顺装备) ── before 快照,after 触发
  registerBeforeHook(state, skill.id, ownerId, '获得', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom as { from?: number; cardId?: string };
    if (atom.from !== ownerId) return;
    const myEquip = new Set(
      Object.values(ctx.state.players[ownerId].equipment).filter(
        (id): id is string => typeof id === 'string',
      ),
    );
    if (atom.cardId && myEquip.has(atom.cardId)) {
      ctx.state.localVars[OBTAIN_EQUIP_KEY] = 1;
    }
  });
  registerAfterHook(state, skill.id, ownerId, '获得', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { from?: number };
    if (atom.from !== ownerId) return;
    const lost = ctx.state.localVars[OBTAIN_EQUIP_KEY] as number | undefined;
    delete ctx.state.localVars[OBTAIN_EQUIP_KEY];
    if (!lost) return;
    await triggerXuanfeng(ctx.state, ownerId);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动旋风？',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
