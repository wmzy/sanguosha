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
// 交互流程(参考界荐言的多步 pending 模式;前端无法用单一 prompt 同时收集
//   目标+牌+代价,故拆成顺序询问):
//   1. use action(confirm 按钮):出牌阶段发动(限一次)。
//   2. 询问目标(请求回应 '界结姻/target',choosePlayer,男性过滤)。
//   3. 询问牌(请求回应 '界结姻/card',useCard,任意手牌)。
//   4. 若所选为装备牌 → 询问代价(请求回应 '界结姻/cost',chooseOption:弃置/置入装备区);
//      否则代价直接为"弃手牌"。
//   5. 结算代价 + 体力比较效果。
//
// 关键点:
//   - 限一次/回合:用 player.vars['界结姻/usedThisTurn'] 标记,回合用量 atom 同步到 view。
//     标记在 execute 开头(confirm 后),玩家中途放弃询问则本技能仍算已用(与界荐言一致)。
//   - 代价 A(弃手牌):弃置所选手牌(任意类型)。
//   - 代价 B(置装备):所选装备牌置入目标对应栏位;目标已有同栏位装备则替换
//     (移除旧技能 → 卸下 → 旧装备入弃牌堆 → 装备新 → 添加新技能),替换会触发目标"失去装备"类技能。
//   - 效果比较在代价支付后进行(代价不改变体力,故与发动前等价)。
//   - 回复体力不能超过体力上限:回复体力 atom.apply 已 Math.min 限制,无需技能处理。
//   - choosePlayer / useCard prompt 的 filter 是函数,无法跨进程序列化;投影层
//     (resolveChoosePlayerCandidates / resolveCardFilterCandidates)自动计算可序列化
//     candidates 随 pending 下发,前端/无头客户端据此渲染与枚举。
import type { EquipSlot, FrontendAPI, GameState, Json, Skill } from '../types';
import type { GameView } from '../types';
import { applyAtom, popFrame, pushFrame } from '../index';
import { markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, hasBlockingPending, type SkillModule } from '../skill';
import { getGender } from '../character-meta';
import { skillLoaders } from './index';

const SKILL_NAME = '界结姻';
const USED_KEY = `${SKILL_NAME}/usedThisTurn`;
/** 询问 RT */
const TARGET_RT = `${SKILL_NAME}/target`;
const CARD_RT = `${SKILL_NAME}/card`;
const COST_RT = `${SKILL_NAME}/cost`;
/** localVars 暂存 key(与 RT 同名,分属不同 map,不冲突) */
type CostMode = '弃手牌' | '置装备';

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

