// 界求援(界伏皇后·群·被动技,OL 界限突破官方逐字):
//   当你成为【杀】或伤害锦囊的目标时，你可以令另一名其他角色选择一项：
//   1.交给你一张与此牌同类型不同牌名的牌；
//   2.成为此牌的额外目标。
//
// 与标版求援差异(标版未实现;基于官方描述对比):
//   - 标版:"当你成为【杀】的目标时,令另一名其他角色选择一项:1.交给你一张【闪】;
//     2.成为此【杀】的额外目标。"——仅杀触发,选项1固定要闪。
//   - 界版:【杀】或【伤害锦囊】触发;选项1要"同类型不同牌名"的牌。
//   两版触发条件与给牌条件都不同,界版必须独立文件。
//
// 实现要点:
//   - 触发: 成为目标 after-hook(atom.target === ownerId 且卡为杀/决斗)
//     —— 杀 与 决斗(runUseFlow virtual 模式)都走 成为目标 atom,挂此一处即可覆盖。
//     AOE(南蛮/万箭)与火攻不走 成为目标,需挂 请求回应 before-hook(无懈可击窗口)。
//     本实现同时挂两处 hook,完整覆盖杀/决斗/AOE/火攻。
//   - 防重入:同一张卡只触发一次(PROCESSED_PREFIX + cardId)。
//   - 询问链:
//       1) confirm: owner 是否发动求援?
//       2) choosePlayer: owner 选一名其他角色(除 owner 与 source 之外)
//       3) confirm: 该角色 选 1(给牌) 或 2(成为额外目标)
//       4a) 给牌:该角色 选一张同类型不同牌名的牌 → 给予 owner
//           若该角色无符合牌,自动转为 4b(成为额外目标)。
//       4b) 成为额外目标:虚拟杀(source → 该角色)。
//
//   - "成为额外目标"实现:用虚拟杀完整结算(指定目标→成为目标→检测有效性→询问闪→伤害/抵消)。
//     镜像界仁德/界诛害的 virtualKill;不修改 杀 skill 文件。
//     AOE/火攻情形下"额外目标"语义弱化(AOE 已全员命中),虚拟杀仍能给该角色一次额外杀。
//
// 命名:文件名/loader key/character skill name = '界求援'(避标版冲突);
//   内部 Skill.name = '求援'(OL 官方技能名,玩家可见)。
import type {
  Card,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { runUseFlow } from '../card-effect/use-card';
import {
  registerAction,
  registerAfterHook,
  registerBeforeHook,
  type SkillModule,
} from '../skill';

const SKILL_ID = '界求援';
const DISPLAY_NAME = '求援';

/** 询问 RT:owner 是否发动(confirm) */
const CONFIRM_RT = `${SKILL_ID}/confirm`;
/** 询问 RT:owner 选目标角色(choosePlayer) */
const CHOOSE_TARGET_RT = `${SKILL_ID}/chooseTarget`;
/** 询问 RT:helper 选 1/2 选项(confirm) */
const OPTION_RT = `${SKILL_ID}/option`;
/** 询问 RT:helper 选一张同类型不同牌名的牌(useCard) */
const GIVE_CARD_RT = `${SKILL_ID}/giveCard`;

const CONFIRM_KEY = `${SKILL_ID}/confirmed`;
const TARGET_KEY = `${SKILL_ID}/target`;
const OPTION_KEY = `${SKILL_ID}/option`;
const CARD_KEY = `${SKILL_ID}/cardId`;
/** 防同一张卡重复触发 */
const PROCESSED_PREFIX = `${SKILL_ID}/processed/`;

/** 伤害锦囊名集合(参考 界贞烈/界好施 的伤害锦囊判定) */
const DAMAGE_TRICK_NAMES = new Set(['决斗', '南蛮入侵', '万箭齐发', '火攻']);

/** 是否为杀或伤害锦囊(求援触发条件) */
function isKillOrDamageTrick(card: Card | undefined): boolean {
  if (!card) return false;
  if (card.name === '杀') return true;
  return DAMAGE_TRICK_NAMES.has(card.name);
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '当你成为杀或伤害锦囊的目标时,可令另一名其他角色选一项:1.交给你一张同类型不同牌名的牌;2.成为此牌的额外目标',
  };
}

