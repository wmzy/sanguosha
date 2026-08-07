// 界结姻(界孙尚香·主动技·OL 界限突破版):
//   出牌阶段限一次,你可以选择一名男性角色,弃置一张手牌或将一张装备牌置入其装备区,
//   然后你与其中体力值较大的角色摸一张牌,体力值较小的角色回复1点体力。
//
// OL 界限突破差异(相对标 结姻 src/engine/skills/结姻.ts):
//   1. **目标放宽**:任意男性角色(不要求"已受伤")。孙尚香为女性,性别检查天然排除自身。
//   2. **代价二选一**:弃置一张手牌 或 将一张装备牌置入目标的装备区(可替换原装备)。
//   3. **效果双向比较**:你与目标中体力值较大者摸1张,较小者回复1点体力(双方都参与)。
//      标版仅"双方各回1点",界版改为按体力比较分配。
//   4. 仍为出牌阶段限一次。
//
// 裁定(体力相等,官方未明确):
//   - 体力相等时,既无"较大者"也无"较小者",按字面:双方均不摸牌、不回血(本技能仅消耗代价)。
//     保守且符合描述字面。在测试与发动日志中均如此处理。
//
// 交互流程(单步 distribute/allocate,无弹窗):
//   点「界结姻」按钮直接进入分配面板:
//   1. 选一张牌:手牌区任意牌 或 自己装备区的装备(均金色高亮可选)。
//   2. 点一名男性角色头像定为目标。
//   3. 点「确定」提交 allocation=[{target, cardIds:[cardId]}]。
//   代价由所选牌的【类型】自动判定,无需选代价弹窗:
//   - 装备牌(无论来自手牌还是装备区) → 将其置入目标装备区(代价 B);
//   - 非装备牌(仅手牌) → 弃置该手牌(代价 A)。
//
// 关键点:
//   - 限一次/回合:用 player.vars['界结姻/usedThisTurn'] 标记,回合用量 atom 同步到 view。
//     标记在 execute 开头(use 提交后),玩家不提交(取消分配面板)则不消耗限一次。
//   - 代价 A(弃手牌):弃置所选手牌(任意非装备手牌;装备手牌走代价 B)。
//   - 代价 B(置装备):装备牌置入目标对应栏位;若牌来自 owner 装备区,先卸下(牌回 owner 手牌)
//     再交给目标;目标已有同栏位装备则替换(移除旧技能 → 卸下 → 旧装备入弃牌堆 → 装备新 →
//     添加新技能),替换会触发目标"失去装备"类技能。
//   - 效果比较在代价支付后进行(代价不改变体力,故与发动前等价)。
//   - 回复体力不能超过体力上限:回复体力 atom.apply 已 Math.min 限制,无需技能处理。
//   - distribute prompt 的 source='handAndEquip' 让前端把手牌+装备区都纳入候选;
//     filter/targetFilter 是函数不可跨进程序列化,但主动技 distribute 的候选由前端
//     resolveDistributeCardIds 就地计算,无需投影层注入。
import type { EquipSlot, FrontendAPI, GameState, Json, Skill } from '../types';
import type { GameView } from '../types';
import { applyAtom, popFrame, pushFrame } from '../index';
import { markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { getGender } from '../character-meta';
import { skillLoaders } from './index';

const SKILL_NAME = '界结姻';
const USED_KEY = `${SKILL_NAME}/usedThisTurn`;

const EQUIP_SLOTS: EquipSlot[] = ['武器', '防具', '进攻马', '防御马', '宝物'];

/** 装备牌 subtype → 装备栏位 */
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
    name: SKILL_NAME,
    description:
      '出牌阶段限一次:选一名男性角色,弃一张手牌或置一张装备牌入其装备区,体力大者摸1张,小者回1点',
  };
}

/** 校验某座次是否为合法界结姻目标:存活 + 男性。 */
function isMaleAlive(state: GameState, target: number): boolean {
  const p = state.players[target];
  if (!p?.alive) return false;
  return getGender(p.character) === '男';
}

/** cardId 是否在 owner 装备区,返回所在栏位;不在返回 null。 */
function findEquipSlot(state: GameState, player: number, cardId: string): EquipSlot | null {
  const eq = state.players[player]?.equipment ?? {};
  for (const slot of EQUIP_SLOTS) {
    if (eq[slot] === cardId) return slot;
  }
  return null;
}

/** 从 params 规范化出 { cardId, target }。
 *  支持三种格式:
 *   1. distribute/allocate: params.allocation = [{target, cardIds:[id]}](前端/正式提交)
 *   2. 简单: params.cardIds = [id] + params.target = idx
 *   3. 单卡: params.cardId + params.target = idx(测试/headless 直发) */
