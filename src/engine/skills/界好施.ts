// 界好施(界鲁肃·吴·界限突破):摸牌阶段，你可以多摸两张牌，
//   然后若你的手牌数大于5，你将一半的手牌（向下取整）交给手牌最少的一名其他角色，
//   然后直到你的下回合开始，当你成为【杀】或普通锦囊牌的目标后，
//   其可以交给你一张手牌。
//
// 官方文本(hero/485 逐字):
//   "摸牌阶段，你可以多摸两张牌，然后若你的手牌数大于5，
//    你将一半的手牌（向下取整）交给手牌最少的一名其他角色，
//    然后直到你的下回合开始，当你成为【杀】或普通锦囊牌的目标后，
//    其可以交给你一张手牌。"
//
// 与标好施差异:多一个跨回合持续被动(给牌后→鲁肃下回合开始前→
//   鲁肃被杀/普通锦囊指定时→收到好施牌的角色可交鲁肃1张手牌)。
//
// 实现:
//   A. 摸牌逻辑(镜像标好施):before hook +2张 / after hook >5分半给最少者。
//   B. 被动追踪:给牌后记 localVars[受益者/被动激活];回合开始 after hook 清。
//   C. 被动触发:
//      - 杀: 成为目标 after hook(atom.target===owner 且卡是杀)
//      - 普通锦囊: 请求回应 before hook(cancelTarget===owner 且卡非延时锦囊)
//        ——全体/单目标锦囊在结算前均经 询问无懈可击(cancelTarget=目标座次)。
//   D. respond 注册到每个座次:鲁肃处理 confirm/target/give;其他座次处理 passiveGive。
//
// 命名:文件名/loader key/character name = '界好施'(避标版冲突);
//   内部 Skill.name = '好施'(OL 官方技能名)。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameView,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom, topFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn } from '../once-per-turn';
import { isDelayedTrick } from '../card-meta';
import {
  registerAction,
  registerBeforeHook,
  registerAfterHook,
  type SkillModule,
} from '../skill';

// ── 摸牌逻辑常量(镜像标好施)──
const CONFIRM_RT = '界好施/confirm';
const CHOOSE_TARGET_RT = '界好施/target';
const GIVE_RT = '界好施/give';
const CONFIRMED_KEY = '界好施/confirmed';
const ACTIVE_KEY = '界好施/active';
const TARGET_KEY = '界好施/chosenTarget';
const GIVE_KEY = '界好施/giveCards';

// ── 被动逻辑常量 ──
const PASSIVE_GIVE_RT = '界好施/passiveGive';
const PASSIVE_CARD_KEY = '界好施/passiveCard';
const PASSIVE_ACTIVE_KEY = '界好施/被动激活';
const RECIPIENT_KEY = '界好施/受益者';
const PASSIVE_PROCESSED_PREFIX = '界好施/被动已触发/';

const DISPLAY_NAME = '好施';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '摸牌阶段多摸两张,手牌>5时分半给最少者;给牌后直到下回合开始,成为杀/普通锦囊目标时其可给你一张牌',
  };
}