/** 虚拟杀结算(参考界仁德/界诛害):source → target,无实体卡,不计入出杀次数。 */
async function virtualKill(state: GameState, source: number, target: number): Promise<void> {
  if (!state.players[target]?.alive) return;
  const cardId = `${SKILL_ID}:杀:${source}:${target}:${state.seq}`;
  state.cardMap[cardId] = {
    id: cardId,
    name: '杀',
    suit: '',
    color: '无色',
    rank: 'A',
    type: '基本牌',
  };
  await runUseFlow(state, source, cardId, [target], '杀', { virtual: true });
  delete state.cardMap[cardId];
}

/**
 * 求援主流程:owner 被指定为 cardId 的目标后,询问 owner + helper 执行选项。
 * cardId 必须为杀或伤害锦囊;source 为该牌使用者。
 */
async function runQiuYuan(
  state: GameState,
  ownerId: number,
  source: number,
  cardId: string,
): Promise<void> {
  const self = state.players[ownerId];
  if (!self?.alive) return;
  const card = state.cardMap[cardId];
  if (!card) return;

  // 候选:除 owner 和 source 之外的存活玩家
  const candidates = state.players
    .filter((p) => p.alive && p.index !== ownerId && p.index !== source)
    .map((p) => p.index);
  if (candidates.length === 0) return;

  // 1) confirm:是否发动
  delete state.localVars[CONFIRM_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CONFIRM_RT,
    target: ownerId,
    prompt: {
      type: 'confirm',
      title: `求援:是否发动?(被 ${card.name} 指定)`,
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
    defaultChoice: false,
    timeout: 15,
  });
  if (!state.localVars[CONFIRM_KEY]) return;
  delete state.localVars[CONFIRM_KEY];

  // 2) chooseTarget:选一名其他角色
  delete state.localVars[TARGET_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: CHOOSE_TARGET_RT,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: '求援:选择一名其他角色',
      min: 1,
      max: 1,
      filter: (_view, idx) =>
        idx !== ownerId && idx !== source && state.players[idx]?.alive === true,
    },
    timeout: 15,
  });
  const helperIdx = state.localVars[TARGET_KEY] as number | undefined;
  delete state.localVars[TARGET_KEY];
  if (typeof helperIdx !== 'number') return;
  if (!state.players[helperIdx]?.alive) return;
  if (helperIdx === ownerId || helperIdx === source) return;

  // 3) helper 选 1(给牌) 或 2(成为额外目标)
  delete state.localVars[OPTION_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: OPTION_RT,
    target: helperIdx,
    prompt: {
      type: 'confirm',
      title: `求援:1.交给 ${self.name} 一张同类型不同牌名的牌  2.成为此牌的额外目标`,
      confirmLabel: '给牌',
      cancelLabel: '成为额外目标',
    },
    defaultChoice: false,
    timeout: 15,
  });
  const option = state.localVars[OPTION_KEY] as number | undefined;
  delete state.localVars[OPTION_KEY];
  // choice=true → option=1(给牌);choice=false/超时 → option=2(额外目标)
  const choseGive = option === 1;

  if (choseGive) {
    // 4a) 给牌:helper 选一张同类型不同牌名的牌
    const matching = state.players[helperIdx].hand.filter((id) => {
      const c = state.cardMap[id];
      return c && c.type === card.type && c.name !== card.name;
    });
    if (matching.length === 0) {
      // 无符合牌:自动转为 4b(成为额外目标)
      await virtualKill(state, source, helperIdx);
      return;
    }
    delete state.localVars[CARD_KEY];
    await applyAtom(state, {
      type: '请求回应',
      requestType: GIVE_CARD_RT,
      target: helperIdx,
      prompt: {
        type: 'useCard',
        title: `求援:交给 ${self.name} 一张同类型不同牌名的牌`,
        cardFilter: {
          filter: (c) => c.type === card.type && c.name !== card.name,
          min: 1,
          max: 1,
        },
      },
      timeout: 20,
    });
    let giveCardId = state.localVars[CARD_KEY] as string | undefined;
    delete state.localVars[CARD_KEY];
    if (!giveCardId || !state.players[helperIdx]?.hand.includes(giveCardId)) {
      giveCardId = matching[0]; // 超时兜底:给第一张符合牌
    }
    await applyAtom(state, {
      type: '给予',
      cardId: giveCardId,
      from: helperIdx,
      to: ownerId,
    });
  } else {
    // 4b) 成为额外目标:虚拟杀(source → helper)
    await virtualKill(state, source, helperIdx);
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── respond:owner 处理 confirm/chooseTarget ──
  unloaders.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(ownerId);
        if (!slot || slot.atom.type !== '请求回应') return '当前不需要回应';
        const rt = (slot.atom as unknown as { requestType?: string }).requestType;
        if (rt === CONFIRM_RT) return null;
        if (rt === CHOOSE_TARGET_RT) {
          if (typeof params.target !== 'number') return '请选择一名角色';
          return null;
        }
        return '当前不是求援询问';
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(ownerId);
        const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
        if (rt === CONFIRM_RT) {
          st.localVars[CONFIRM_KEY] = params.choice === true;
        } else if (rt === CHOOSE_TARGET_RT) {
          st.localVars[TARGET_KEY] = params.target;
        }
      },
    ),
  );

  // ── respond:helper 座次处理 option + giveCard ──
  // 为所有非 owner 座次注册(helper 可能是任意玩家)。
  for (const p of state.players) {
    if (p.index === ownerId) continue;
    const pid = p.index;
    unloaders.push(
      registerAction(
        state,
        skill.id,
        pid,
        'respond',
        (st: GameState, params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(pid);
          if (!slot || slot.atom.type !== '请求回应') return '当前不需要回应';
          const rt = (slot.atom as unknown as { requestType?: string }).requestType;
          if (rt === OPTION_RT) return null; // 选项 confirm
          if (rt === GIVE_CARD_RT) {
            const cardId = params.cardId as string | undefined;
            if (typeof cardId !== 'string') return '请选择一张牌';
            if (!st.players[pid]?.hand.includes(cardId)) return '牌不在你的手牌中';
            return null;
          }
          return '当前不是求援询问';
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          const slot = st.pendingSlots.get(pid);
          const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
          if (rt === OPTION_RT) {
            // choice=true → option=1(给牌);choice=false → option=2(额外目标)
            st.localVars[OPTION_KEY] = params.choice === true ? 1 : 2;
          } else if (rt === GIVE_CARD_RT) {
            st.localVars[CARD_KEY] = params.cardId;
          }
        },
      ),
    );
  }

  // ── 成为目标 after-hook:owner 被杀/决斗 指定时触发 ──
  unloaders.push(
    registerAfterHook(
      state,
      skill.id,
      ownerId,
      '成为目标',
      async (ctx): Promise<void> => {
        const atom = ctx.atom;
        if (atom.target !== ownerId) return;
        const st = ctx.state;
        const cardId = atom.cardId;
        if (!cardId) return;
        const card = st.cardMap[cardId];
        if (!isKillOrDamageTrick(card)) return;
        const source = atom.source;
        if (typeof source !== 'number') return;

        // 防重入:同一张卡只触发一次
        const processedKey = `${PROCESSED_PREFIX}${cardId}`;
        if (st.localVars[processedKey]) return;
        st.localVars[processedKey] = true;

        await runQiuYuan(st, ownerId, source, cardId);
      },
    ),
  );

  // ── 请求回应 before-hook:owner 被 AOE/火攻/决斗(无懈窗口)指定时触发 ──
  // AOE(南蛮/万箭)与火攻不走 成为目标 atom,只在 询问无懈可击 开 cancelTarget=目标 的窗口。
  // 决斗虽走 成为目标,但也开无懈窗口;PROCESSED_PREFIX 防重复触发。
  // 单目标伤害锦囊(火攻)cancelTarget=ownerId 时触发。
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '请求回应',
      async (ctx): Promise<void> => {
        const atom = ctx.atom;
        if (atom.requestType !== '无懈可击') return;
        if (atom.cancelTarget !== ownerId) return;
        const st = ctx.state;
        const frame = topFrame(st);
        if (!frame) return;
        const cardId = frame.params?.cardId as string | undefined;
        if (!cardId) return;
        const card = st.cardMap[cardId];
        if (!isKillOrDamageTrick(card)) return;
        // 杀 走 成为目标,此处只补 AOE/火攻(无 成为目标 atom 的伤害锦囊);杀/决斗由 after-hook 处理
        if (card.name === '杀' || card.name === '决斗') return;

        // 防重入:同一张卡只触发一次
        const processedKey = `${PROCESSED_PREFIX}${cardId}`;
        if (st.localVars[processedKey]) return;
        st.localVars[processedKey] = true;

        const source = frame.from;
        await runQiuYuan(st, ownerId, source, cardId);
      },
    ),
  );

  return () => unloaders.forEach((fn) => fn());
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: DISPLAY_NAME,
      confirmLabel: '确认',
      cancelLabel: '取消',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
