// 界酒诗(界曹植·主动技,OL 界限突破官方逐字):
//   你可以将武将牌翻至背面,视为使用一张【酒】。
//   若你的武将牌背面朝上,你使用的"落英"牌无距离限制且不能被响应。
//   当你受到伤害后,或回合外累计获得至少X张"落英"牌后(X为你体力值上限),
//   若你的武将牌背面朝上,你可以翻至正面。
//
// 与标版区别:标版酒诗只支持"翻面+受伤翻回正面"。界版扩展:
//   1. 背面朝上时,"落英"牌无距离限制且不能被响应。
//   2. 翻回正面机制扩展:除受伤后,新增"回合外累计获得至少X张落英牌后"触发。
//
// 实现说明:
//   - 主动技 use:仅当正面朝上时可发动 → 加 '酒诗/翻面' 标签 + 视为使用一张酒
//     (走 酒.ts 的 mark 机制:加 '酒/nextKillDamageBonus' 标记,本回合下一张杀+1)
//   - 翻面标签机制:与据守/放逐一致,tag 后缀 '/翻面'。本技能不跳过整回合
//     (与据守加强版一致),仅表示武将牌背面朝上。
//   - 自动翻回正面 1:造成伤害 after-hook(target=自己且 amount>0)→ 若有 '/翻面' 标签 →
//     询问是否翻回正面 → 清除所有 '/翻面' 标签。
//   - 自动翻回正面 2:由界落英 在外得累计 ≥ maxHealth 时内联触发询问
//     (requestType='酒诗/flipBack',共享 '酒诗/flipChoice' localVars)。
//   - "落英牌无距离限制且不能被响应":引擎中落英只获取牌,不"使用",无可观察行为。
//     本实现加 '酒诗/背面' 标签为概念占位(同 'X/翻面' 同义),不改变行为。
//
// 关键点:
//   - 视为使用酒:通过 mark '酒/nextKillDamageBonus'(scope=-1,duration='turn'),
//     与 酒.ts 一致;造成伤害 before-hook 消费 mark 增伤(由 酒.ts 自身 hook 实现)。
//   - 武将牌朝向:tags.some(t => t.endsWith('/翻面'))
//   - 受到伤害"后":after-hook 挂 造成伤害(target=自己)。
//   - 翻回询问:prompt.type='confirm',默认 false(玩家可选)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import {
  registerAction,
  registerAfterHook,
  hasBlockingPending,
  type SkillModule,
} from '../skill';
import { runUseFlow } from '../card-effect/use-card';

const SKILL_ID = '界酒诗';
const DISPLAY_NAME = '酒诗';
/** 翻面标签:加=背面朝上,清除=翻回正面。 */
const FLIP_TAG = '酒诗/翻面';
const USE_RT_CONFIRM = '酒诗/confirm';
const USE_CONFIRM_KEY = '酒诗/useConfirmed';
const DAMAGE_FLIP_RT = '酒诗/damageFlip';
const DAMAGE_FLIP_KEY = '酒诗/damageFlipChoice';
/** 共享给界落英 的翻回询问 localVars 键 */
export const FLIP_BACK_RT = '酒诗/flipBack';
export const FLIP_BACK_KEY = '酒诗/flipChoice';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '翻面视为使用酒;背面朝上时落英牌增强;受伤后或回合外累计获X张落英牌后可翻回正面',
  };
}

/** 武将牌是否背面朝上(存在任意 '/翻面' 后缀标签) */
function isFlipped(tags: string[]): boolean {
  return tags.some((t) => t.endsWith('/翻面'));
}

/** 翻回正面:清除所有 '/翻面' 后缀标签 */
async function flipBackToFaceUp(state: GameState, ownerId: number): Promise<void> {
  const tags = state.players[ownerId]?.tags ?? [];
  const flipTags = tags.filter((t) => t.endsWith('/翻面'));
  for (const tag of flipTags) {
    await applyAtom(state, { type: '去标签', player: ownerId, tag });
  }
}

