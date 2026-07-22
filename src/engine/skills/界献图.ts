// 界献图(界张松·蜀·被动技,OL 界限突破官方逐字):
//   其他角色出牌阶段开始时,你可以摸至多两张牌,然后交给其等量牌。
//   此阶段结束时,若其造成伤害小于你以此法交给其的牌数,你失去1点体力。
//
// 界限突破(相对标献图,标版未实现):
//   1. 标版:其他角色出牌阶段开始时,你可以摸两张牌,然后交给其两张牌。
//      此阶段结束时,若其此阶段未杀死过角色,你失去1点体力。
//   2. 界版:摸"至多两张"(0/1/2 可选),给等量牌;失血条件改为"造成伤害 < 给牌数"
//      (标版条件是"未杀死过角色"——更易触发;界版更宽松,只要造成伤害 ≥ 给牌数即免罚)。
//
// 实现要点:
//   - 触发(摸牌给牌):阶段开始(出牌) after-hook,atom.player!==ownerId(他人出牌阶段)。
//   - 摸牌数 N 的选择:连续两次 confirm("摸2张?"→ 是=2 / 否→ "摸1张?"→ 是=1 / 否=0)。
//   - 给牌:N>0 时,owner 必须从手牌选 N 张给 currentPlayer(useCard min=max=N)。
//     若 owner 手牌 < N(理论罕见),自动给出全部手牌,失血检查按"实际给到数"计。
//   - 给牌数记录:turn.vars[献图/given/<currentPlayer>] = 实际给到 currentPlayer 的牌数。
//   - 伤害统计:造成伤害 after-hook,source===currentPlayer && state.phase==='出牌'
//     → turn.vars[献图/damage/<currentPlayer>] += amount。
//   - 失血检查:阶段结束(出牌) after-hook,atom.player===currentPlayer(他人):
//     读取给牌数 N 与伤害数 D,若 D < N → owner applyAtom(失去体力, target=owner, amount=1)。
//   - 失血用"失去体力"(非伤害,不触发反馈/奸雄/防具等),对应官方"失去1点体力"。
//   - turn.vars 会被 回合结束 atom 自动整体清空,这里仍在失血检查后显式清以保 hook 重入安全。
//
// 命名:文件名/loader key/character skill name 均为 '界献图';内部 Skill.name='献图'。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
  SkillModule,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const SKILL_ID = '界献图';
const DISPLAY_NAME = '献图';

/** turn.vars key 前缀:owner 给 currentPlayer 的牌数 */
const givenKey = (currentPlayer: number) => `${SKILL_ID}/given/${currentPlayer}`;
/** turn.vars key 前缀:currentPlayer 本出牌阶段造成的伤害值 */
const dmgKey = (currentPlayer: number) => `${SKILL_ID}/damage/${currentPlayer}`;

/** localVars key:owner 选定的给牌 cardIds */
const GIVE_CARDS_KEY = `${SKILL_ID}/giveCards`;
/** localVars key:当前要给 N 张(N 用于校验) */
const GIVE_N_VAR = `${SKILL_ID}/giveN`;
/** localVars key:各种 confirm 结果 */
const CONFIRM_KEY = `${SKILL_ID}/confirmed`;

/** requestType 常量 */
const TRIGGER_RT = `${SKILL_ID}/trigger`; // 是否发动
const DRAW2_RT = `${SKILL_ID}/draw2`; // 摸 2 张?
const DRAW1_RT = `${SKILL_ID}/draw1`; // 摸 1 张?
const GIVE_CARDS_RT = `${SKILL_ID}/giveCards`; // 选 N 张给目标

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '其他角色出牌阶段开始时,你可以摸至多两张牌,然后交给其等量牌;此阶段结束时若其造成伤害小于你以此法交给其的牌数,你失去1点体力',
  };
}

