// 界巧说(界简雍·蜀·主动技,OL hero/600 官方逐字):
//   "出牌阶段,你可以拼点:若你赢,你本回合使用的下一张牌可以多指定或少指定一个目标;
//    若你没赢,此技能失效且你不能使用锦囊牌直到回合结束。"
//
// 界限突破(相对标 简雍 巧说):
//   1. 标版触发"出牌阶段开始时";界版改为"出牌阶段"(任意时机,更灵活)。
//   2. 标版没赢仅"本回合不能使用锦囊牌";界版加"此技能失效"(等同禁用,但因每回合限一次,
//      由 usedThisTurn 已经落实)。
//
// 实现要点:
//   - 出牌阶段限一次:player.vars['界巧说/usedThisTurn'](后缀约定,回合结束 atom 自动清空)。
//   - 拼点流程(参考 天义.ts):
//       1) 请求回应(target 选拼点牌)
//       2) runRankCompareFlow(扣置→亮出→后→弃牌堆,两张牌面朝下同时扣置)
//       3) 结算输赢 → 设对应 turn.vars
//   - 赢效果:turn.vars['巧说/winNext'] = owner。语义"下一张牌可多/少指定一个目标":
//     · +1 目标:杀 validate 本不限目标数(参考方天画戟注释),前端据此 tag 放宽多选;
//       单目标锦囊(过河拆桥/顺手牵羊等)的 targetFilter 也可消费此 tag 允许 2 个目标。
//     · -1 目标:语义较窄(对必须指定目标的牌意义有限),引擎层记 tag 表态即可。
//     · "下一张"语义:after-hook 挂「移动牌」—— owner 从手牌打出一张牌到处理区时,
//       清除 winNext(本回合下一张牌的 +/- 目标效果已被消费)。
//   - 没赢效果:turn.vars['巧说/lost'] = owner + 注册 trickBlocker。
//     trickBlocker 是查询型谓词(state-bound,WeakMap 注册表),
//     validateUseCard 在校验普通锦囊 use 时查询;生效后 owner 不能使用任何普通锦囊牌。
//   - 拼点点数:A=1, 2-10=面值, J=11, Q=12, K=13;严格大于才算赢,相等算没赢。
//
// 命名:文件名/loader key/character skill name 均为 '界巧说'(避开标版潜在冲突);
//   内部 Skill.name = '巧说'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
  ZoneLoc,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { runRankCompareFlow } from '../rank-flow';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';
import { registerTrickBlocker } from '../trick-quota';

const SKILL_ID = '界巧说';
const DISPLAY_NAME = '巧说';

const TARGET_CARD_KEY = `${SKILL_ID}/targetCard`;
const PD_RT = `${SKILL_ID}/拼点`;
/** 赢效果标记:owner 本回合下一张牌可 +/-1 目标。 */
const WIN_NEXT_VAR = '巧说/winNext';
/** 没赢效果标记:owner 本回合不能使用普通锦囊牌。 */
const LOST_VAR = '巧说/lost';