/** 视为使用一张【酒】:走 runUseFlow virtual（resolve=加增伤标记） */
async function virtualWine(state: GameState, source: number): Promise<void> {
  const cardId = `${SKILL_ID}:酒:${source}:${state.seq}`;
  state.cardMap[cardId] = { id: cardId, name: '酒', suit: '', color: '无色', rank: 'A', type: '基本牌' };
  await runUseFlow(state, source, cardId, [], '酒', { virtual: true });
  delete state.cardMap[cardId];
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── use:主动发动界酒诗(翻至背面 + 视为酒) ──────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, _params: Record<string, Json>) => {
      const myTurn = st.currentPlayerIndex === ownerId;
      const inPlayPhase = st.phase === '出牌';
      const free = !hasBlockingPending(st);
      const self = st.players[ownerId];
      const selfAlive = self?.alive === true;
      // 仅正面朝上时可发动(描述:"翻至背面")
      const faceUp = !isFlipped(self?.tags ?? []);
      const ok = myTurn && inPlayPhase && free && selfAlive && faceUp;
      return ok ? null : '现在不能发动酒诗';
    },
    async (st: GameState, _params: Record<string, Json>) => {
      await pushFrame(st, SKILL_ID, ownerId, {});
      try {
        // 1) 翻至背面:加标签(下一回合不会因此跳过——与据守加强版一致)
        await applyAtom(st, { type: '加标签', player: ownerId, tag: FLIP_TAG });
        // 2) 视为使用一张酒:加 mark,本回合下一张杀伤害+1
        await virtualWine(st, ownerId);
      } finally {
        await popFrame(st);
      }
    },
  );

  // ── respond:玩家在 酒诗 各询问下的选择 ──
  // choice 字段统一用于:use 确认 / 受伤翻回 / 落英触发翻回
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s: GameState, _params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (
        rt !== USE_RT_CONFIRM &&
        rt !== DAMAGE_FLIP_RT &&
        rt !== FLIP_BACK_RT
      ) {
        return '当前不是酒诗询问';
      }
      return null;
    },
    async (s: GameState, params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      const rt = (slot?.atom as unknown as { requestType?: string }).requestType;
      const choice = params.choice === true;
      if (rt === USE_RT_CONFIRM) s.localVars[USE_CONFIRM_KEY] = choice;
      else if (rt === DAMAGE_FLIP_RT) s.localVars[DAMAGE_FLIP_KEY] = choice;
      else if (rt === FLIP_BACK_RT) s.localVars[FLIP_BACK_KEY] = choice;
    },
  );

  // ── 造成伤害 after:曹植受伤后,若背面朝上 → 询问是否翻回正面 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '造成伤害') return;
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;

    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    if (!isFlipped(self.tags)) return; // 仅背面朝上时询问翻回

    delete ctx.state.localVars[DAMAGE_FLIP_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: DAMAGE_FLIP_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '酒诗:受到伤害后,是否将武将牌翻至正面?',
        confirmLabel: '翻至正面',
        cancelLabel: '保持背面',
      },
      defaultChoice: false,
      timeout: 10,
    });
    const flip = ctx.state.localVars[DAMAGE_FLIP_KEY] === true;
    delete ctx.state.localVars[DAMAGE_FLIP_KEY];
    if (!flip) return;

    await flipBackToFaceUp(ctx.state, ownerId);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动酒诗?(翻至背面,视为使用一张酒)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
    activeWhen: (ctx) => {
      if (ctx.view.currentPlayerIndex !== ctx.perspectiveIdx) return false;
      if (ctx.view.phase !== '出牌') return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 注:武将牌朝向(tags)未投影到 view,前端无法直接判断已翻面。
      // 后端 use validate 会拒绝已翻面时的发动(返回 '现在不能发动酒诗')。
      return true;
    },
  });
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '酒诗',
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