function currentRequestType(st: GameState, ownerId: number): string | undefined {
  const slot = st.pendingSlots.get(ownerId);
  if (!slot) return undefined;
  return (slot.atom as { requestType?: string }).requestType;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:按当前 pending requestType 分支 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const rt = currentRequestType(st, ownerId);
      if (!rt) return '当前不需要回应';

      if (rt === TRIGGER_RT || rt === DRAW2_RT || rt === DRAW1_RT) {
        return null; // confirm:接受任意 choice
      }
      if (rt === GIVE_CARDS_RT) {
        const cardIds = params.cardIds as Json[] | undefined;
        const n = (st.localVars[GIVE_N_VAR] as number | undefined) ?? 0;
        if (!Array.isArray(cardIds)) return '需要 cardIds 数组';
        if (cardIds.length !== n) return `需要给出 ${n} 张牌`;
        const set = new Set(cardIds);
        if (set.size !== cardIds.length) return '不能重复';
        const self = st.players[ownerId];
        if (!self) return '玩家不存在';
        if (!cardIds.every((id) => typeof id === 'string' && self.hand.includes(id)))
          return '牌不在手牌中';
        return null;
      }
      return '当前不是献图询问';
    },
    async (st: GameState, params: Record<string, Json>) => {
      const rt = currentRequestType(st, ownerId);
      if (!rt) return;
      if (rt === TRIGGER_RT || rt === DRAW2_RT || rt === DRAW1_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === GIVE_CARDS_RT) {
        const cardIds = params.cardIds as Json[] | undefined;
        st.localVars[GIVE_CARDS_KEY] = Array.isArray(cardIds)
          ? cardIds.filter((id): id is string => typeof id === 'string')
          : [];
      }
    },
  );

  // ── 阶段开始(出牌) after-hook:其他角色出牌阶段开始 → 询问发动 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '出牌') return;
    const currentPlayer = atom.player;
    if (typeof currentPlayer !== 'number') return;
    if (currentPlayer === ownerId) return; // 仅其他角色
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;
    if (!st.players[currentPlayer]?.alive) return;

    // 初始化本回合此 currentPlayer 的统计
    delete st.turn.vars[givenKey(currentPlayer)];
    delete st.turn.vars[dmgKey(currentPlayer)];

    // 1) 是否发动献图(非锁定技,默认不发动)
    delete st.localVars[CONFIRM_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: TRIGGER_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `是否发动献图?(摸至多两张牌,然后交给 ${st.players[currentPlayer]?.name} 等量牌)`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!st.localVars[CONFIRM_KEY]) {
      delete st.localVars[CONFIRM_KEY];
      return;
    }
    delete st.localVars[CONFIRM_KEY];

    await pushFrame(st, SKILL_ID, ownerId, { target: currentPlayer });

    // 2) 选摸几张(至多 2):"摸 2 张?" → 是=2 / 否→ "摸 1 张?" → 是=1 / 否=0
    let drawN = 0;
    delete st.localVars[CONFIRM_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: DRAW2_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '献图:摸几张牌?(确认=2张,取消=少一些)',
        confirmLabel: '摸 2 张',
        cancelLabel: '少一些',
      },
      defaultChoice: true,
      timeout: 15,
    });
    if (st.localVars[CONFIRM_KEY]) {
      drawN = 2;
    } else {
      delete st.localVars[CONFIRM_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: DRAW1_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '献图:摸 1 张牌?(确认=1张,取消=0张/不摸)',
          confirmLabel: '摸 1 张',
          cancelLabel: '不摸',
        },
        defaultChoice: true,
        timeout: 15,
      });
      drawN = st.localVars[CONFIRM_KEY] ? 1 : 0;
    }
    delete st.localVars[CONFIRM_KEY];

    if (drawN === 0) {
      // 不摸也不给,等同不发动(给牌数记 0,后续不触发失血)
      st.turn.vars[givenKey(currentPlayer)] = 0;
      await popFrame(st);
      return;
    }

    // 3) 摸 N 张
    await applyAtom(st, { type: '摸牌', player: ownerId, count: drawN });

    // 中途死亡防御(摸牌不致死,保持一致风格)
    if (!st.players[ownerId]?.alive) {
      st.turn.vars[givenKey(currentPlayer)] = 0;
      await popFrame(st);
      return;
    }

    // 4) 给 currentPlayer 等量(N)张牌(必须从手牌)
    const handCount = st.players[ownerId].hand.length;
    const giveN = Math.min(drawN, handCount);

    if (giveN === 0) {
      // 无牌可给(理论罕见):给牌数记 0
      st.turn.vars[givenKey(currentPlayer)] = 0;
      await popFrame(st);
      return;
    }

    if (giveN === handCount) {
      // 手牌刚好 = giveN:全部给(无可选,跳过弹窗)
      const allCards = [...st.players[ownerId].hand];
      let actuallyGiven = 0;
      for (const cid of allCards) {
        if (!st.players[ownerId].hand.includes(cid)) continue;
        await applyAtom(st, { type: '给予', cardId: cid, from: ownerId, to: currentPlayer });
        actuallyGiven++;
      }
      st.turn.vars[givenKey(currentPlayer)] = actuallyGiven;
      await popFrame(st);
      return;
    }

    // 一般情况:弹窗选 giveN 张
    st.localVars[GIVE_N_VAR] = giveN;
    delete st.localVars[GIVE_CARDS_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: GIVE_CARDS_RT,
      target: ownerId,
      prompt: {
        type: 'useCard',
        title: `献图:选择 ${giveN} 张手牌给予 ${st.players[currentPlayer]?.name}`,
        cardFilter: { min: giveN, max: giveN },
      },
      timeout: 30,
    });
    delete st.localVars[GIVE_N_VAR];
    const rawCards = st.localVars[GIVE_CARDS_KEY] as string[] | undefined;
    delete st.localVars[GIVE_CARDS_KEY];
    const cards = Array.isArray(rawCards) ? rawCards : [];

    // 5) 逐张给予(防御性:逐张校验仍在手牌)
    let actuallyGiven = 0;
    for (const cid of cards) {
      if (!st.players[ownerId].hand.includes(cid)) continue;
      await applyAtom(st, { type: '给予', cardId: cid, from: ownerId, to: currentPlayer });
      actuallyGiven++;
    }
    st.turn.vars[givenKey(currentPlayer)] = actuallyGiven;

    await popFrame(st);
  });

  // ── 造成伤害 after-hook:统计 currentPlayer 出牌阶段造成的伤害 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const st = ctx.state;
    if (st.phase !== '出牌') return;
    const atom = ctx.atom;
    if (typeof atom.source !== 'number') return;
    if ((atom.amount ?? 0) <= 0) return;
    // 必须是当前回合角色造成的伤害
    if (atom.source !== st.currentPlayerIndex) return;
    // 仅当 owner 已对本回合 currentPlayer 发动过献图(存在 given 记录)才统计
    const given = st.turn.vars[givenKey(st.currentPlayerIndex)] as number | undefined;
    if (typeof given !== 'number') return;
    const cur = (st.turn.vars[dmgKey(st.currentPlayerIndex)] as number | undefined) ?? 0;
    st.turn.vars[dmgKey(st.currentPlayerIndex)] = cur + (atom.amount ?? 0);
  });

  // ── 阶段结束(出牌) after-hook:失血检查 ──
  registerAfterHook(state, skill.id, ownerId, '阶段结束', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段结束') return;
    if (atom.phase !== '出牌') return;
    const currentPlayer = atom.player;
    if (typeof currentPlayer !== 'number') return;
    if (currentPlayer === ownerId) return; // 仅其他角色
    const st = ctx.state;
    if (!st.players[ownerId]?.alive) return;

    const given = st.turn.vars[givenKey(currentPlayer)] as number | undefined;
    const damage = (st.turn.vars[dmgKey(currentPlayer)] as number | undefined) ?? 0;
    // 清理(本阶段判定完毕;turn.vars 整体也会被 回合结束 清空)
    delete st.turn.vars[givenKey(currentPlayer)];
    delete st.turn.vars[dmgKey(currentPlayer)];

    if (typeof given !== 'number' || given <= 0) return; // 未发动或给 0 张
    if (damage >= given) return; // 伤害达标,不失血

    // 失去 1 点体力(非伤害,不触发反馈/奸雄/防具等)
    await applyAtom(st, { type: '失去体力', target: ownerId, amount: 1 });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动献图?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
