// 界秘计(界王异·魏·主动技,OL 界限突破官方逐字):
//   结束阶段,你可以摸X张牌(X为你已损失的体力值),然后你可以交给其他角色至多X张牌。
//
// 与标版秘计差异(标版 src/engine/skills/秘计.ts 未实现):
//   - 标版:摸X张,然后交给其他角色X张手牌("X 张",非"至多X张",且为"手牌")
//   - 界版:摸X张,然后交给其他角色"至多X张"牌(可选 0..X 张,且描述未限定"手牌"
//          ——按 OL FAQ 实践,给的必然是自己手牌;此处按"至多X张手牌"实现)
//
// 触发时机:阶段开始(结束)after-hook(phase='回合结束')
//   - OL 引擎"结束阶段" = phase '回合结束'(详见 勤学/崩坏/界志继 同位)
//   - 王异存活 && X>0 时主动询问是否发动(描述"你可以")
//   - 由 界贞烈 选项②挂起:turn.vars[`秘计/pendingFrom贞烈/${ownerId}`]=true
//     此时强制发动一次(不询问),并消费挂起标记
//
// 选项"交给其他角色至多X张牌":
//   - "其他角色" = 单一目标(官方 FAQ:秘计的分发目标为单一其他角色)
//   - "至多X张" = 0..X 张(选 0 张等同不分发)
//   - 三步询问:是否分发(确认) → 选目标(choosePlayer,排除自己,存活即可)
//     → 选 0..X 张手牌(useCard 多选)
//
// X 的计算:maxHealth - currentHealth(已损失体力值)
//   - 受伤回血后 X 减小;受伤更深 X 增大。两次秘计(贞烈挂起 + 主动)各自取当时的 X。
//
// 命名:文件名/loader key/character skill name 均为 '界秘计';内部 Skill.name='秘计'。
import type {
  FrontendAPI,
  GameView,
  GameState,
  Json,
  Skill,
  SkillModule,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const SKILL_ID = '界秘计';
const DISPLAY_NAME = '秘计';

/** turn.vars key 前缀:贞烈选项②挂起,界秘计消费(由 界贞烈.ts 写入) */
const MIJI_PENDING_PREFIX = '秘计/pendingFrom贞烈/';
/** 本次分发最大张数(供 giveCards validate 上限校验) */
const GIVE_MAX_VAR = '界秘计/giveMax';
/** 请求回应 requestType 常量 */
const CONFIRM_RT = '秘计/confirm'; // 是否发动
const GIVE_CONFIRM_RT = '秘计/giveConfirm'; // 是否分发
const GIVE_TARGET_RT = '秘计/giveTarget'; // 选目标
const GIVE_CARDS_RT = '秘计/giveCards'; // 选 0..X 张手牌

/** localVars key */
const CONFIRM_KEY = '界秘计/confirmed';
const GIVE_CONFIRM_KEY = '界秘计/giveConfirmed';
const GIVE_TARGET_KEY = '界秘计/giveTarget';
const GIVE_CARDS_KEY = '界秘计/giveCards';

/** 已损失体力值 = maxHealth - currentHealth(≥0) */
function lostHealth(state: GameState, ownerId: number): number {
  const p = state.players[ownerId];
  if (!p) return 0;
  return Math.max(0, p.maxHealth - p.health);
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '结束阶段,你可以摸X张牌(X为你已损失的体力值),然后你可以交给其他角色至多X张牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:单一 action 按 requestType 分支(只 owner 触发,无需跨座次) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as { requestType?: string }).requestType;

      if (rt === CONFIRM_RT || rt === GIVE_CONFIRM_RT) {
        return null; // confirm:接受 choice/confirmed
      }
      if (rt === GIVE_TARGET_RT) {
        const target = params.target;
        if (typeof target !== 'number') return '需要指定目标';
        if (target === ownerId) return '不能给自己';
        if (!st.players[target]?.alive) return '目标不合法';
        return null;
      }
      if (rt === GIVE_CARDS_RT) {
        const cardIds = params.cardIds as Json[] | undefined;
        const maxN = (st.localVars[GIVE_MAX_VAR] as number | undefined) ?? 0;
        if (!Array.isArray(cardIds)) return '需要 cardIds 数组(可为空)';
        if (cardIds.length > maxN) return `至多 ${maxN} 张`;
        const set = new Set(cardIds);
        if (set.size !== cardIds.length) return '不能重复';
        const self = st.players[ownerId];
        if (!self) return '玩家不存在';
        if (!cardIds.every((id) => typeof id === 'string' && self.hand.includes(id)))
          return '牌不在手牌中';
        return null;
      }
      return '当前不是秘计询问';
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === GIVE_CONFIRM_RT) {
        st.localVars[GIVE_CONFIRM_KEY] =
          params.choice === true || params.confirmed === true;
      } else if (rt === GIVE_TARGET_RT) {
        st.localVars[GIVE_TARGET_KEY] = params.target;
      } else if (rt === GIVE_CARDS_RT) {
        const cardIds = params.cardIds as Json[] | undefined;
        st.localVars[GIVE_CARDS_KEY] = Array.isArray(cardIds)
          ? (cardIds.filter((id): id is string => typeof id === 'string') as string[])
          : [];
      }
    },
  );

  // ── 阶段开始(回合结束) after-hook:秘计主逻辑 ───────────────
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx): Promise<void> => {
      const atom = ctx.atom;
      if (atom.type !== '阶段开始') return;
      if (atom.player !== ownerId) return;
      if (atom.phase !== '回合结束') return;
      const st = ctx.state;
      if (!st.players[ownerId]?.alive) return;

      //贞烈挂起的强制发动(优先于主动询问,确保 "本回合结束阶段发动一次秘计")
      const pendingKey = `${MIJI_PENDING_PREFIX}${ownerId}`;
      const forced = st.turn.vars[pendingKey] === true;
      if (forced) {
        delete st.turn.vars[pendingKey];
        await runMijiOnce(st, ownerId, /*askActivate*/ false);
      }

      // 主动询问是否发动(描述"你可以"= 可选)
      await runMijiOnce(st, ownerId, /*askActivate*/ true);
    },
  );

  return () => {};
}