/** 当前 pending 的 requestType(无 pending 或非请求回应时返回 null)。 */
function currentRequestType(state: GameState, ownerId: number): string | null {
  const slot = state.pendingSlots.get(ownerId);
  const atom = slot?.atom as { type?: string; requestType?: string } | undefined;
  if (!atom || atom.type !== '请求回应') return null;
  return typeof atom.requestType === 'string' ? atom.requestType : null;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:处理 target / card / cost 三种询问 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const rt = currentRequestType(st, ownerId);
      if (rt === TARGET_RT) {
        const t = params.target;
        if (typeof t !== 'number' || !isMaleAlive(st, t)) return '目标必须是男性角色';
        return null;
      }
      if (rt === CARD_RT) {
        const id = params.cardId;
        if (typeof id !== 'string' || !st.players[ownerId]?.hand.includes(id))
          return '牌不在手牌中';
        return null;
      }
      if (rt === COST_RT) {
        const c = params.option;
        if (c !== '弃手牌' && c !== '置装备') return '代价选项不合法';
        return null;
      }
      return '当前不是界结姻询问';
    },
    async (st: GameState, params: Record<string, Json>) => {
      const rt = currentRequestType(st, ownerId);
      if (rt === TARGET_RT) {
        st.localVars[TARGET_RT] = params.target as number;
      } else if (rt === CARD_RT) {
        st.localVars[CARD_RT] = params.cardId as string;
      } else if (rt === COST_RT) {
        st.localVars[COST_RT] = params.option as CostMode;
      }
    },
  );

  // ── use:主动发动界结姻 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, _params: Record<string, Json>): string | null => {
      const self = st.players[ownerId];
      if (!self?.alive) return '角色不可用';
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '不是出牌阶段';
      if (hasBlockingPending(st)) return '当前有未回应的询问';
      if (st.players[ownerId]?.vars[USED_KEY]) return '本回合已使用过界结姻';
      // 两种代价都需要一张手牌
      if (self.hand.length < 1) return '手牌不足一张';
      // 必须有男性角色可选
      if (!st.players.some((_p, i) => isMaleAlive(st, i))) return '无男性角色可选';
      return null;
    },
    async (st: GameState, _params: Record<string, Json>) => {
      const from = ownerId;

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(st, from, SKILL_NAME);
      await pushFrame(st, SKILL_NAME, from, {});

      try {
        // 1. 询问目标(男性角色)
        delete st.localVars[TARGET_RT];
        await applyAtom(st, {
          type: '请求回应',
          requestType: TARGET_RT,
          target: from,
          timeout: 20,
          prompt: {
            type: 'choosePlayer',
            title: '界结姻:选择一名男性角色',
            min: 1,
            max: 1,
            filter: (_view: GameView, t: number) => isMaleAlive(st, t),
          },
        });
        const target = st.localVars[TARGET_RT] as number | undefined;
        delete st.localVars[TARGET_RT];
        if (typeof target !== 'number' || !isMaleAlive(st, target)) {
          return; // 超时/无效目标:界结姻失效(已限一次,不再触发)
        }

        // 2. 询问代价牌(任意一张手牌)
        delete st.localVars[CARD_RT];
        await applyAtom(st, {
          type: '请求回应',
          requestType: CARD_RT,
          target: from,
          timeout: 20,
          prompt: {
            type: 'useCard',
            title: '界结姻:选择一张手牌作为代价',
            cardFilter: { min: 1, max: 1, filter: () => true },
          },
        });
        const cardId = st.localVars[CARD_RT] as string | undefined;
        delete st.localVars[CARD_RT];
        if (typeof cardId !== 'string' || !st.players[from]?.hand.includes(cardId)) {
          return; // 超时/无效牌:失效
        }

        // 3. 代价:装备牌 → 询问弃置/置入;非装备牌 → 直接弃手牌
        let cost: CostMode = '弃手牌';
        const card = st.cardMap[cardId];
        if (card?.type === '装备牌') {
          delete st.localVars[COST_RT];
          await applyAtom(st, {
            type: '请求回应',
            requestType: COST_RT,
            target: from,
            timeout: 20,
            prompt: {
              type: 'chooseOption',
              title: '界结姻:这张装备牌如何作为代价?',
              options: [
                { value: '弃手牌', label: '弃置这张手牌' },
                { value: '置装备', label: '置入其装备区' },
              ],
            },
            defaultChoice: '弃手牌',
          });
          const chosen = st.localVars[COST_RT] as CostMode | undefined;
          delete st.localVars[COST_RT];
          cost = chosen === '置装备' ? '置装备' : '弃手牌';
        }

        // ── 结算代价 ──
        if (cost === '弃手牌') {
          await applyAtom(st, { type: '弃置', player: from, cardIds: [cardId], voluntary: true });
        } else {
          // 置装备:把装备牌交到目标手中,再装备到目标(可替换原装备)
          const slot = slotOf(card)!;
          await applyAtom(st, {
            type: '移动牌',
            cardId,
            from: { zone: '手牌', player: from },
            to: { zone: '手牌', player: target },
          });
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
    activeWhen: (ctx) => activeUnlessUsedThisTurn(SKILL_NAME)(ctx),
    prompt: {
      type: 'confirm',
      title: '是否发动界结姻?',
      description:
        '选一名男性角色,弃一张手牌或置一张装备牌入其装备区(体力大者摸1,小者回1)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