/** 拼点牌点数:A=1, 2-10=面值, J=11, Q=12, K=13。 */
function rankValue(rank: string): number {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  const n = parseInt(rank, 10);
  return Number.isFinite(n) ? n : 0;
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '出牌阶段限一次拼点:赢则本回合下一张牌可多/少指定一个目标;没赢则本回合不能使用锦囊牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ─── 没赢效果提供者:trickBlocker(查询型,state-bound 注册表) ───
  // onInit 注册一次,谓词动态读 turn.vars;技能卸载时随 unload 清理。
  const unloadBlocker = registerTrickBlocker(
    state,
    ownerId,
    (st: GameState, player: number) => st.turn.vars[LOST_VAR] === player,
  );

  // ─── use action:owner 主动发动巧说拼点 ────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>): string | null => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (usedThisTurn(st, ownerId, SKILL_ID)) return '本回合已使用过巧说';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      const cardId = params.cardId as string;
      if (typeof cardId !== 'string') return '需要选择一张拼点牌';
      if (!self.hand.includes(cardId)) return '拼点牌不在手牌中';
      const target = params.target as number;
      if (typeof target !== 'number') return '需要选择拼点目标';
      if (target === ownerId) return '不能与自己拼点';
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive) return '目标不存在或已死亡';
      if (targetPlayer.hand.length === 0) return '目标没有手牌,无法拼点';
      return null;
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const from = ownerId;
      const initiatorCardId = params.cardId as string;
      const target = params.target as number;

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(st, from, SKILL_ID);

      await pushFrame(st, SKILL_ID, from, { ...params });

      const initiatorCard = st.cardMap[initiatorCardId];
      const initiatorValue = initiatorCard ? rankValue(initiatorCard.rank) : 0;

      // 1) 询问 target 出拼点牌。拼点牌暂不移入处理区——由 runRankCompareFlow 的
      //    拼点扣置 统一同时扣置(面朝下),对齐 rankcompare.md。
      delete st.localVars[TARGET_CARD_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: PD_RT,
        target,
        prompt: {
          type: 'useCard',
          title: `巧说:与 ${st.players[from].name} 拼点,请出一张手牌`,
          cardFilter: { min: 1, max: 1 },
        },
        timeout: 30,
      });

      const targetCardId = st.localVars[TARGET_CARD_KEY] as string | undefined;
      delete st.localVars[TARGET_CARD_KEY];

      // 2) 拼点两步化(扣置→亮出→后→弃牌堆)。target 未出牌(超时)走兜底。
      let win: boolean;
      if (targetCardId && st.players[target].hand.includes(targetCardId)) {
        const result = await runRankCompareFlow(st, from, target, initiatorCardId, targetCardId);
        win = result === '赢';
      } else {
        // target 未出牌(超时):清理发起方拼点牌(手牌→弃牌堆),按发起方默认胜出(保留旧行为)。
        await applyAtom(st, {
          type: '移动牌',
          cardId: initiatorCardId,
          from: { zone: '手牌', player: from },
          to: { zone: '弃牌堆' },
        });
        win = initiatorValue > 0;
      }

      // 3) 结算输赢:发起方点数严格大于目标 = 赢;否则(输或平)没赢
      if (win) {
        // 赢:下一张牌可 +/-1 目标(由 turn.vars['巧说/winNext'] 驱动;
        // 移动牌 after-hook 在 owner 下张牌打出时清除)
        st.turn.vars[WIN_NEXT_VAR] = from;
        await applyAtom(st, { type: '回合用量', player: from, key: WIN_NEXT_VAR, value: true });
      } else {
        // 没赢:本回合不能使用锦囊牌(由 trickBlocker + validateUseCard 落实)
        st.turn.vars[LOST_VAR] = from;
        await applyAtom(st, { type: '回合用量', player: from, key: LOST_VAR, value: true });
      }

      await popFrame(st);
    },
  );

  // ─── respond action:为所有玩家注册 ────────────────────────
  // target(其他玩家)需要 respond 选拼点牌。默认 respond 只注册在 owner 上,
  // 目标无法 dispatch,故此处为每个玩家注册。validate 严格检查 pending requestType。
  for (const p of state.players) {
    const pid = p.index;
    registerAction(
      state,
      skill.id,
      pid,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as unknown as Record<string, unknown>;
        if (atom.type !== '请求回应') return '当前不需要回应';
        const reqType = atom.requestType as string;
        if (reqType !== PD_RT) return '当前不是巧说回应';
        if ((atom.target as number) !== pid) return '不是问你的';
        const cardId = params.cardId as string;
        if (typeof cardId !== 'string') return '请选择一张拼点牌';
        if (!st.players[pid].hand.includes(cardId)) return '拼点牌不在手牌中';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(pid);
        if (!slot) return;
        const atom = slot.atom as unknown as Record<string, unknown>;
        if (atom.type !== '请求回应' || (atom.requestType as string) !== PD_RT) return;
        st.localVars[TARGET_CARD_KEY] = params.cardId;
      },
    );
  }

  // ─── 清理 winNext:owner 下一张牌打出时消费 ───────────────────
  // 监听 移动牌 from 手牌(owner)→ 处理区:即 owner 出牌/打牌的时机。
  // 巧说自身的拼点牌打出在 winNext 设置之前 → 不会误清。后续任一张牌打出 → 清除标记。
  // 注意:本 hook 注册到 SKILL_ID + ownerId,仅在 owner 持有 巧说 实例时生效。
  registerAfterHook(state, skill.id, ownerId, '移动牌', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '移动牌') return;
    if (atom.from.zone !== '手牌') return;
    if (atom.from.player !== ownerId) return;
    if (atom.to.zone !== '处理区') return;
    // 仅在 winNext 当前生效时清除
    if (ctx.state.turn.vars[WIN_NEXT_VAR] === ownerId) {
      delete ctx.state.turn.vars[WIN_NEXT_VAR];
      await applyAtom(ctx.state, {
        type: '回合用量',
        player: ownerId,
        key: WIN_NEXT_VAR,
        value: false,
      });
    }
  });

  return () => {
    unloadBlocker();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'useCardAndTarget',
      title: '巧说:选择一张拼点牌和一名目标',
      cardFilter: { min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, t) => {
          const me = view.currentPlayerIndex;
          if (t === me) return false;
          const tp = view.players[t];
          if (!tp) return false;
          return tp.alive !== false && (tp.handCount ?? 0) > 0;
        },
      },
    },
    activeWhen: (ctx) =>
      activeUnlessUsedThisTurn(SKILL_ID)(ctx) &&
      (ctx.view.players[ctx.perspectiveIdx]?.hand?.length ?? 0) > 0,
  });

  // respond(拼点牌选择):前端通过 pending prompt 渲染
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'useCard',
      title: '巧说:请出一张拼点牌',
      cardFilter: { min: 1, max: 1 },
    },
  });
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
