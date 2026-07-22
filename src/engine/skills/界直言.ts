// 界直言(界虞翻·主动技·OL hero/603 官方逐字):
//   你上家或你的结束阶段,你可以令一名角色摸一张牌并展示之,
//   若为装备牌,其使用之并回复1点体力。若为非装备牌且其体力值不等于你,其失去1点体力。
//
// 界限突破(相对标版 src/engine/skills/直言.ts,标版未实现):
//   标版:"结束阶段,你可以令一名角色摸一张牌并展示之,若为装备牌,其使用之并回复1点体力。"
//   界版差异:① 触发时机从"你的结束阶段"扩展为"你上家或你的结束阶段";
//             ② 非装备牌分支新增"若其体力值不等于你,其失去1点体力"。
//
// 触发时机:阶段开始(回合结束) after-hook —— phasePlayer === ownerId
//           或 phasePlayer === 上家(ownerId 的前一存活玩家)。
//   阶段顺序:准备→判定→摸牌→出牌→弃牌→回合结束;「回合结束」阶段即"结束阶段"。
//
// 流程:
//   1. 询问是否发动直言(confirm)
//   2. 选目标(任意存活角色,含自己)
//   3. 目标摸1张牌 → 拿到刚摸的牌(hand 末尾)
//   4. 展示该牌(全员可见)
//   5. 装备牌:装备到对应栏位(替换旧装备) + 回复1点体力(已满则无效)
//      非装备牌:若目标体力 ≠ 虞翻体力 → 目标失去1点体力
//
// 关键点:
//   - 装备替换逻辑复制自「装备通用」/「据守」:先 卸下+弃置 旧装备,再 装备 新装备;
//     若装备牌自带技能(以 card.name 作 skillId),手动 移除技能/添加技能。
//   - "上家"= findNextAlive(state, candidate) === ownerId 的 candidate。
//   - 摸牌的牌=目标手牌末尾(摸牌 atom 用 push 追加)。
//   - 装备自带技能加载:applyAtom(装备) 不会自动加载技能——需要手动 添加技能,
//     与「装备通用」一致(装备通用 是 use action 的实现,绕过它直接 applyAtom(装备) 时需手动管理)。
import type {
  AtomAfterContext,
  EquipSlot,
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';
import { skillLoaders } from './index';

const SKILL_ID = '界直言';
const DISPLAY_NAME = '直言';
const CONFIRM_RT = '界直言/confirm';
const TARGET_RT = '界直言/target';
const CONFIRM_KEY = '界直言/confirmed';
const TARGET_KEY = '界直言/target';

/** 从 fromIndex 之后找下一个存活玩家索引;全死亡时返回 fromIndex */
function findNextAlive(state: { players: { alive: boolean }[] }, fromIndex: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    if (state.players[idx]?.alive) return idx;
  }
  return fromIndex;
}

/** candidate 是否为 target 的上家(下一个存活玩家 === target) */
function isUpstreamOf(state: GameState, candidate: number, target: number): boolean {
  if (candidate === target) return false;
  return findNextAlive(state, candidate) === target;
}