function resolveParams(
  params: Record<string, Json>,
): { cardId: string; target: number } | null {
  const allocation = params.allocation;
  if (Array.isArray(allocation) && allocation.length > 0) {
    const entry = allocation[0] as { cardIds?: Json; target?: Json };
    const cardIds = entry.cardIds;
    const target = entry.target;
    if (Array.isArray(cardIds) && cardIds.length >= 1 && typeof target === 'number') {
      return { cardId: String(cardIds[0]), target };
    }
  }
  const target = params.target;
  if (typeof target !== 'number') return null;
  const cardId =
    typeof params.cardId === 'string'
      ? params.cardId
      : Array.isArray(params.cardIds) && typeof params.cardIds[0] === 'string'
        ? (params.cardIds[0] as string)
        : undefined;
  if (!cardId) return null;
  return { cardId, target };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── use:主动发动界结姻(单步:直接提交 牌+目标)──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>): string | null => {
      const self = st.players[ownerId];
      if (!self?.alive) return '角色不可用';
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '不是出牌阶段';
      if (hasBlockingPending(st)) return '当前有未回应的询问';
      if (st.players[ownerId]?.vars[USED_KEY]) return '本回合已使用过界结姻';

      const resolved = resolveParams(params);
      if (!resolved) return '需要选择一张牌和一名男性目标';
      const { cardId, target } = resolved;

      if (!isMaleAlive(st, target)) return '目标必须是男性角色';

      // 牌必须在 owner 手牌或装备区
      const inHand = self.hand.includes(cardId);
      const ownerSlot = findEquipSlot(st, ownerId, cardId);
      if (!inHand && ownerSlot === null) return '牌不在手牌或装备区';

      // 装备区来的牌必为装备牌(装备区只放装备),代价 B 必有合法栏位
      const card = st.cardMap[cardId];
      if (card?.type === '装备牌' && slotOf(card) === null) return '装备牌栏位不合法';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const resolved = resolveParams(params);
      if (!resolved) return; // validate 已保证非空,防御
      const { cardId, target } = resolved;
      const from = ownerId;

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(st, from, SKILL_NAME);
      await pushFrame(st, SKILL_NAME, from, {});

      try {
        const card = st.cardMap[cardId];
        const isEquipment = card?.type === '装备牌';

        if (isEquipment) {
          // ── 代价 B:将装备牌置入目标装备区(可替换)──
          const slot = slotOf(card)!;

          // 若装备来自 owner 装备区:先卸下(牌回 owner 手牌)+ 移除其技能
          const ownerSlot = findEquipSlot(st, from, cardId);
          if (ownerSlot !== null) {
            if (card?.name && skillLoaders[card.name]) {
              await applyAtom(st, { type: '移除技能', player: from, skillId: card.name });
            }
            await applyAtom(st, { type: '卸下', player: from, slot: ownerSlot });
          }
          // 此时牌在 owner 手牌(原本在手 或 刚卸下)→ 交给目标
          await applyAtom(st, {
            type: '移动牌',
            cardId,
            from: { zone: '手牌', player: from },
            to: { zone: '手牌', player: target },
          });

          // 替换目标同栏位旧装备
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

          await applyAtom(st, { type: '装备', player: target, cardId });
          if (card?.name && skillLoaders[card.name]) {
            await applyAtom(st, { type: '添加技能', player: target, skillId: card.name });
          }
        } else {
          // ── 代价 A:弃置一张手牌 ──
          await applyAtom(st, { type: '弃置', player: from, cardIds: [cardId], voluntary: true });
        }

        // ── 效果:体力值比较(代价不改变体力,故与发动前等价)──
        const ownerHealth = st.players[from].health;
        const targetHealth = st.players[target].health;
        if (ownerHealth > targetHealth) {
          // 自己摸1,目标回1
          await applyAtom(st, { type: '摸牌', player: from, count: 1 });
          await applyAtom(st, { type: '回复体力', target, amount: 1, source: from });
        } else if (ownerHealth < targetHealth) {
          // 目标摸1,自己回1
          await applyAtom(st, { type: '摸牌', player: target, count: 1 });
          await applyAtom(st, { type: '回复体力', target: from, amount: 1, source: from });
        }
        // 体力相等:字面无"较大/较小"者,双方均不结算额外效果(已注裁定)
      } finally {
        await popFrame(st);
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: SKILL_NAME,
    style: 'primary',
    prompt: {
      type: 'distribute',
      mode: 'allocate',
      title: '界结姻:选一张手牌弃置,或选一张装备牌置入一名男性角色的装备区',
      source: 'handAndEquip',
      minTotal: 1,
      maxTotal: 1,
      minPerTarget: 1,
      maxPerTarget: 1,
      allowSelf: false,
      targetFilter: (view: GameView, target: number) => {
        const p = view.players[target];
        if (!p || p.alive === false) return false;
        return getGender(p.character) === '男';
      },
    },
    activeWhen: (ctx) => activeUnlessUsedThisTurn(SKILL_NAME)(ctx),
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