/**
 * 执行一次秘计:
 *   1. (askActivate=true 时) 询问发动
 *   2. 摸 X 张牌(X = 已损失体力)
 *   3. 询问是否分发 → 选目标 → 选 0..X 张手牌 → 逐张 给予
 */
async function runMijiOnce(
  state: GameState,
  ownerId: number,
  askActivate: boolean,
): Promise<void> {
  const x = lostHealth(state, ownerId);
  if (x <= 0) return; // X=0 不发动(无牌可摸)
  if (!state.players[ownerId]?.alive) return;

  // 1) (可选)发动确认
  if (askActivate) {
    delete state.localVars[CONFIRM_KEY];
    await applyAtom(state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `秘计:是否摸 ${x} 张牌(X=已损失体力)?然后可交给其他角色至多 ${x} 张牌`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (state.localVars[CONFIRM_KEY] !== true) {
      delete state.localVars[CONFIRM_KEY];
      return;
    }
    delete state.localVars[CONFIRM_KEY];
  }

  // 2) 摸 X 张牌
  await applyAtom(state, { type: '摸牌', player: ownerId, count: x });

  // 中途死亡(理论极小概率:摸牌不导致死亡,但防御性检查)
  if (!state.players[ownerId]?.alive) return;

  // 3) 是否分发
  delete state.localVars[GIVE_CONFIRM_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: GIVE_CONFIRM_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: `秘计:是否交给其他角色至多 ${x} 张牌?`,
      confirmLabel: '分发',
      cancelLabel: '不分发',
    },
    defaultChoice: false,
    timeout: 15,
  });
  if (state.localVars[GIVE_CONFIRM_KEY] !== true) {
    delete state.localVars[GIVE_CONFIRM_KEY];
    return;
  }
  delete state.localVars[GIVE_CONFIRM_KEY];

  // 4) 选目标(其他存活角色)
  const aliveOthers = state.players.filter((p) => p.alive && p.index !== ownerId);
  if (aliveOthers.length === 0) return; // 无可分发目标 → 跳过分发
  delete state.localVars[GIVE_TARGET_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: GIVE_TARGET_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: '秘计:选择分发目标(其他角色)',
      min: 1,
      max: 1,
      filter: (_view: GameView, t: number) =>
        t !== ownerId && state.players[t]?.alive === true,
    },
    timeout: 20,
  });
  const target = state.localVars[GIVE_TARGET_KEY] as number | undefined;
  delete state.localVars[GIVE_TARGET_KEY];
  if (typeof target !== 'number' || target === ownerId) return;
  if (!state.players[target]?.alive) return;

  // 5) 选 0..X 张手牌
  state.localVars[GIVE_MAX_VAR] = x;
  delete state.localVars[GIVE_CARDS_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: GIVE_CARDS_RT,
    target: ownerId,
    prompt: {
      type: 'useCard',
      title: `秘计:选择至多 ${x} 张手牌给予 P${target}(可不选)`,
      cardFilter: { min: 0, max: x },
    },
    defaultChoice: { cardIds: [] as Json[] },
    timeout: 30,
  });
  delete state.localVars[GIVE_MAX_VAR];
  const rawCards = state.localVars[GIVE_CARDS_KEY] as string[] | undefined;
  delete state.localVars[GIVE_CARDS_KEY];
  const cardIds = Array.isArray(rawCards) ? rawCards.slice(0, x) : [];

  // 6) 逐张给予(顺序:选牌顺序;合法校验已在 respond validate 完成)
  for (const cardId of cardIds) {
    if (!state.players[ownerId].hand.includes(cardId)) continue; // 中途状态变化防御
    await applyAtom(state, { type: '给予', cardId, from: ownerId, to: target });
  }
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 被动触发(结束阶段),无主动 action 按钮;询问 UI 由通用 confirm 渲染。
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