/** 触发被动:询问受益者是否交给鲁肃一张手牌 */
async function triggerPassiveGive(
  state: GameState,
  owner: number,
  recipient: number,
): Promise<void> {
  delete state.localVars[PASSIVE_CARD_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: PASSIVE_GIVE_RT,
    target: recipient,
    prompt: {
      type: 'useCard',
      title: `好施:是否交给${state.players[owner].name}一张手牌?(可不打=不交)`,
      cardFilter: { filter: () => true, min: 1, max: 1 },
    },
    timeout: 15,
  });
  const cardId = state.localVars[PASSIVE_CARD_KEY] as string | undefined;
  delete state.localVars[PASSIVE_CARD_KEY];
  if (cardId && state.players[recipient]?.hand.includes(cardId)) {
    await applyAtom(state, { type: '给予', cardId, from: recipient, to: owner });
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── respond action:注册到每个座次 ──
  // 鲁肃(ownerId)处理 confirm/target/give;其他座次处理 passiveGive
  for (const pl of state.players) {
    const seat = pl.index;
    unloaders.push(
      registerAction(
        state,
        skill.id,
        seat,
        'respond',
        (st: GameState, _params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(seat);
          if (!slot) return '当前不需要回应';
          const atom = slot.atom as Record<string, unknown>;
          if (atom['type'] !== '请求回应') return '当前不需要回应';
          const rt = atom['requestType'] as string;
          if (!rt?.startsWith('界好施/')) return '当前不是界好施询问';
          return null;
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          const slot = st.pendingSlots.get(seat);
          const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
          if (rt === CONFIRM_RT) {
            st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
          } else if (rt === CHOOSE_TARGET_RT) {
            const t =
              (params.targets as number[] | undefined)?.[0] ??
              (typeof params.target === 'number' ? params.target : undefined);
            if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
          } else if (rt === GIVE_RT) {
            const ids = params.cardIds as string[] | undefined;
            if (Array.isArray(ids)) st.localVars[GIVE_KEY] = ids;
          } else if (rt === PASSIVE_GIVE_RT) {
            const ids = params.cardIds as string[] | undefined;
            if (Array.isArray(ids) && ids.length > 0) st.localVars[PASSIVE_CARD_KEY] = ids[0];
          }
        },
      ),
    );
  }

  // ── 摸牌 before hook:摸牌阶段询问,发动则额外摸两张 ──
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '摸牌',
      async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
        const atom = ctx.atom as { player?: number; count?: number };
        if (atom.player !== ownerId) return;
        if (ctx.state.currentPlayerIndex !== ownerId) return;
        if (ctx.state.phase !== '摸牌') return;
        const self = ctx.state.players[ownerId];
        if (!self?.alive) return;
        if (usedThisTurn(ctx.state, ownerId, '界好施')) return;

        delete ctx.state.localVars[CONFIRMED_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: CONFIRM_RT,
          target: ownerId,
          prompt: {
            type: 'confirm',
            title: '是否发动好施?(额外摸两张牌)',
            confirmLabel: '发动',
            cancelLabel: '不发动',
          },
          defaultChoice: false,
          timeout: 15,
        });
        if (!ctx.state.localVars[CONFIRMED_KEY]) return;

        await markOncePerTurn(ctx.state, ownerId, '界好施');
        ctx.state.localVars[ACTIVE_KEY] = true;

        const count = atom.count ?? 2;
        return { kind: 'modify', atom: { ...ctx.atom, count: count + 2 } as typeof ctx.atom };
      },
    ),
  );

  // ── 摸牌 after hook:若手牌 > 5,给牌给手牌最少的角色 + 激活被动 ──
  unloaders.push(
    registerAfterHook(
      state,
      skill.id,
      ownerId,
      '摸牌',
      async (ctx: AtomAfterContext): Promise<void> => {
        const atom = ctx.atom as { player?: number };
        if (atom.player !== ownerId) return;
        if (!ctx.state.localVars[ACTIVE_KEY]) return;
        delete ctx.state.localVars[ACTIVE_KEY];

        const st = ctx.state;
        const self = st.players[ownerId];
        if (!self?.alive) return;
        const handCount = self.hand.length;
        if (handCount <= 5) return;

        const giveCount = Math.floor(handCount / 2);

        let minCount = Infinity;
        const candidates: number[] = [];
        for (const p of st.players) {
          if (p.index === ownerId || !p.alive) continue;
          if (p.hand.length < minCount) {
            minCount = p.hand.length;
            candidates.length = 0;
            candidates.push(p.index);
          } else if (p.hand.length === minCount) {
            candidates.push(p.index);
          }
        }
        if (candidates.length === 0) return;

        let target: number;
        if (candidates.length === 1) {
          target = candidates[0];
        } else {
          delete st.localVars[TARGET_KEY];
          await applyAtom(st, {
            type: '请求回应',
            requestType: CHOOSE_TARGET_RT,
            target: ownerId,
            prompt: {
              type: 'choosePlayer',
              title: '好施:选择手牌最少的角色(给予手牌)',
              min: 1,
              max: 1,
              filter: (_view: GameView, t: number) => candidates.includes(t),
            },
            timeout: 15,
          });
          const chosen = st.localVars[TARGET_KEY] as number | undefined;
          delete st.localVars[TARGET_KEY];
          if (typeof chosen !== 'number') return;
          target = chosen;
        }

        delete st.localVars[GIVE_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: GIVE_RT,
          target: ownerId,
          prompt: {
            type: 'useCard',
            title: `好施:选择 ${giveCount} 张牌交给 ${st.players[target].name}`,
            cardFilter: { filter: () => true, min: giveCount, max: giveCount },
          },
          timeout: 30,
        });
        const giveCards = st.localVars[GIVE_KEY] as string[] | undefined;
        delete st.localVars[GIVE_KEY];
        if (giveCards && giveCards.length > 0) {
          for (const cardId of giveCards) {
            await applyAtom(st, { type: '给予', cardId, from: ownerId, to: target });
          }
          // ★ 界版新增:激活跨回合被动(直到鲁肃下回合开始)
          st.localVars[PASSIVE_ACTIVE_KEY] = true;
          st.localVars[RECIPIENT_KEY] = target;
        }
      },
    ),
  );

  // ── 回合开始 after hook:鲁肃下回合开始时清除被动 ──
  unloaders.push(
    registerAfterHook(
      state,
      skill.id,
      ownerId,
      '回合开始',
      async (ctx: AtomAfterContext): Promise<void> => {
        const atom = ctx.atom as { player?: number };
        if (atom.player !== ownerId) return;
        delete ctx.state.localVars[PASSIVE_ACTIVE_KEY];
        delete ctx.state.localVars[RECIPIENT_KEY];
      },
    ),
  );

  // ── 成为目标 after hook:鲁肃被杀指定时,触发被动 ──
  unloaders.push(
    registerAfterHook(
      state,
      skill.id,
      ownerId,
      '成为目标',
      async (ctx: AtomAfterContext): Promise<void> => {
        const atom = ctx.atom as { target?: number; cardId?: string };
        if (atom.target !== ownerId) return;
        const st = ctx.state;
        if (!st.localVars[PASSIVE_ACTIVE_KEY]) return;
        const recipient = st.localVars[RECIPIENT_KEY] as number | undefined;
        if (typeof recipient !== 'number') return;
        if (!st.players[recipient]?.alive) return;
        if (st.players[recipient].hand.length === 0) return;

        // 仅杀触发(普通锦囊由请求回应 before hook 处理)
        const cardId = atom.cardId;
        if (!cardId) return;
        const card = st.cardMap[cardId];
        if (!card?.name.includes('杀')) return;

        // 防重入:同一张杀只触发一次
        const processedKey = `${PASSIVE_PROCESSED_PREFIX}${cardId}`;
        if (st.localVars[processedKey]) return;
        st.localVars[processedKey] = true;

        await triggerPassiveGive(st, ownerId, recipient);
      },
    ),
  );

  // ── 请求回应 before hook:鲁肃被普通锦囊指定时,触发被动 ──
  // 全体/单目标普通锦囊在结算前均经 询问无懈可击(cancelTarget=目标座次)。
  // 鲁肃为 cancelTarget 时 = 鲁肃是该锦囊的目标。
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '请求回应',
      async (ctx: AtomBeforeContext): Promise<void> => {
        const atom = ctx.atom as { requestType?: string; cancelTarget?: number };
        if (atom.requestType !== '无懈可击') return;
        if (atom.cancelTarget !== ownerId) return;

        const st = ctx.state;
        if (!st.localVars[PASSIVE_ACTIVE_KEY]) return;
        const recipient = st.localVars[RECIPIENT_KEY] as number | undefined;
        if (typeof recipient !== 'number') return;
        if (!st.players[recipient]?.alive) return;
        if (st.players[recipient].hand.length === 0) return;

        const frame = topFrame(st);
        if (!frame) return;
        const cardId = frame.params?.cardId as string | undefined;
        if (!cardId) return;
        const card = st.cardMap[cardId];
        if (!card) return;
        // 排除延时锦囊(被动仅对普通锦囊触发)
        if (isDelayedTrick(card)) return;

        // 防重入:同一张锦囊只触发一次
        const processedKey = `${PASSIVE_PROCESSED_PREFIX}${cardId}`;
        if (st.localVars[processedKey]) return;
        st.localVars[processedKey] = true;

        await triggerPassiveGive(st, ownerId, recipient);
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