/** 装备牌 subtype → 装备栏位(与 装备 atom 的 inferSlot 一致) */
function slotOf(card: { subtype?: string } | undefined): EquipSlot | null {
  switch (card?.subtype) {
    case '武器':
      return '武器';
    case '防具':
      return '防具';
    case '进攻马':
      return '进攻马';
    case '防御马':
      return '防御马';
    case '宝物':
      return '宝物';
    default:
      return null;
  }
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '你上家或你的结束阶段,你可令一名角色摸一张牌并展示之;装备牌:其使用之并回复1点体力;非装备且其体力不等于你:其失去1点体力',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 阶段开始(回合结束) after-hook:phasePlayer 是自己或上家 ──
  registerAfterHook(state, skill.id, ownerId, '阶段开始', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; player?: number; phase?: string };
    if (atom.type !== '阶段开始') return;
    if (atom.phase !== '回合结束') return;
    const st = ctx.state;
    const phasePlayer = atom.player ?? -1;
    if (phasePlayer < 0) return;

    const isSelf = phasePlayer === ownerId;
    const isUpstream = isUpstreamOf(st, phasePlayer, ownerId);
    if (!isSelf && !isUpstream) return;

    const self = st.players[ownerId];
    if (!self?.alive) return; // 虞翻须存活

    // ── 第一步:是否发动直言 ──
    delete st.localVars[CONFIRM_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `是否发动直言?(${isSelf ? '你的' : '上家的'}结束阶段)`,
        description:
          '令一名角色摸一张牌并展示之:装备牌→其使用之并回复1点体力;非装备牌且其体力不等于你→其失去1点体力',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (st.localVars[CONFIRM_KEY] !== true) {
      delete st.localVars[CONFIRM_KEY];
      return;
    }
    delete st.localVars[CONFIRM_KEY];

    // ── 第二步:选目标(任意存活角色,含自己)──
    delete st.localVars[TARGET_KEY];
    await applyAtom(st, {
      type: '请求回应',
      requestType: TARGET_RT,
      target: ownerId,
      prompt: {
        type: 'choosePlayer',
        title: '直言:选择一名角色摸一张牌并展示之',
        min: 1,
        max: 1,
        filter: (_view, t) => st.players[t]?.alive === true,
      },
      timeout: 30,
    });
    const target = st.localVars[TARGET_KEY] as number | undefined;
    delete st.localVars[TARGET_KEY];
    if (typeof target !== 'number' || !st.players[target]?.alive) return;

    // ── 第三步:目标摸一张牌 ──
    const beforeHandLen = st.players[target].hand.length;
    await applyAtom(st, { type: '摸牌', player: target, count: 1 });
    // 摸到的是手牌末尾(摸牌 atom 用 push 追加)
    if (st.players[target].hand.length <= beforeHandLen) return; // 牌堆无牌(理论上 validate 已拦截)
    const drawnId = st.players[target].hand[st.players[target].hand.length - 1];

    // ── 第四步:展示该牌(全员可见)──
    await applyAtom(st, { type: '展示', player: target, cardId: drawnId });

    // ── 第五步:按类别分支 ──
    const drawnCard = st.cardMap[drawnId];
    const isEquipment = drawnCard?.type === '装备牌';
    if (isEquipment) {
      // 装备牌:其使用之(替换旧装备,逻辑同 装备通用)
      const slot = slotOf(drawnCard);
      if (slot) {
        // 若目标该栏位已有装备,先卸下旧装备并弃置之
        const currentEquip = st.players[target].equipment[slot];
        if (currentEquip) {
          const oldCard = st.cardMap[currentEquip];
          if (oldCard?.name && skillLoaders[oldCard.name]) {
            await applyAtom(st, { type: '移除技能', player: target, skillId: oldCard.name });
          }
          await applyAtom(st, { type: '卸下', player: target, slot });
          await applyAtom(st, {
            type: '移动牌',
            cardId: currentEquip,
            from: { zone: '手牌', player: target },
            to: { zone: '弃牌堆' },
          });
        }
        // 装备新牌
        await applyAtom(st, { type: '装备', player: target, cardId: drawnId });
        if (drawnCard?.name && skillLoaders[drawnCard.name]) {
          await applyAtom(st, {
            type: '添加技能',
            player: target,
            skillId: drawnCard.name,
          });
        }
      }
      // 回复1点体力(若已满则 atom 内部 validate 拦截——这里手动检测避免报错)
      if (st.players[target].health < st.players[target].maxHealth) {
        await applyAtom(st, { type: '回复体力', target, amount: 1 });
      }
    } else {
      // 非装备牌:若其体力值不等于你,其失去1点体力
      const targetHealth = st.players[target].health;
      const myHealth = st.players[ownerId].health;
      if (targetHealth !== myHealth && st.players[target]?.alive) {
        await applyAtom(st, { type: '失去体力', target, amount: 1 });
      }
    }
  });

  // ── respond action:处理 confirm / target 两步回应 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是直言窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType === CONFIRM_RT) {
        return null;
      }
      if (atom.requestType === TARGET_RT) {
        const target = params.target;
        if (typeof target !== 'number') return '需要选择一名角色';
        if (!st.players[target]?.alive) return '目标不合法';
        return null;
      }
      return '当前不是直言窗口';
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === TARGET_RT) {
        const t = params.target;
        if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 直言为阶段触发技(由 阶段开始 hook 被动触发),无主动 action 按钮需要声明
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
