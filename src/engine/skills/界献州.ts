// 界献州(界蔡夫人·群·限定技,OL 界限突破官方逐字):
//   限定技,出牌阶段,你可以将你装备区里的所有牌交给一名其他角色,
//   然后其选择一项:1.令你回复X点体力;
//   2.对其攻击范围内至多X名角色各造成1点伤害。(X为你给出的牌数)
//
// 与标版蔡夫人献州描述完全一致(标版蔡夫人未实现,独立创建界版文件)。
//
// 实现要点:
//   - 限定技:player.vars['界献州/used'](整局一次,不被 回合结束 自动清理)。
//   - 主动 use action:出牌阶段对一名其他存活角色发动,自己装备区需有牌。
//   - 交牌流程:逐张 卸下(从装备区回手)+ 给予(手牌→目标手牌)。卸下保证武器
//     距离 vars / 马匹 vars 与装备自带技能被正确清理(与 装备通用 替换流程对齐)。
//   - X = 本次交出的装备牌数(动态计算,决定后续选项 1/2 的 X)。
//   - 目标二选一(请求回应 confirm):
//       * 选项1(回血): 回复体力 X 给 owner(描述"令你回复X点体力"——"你"=献州发动者)。
//       * 选项2(造伤): 目标在自身攻击范围内选至多 X 名角色(请求回应 selectTarget),
//         对每名角色造成 1 点伤害,来源 = 目标(描述"对其攻击范围内...各造成1点伤害"——
//         "其"=接收装备的角色,即造伤来源)。
//   - respond action 注册到每个座次:目标可能是任意其他玩家(dispatch 按
//     skillId+ownerId+actionType 查询,需在目标座次上注册)。
//
// 命名:文件名/loader key/character skill name 均为 '界献州'(避开与未来标版冲突);
//   内部 Skill.name = '献州'(OL 官方技能名,玩家可见)。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import {
  registerAction,
  hasBlockingPending,
  type SkillModule,
} from '../skill';
import { skillLoaders } from './index';
import { inAttackRange } from '../distance';
import { viewCanAttack } from '../viewDistance';
import { defaultPlayActive } from '../action-active';

const SKILL_ID = '界献州';
const DISPLAY_NAME = '献州';

/** 整局一次标记(限定技)。后缀 /used 不在 回合结束 自动清理列表,持久跨回合。 */
const USED_KEY = `${SKILL_ID}/used`;
/** 询问 RT:目标选择 1(回血)/2(造伤) */
const OPTION_RT = `${SKILL_ID}/option`;
/** 询问 RT:造伤路径下,目标选择至多 X 名攻击范围内角色 */
const TARGETS_RT = `${SKILL_ID}/targets`;
/** localVars:option 询问结果(true=回血,false=造伤) */
const OPTION_KEY = `${SKILL_ID}/optionChoice`;
/** localVars:造伤目标列表(number[]) */
const TARGETS_KEY = `${SKILL_ID}/damageTargets`;
/** localVars:目标座次 */
const TARGET_KEY = `${SKILL_ID}/target`;
/** localVars:X(交出牌数) */
const COUNT_KEY = `${SKILL_ID}/X`;

const EQUIP_SLOTS = ['武器', '防具', '进攻马', '防御马', '宝物'] as const;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '限定技:出牌阶段将你装备区所有牌交给一名其他角色,其选择令你回复X点体力或对其攻击范围内至多X名角色各造成1点伤害(X为装备数)',
  };
}

/** 玩家装备区所有 cardId(已填充槽位)。 */
function equippedCardIds(state: GameState, playerId: number): string[] {
  const eq = state.players[playerId]?.equipment ?? {};
  const ids: string[] = [];
  for (const slot of EQUIP_SLOTS) {
    const id = eq[slot];
    if (id) ids.push(id);
  }
  return ids;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── use action:owner 发动献州 ──────────────────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>) => {
      if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
      if (st.phase !== '出牌') return '只能在出牌阶段发动';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      const self = st.players[ownerId];
      if (!self?.alive) return '玩家不存在或已死亡';
      if (self.vars[USED_KEY]) return '献州已使用过(限定技)';
      if (equippedCardIds(st, ownerId).length === 0) return '装备区无牌,无法发动';
      const target = params.target;
      if (typeof target !== 'number') return '需要指定目标';
      if (target === ownerId) return '不能以自己为目标';
      if (!st.players[target]?.alive) return '目标不合法';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = params.target as number;

      // 同步设限定技标记(防 dispatch 重入;参考 markOncePerTurn 同样思路)。
      st.players[from].vars[USED_KEY] = true;

      await pushFrame(st, SKILL_ID, from, { ...params });

      // ── 1. 把装备区所有牌交给 target ──
      const cardIds = equippedCardIds(st, from);
      const X = cardIds.length;
      // 逐张:移除装备技能(若有)+ 卸下(回手)
      for (const cardId of cardIds) {
        const card = st.cardMap[cardId];
        const slot = EQUIP_SLOTS.find((s) => st.players[from].equipment[s] === cardId);
        if (!slot) continue;
        if (card?.name && skillLoaders[card.name]) {
          await applyAtom(st, { type: '移除技能', player: from, skillId: card.name });
        }
        await applyAtom(st, { type: '卸下', player: from, slot });
      }
      // 此时所有装备都已到 owner 手牌;再 给予 到 target
      for (const cardId of cardIds) {
        await applyAtom(st, { type: '给予', cardId, from, to: target });
      }

      // ── 2. 询问 target 选择回血/造伤 ──
      st.localVars[COUNT_KEY] = X;
      st.localVars[TARGET_KEY] = target;
      delete st.localVars[OPTION_KEY];

      await applyAtom(st, {
        type: '请求回应',
        requestType: OPTION_RT,
        target,
        prompt: {
          type: 'confirm',
          title: `献州:${st.players[from]?.name ?? `P${from}`} 将 ${X} 张装备交给你。选择一项`,
          description: `确认 = 令其回复 ${X} 点体力;取消 = 对你攻击范围内至多 ${X} 名角色各造成 1 点伤害`,
          confirmLabel: `令其回复 ${X} 点体力`,
          cancelLabel: `对至多 ${X} 名角色造伤`,
        },
        defaultChoice: false,
        timeout: 20,
      });

      const heal = st.localVars[OPTION_KEY] === true;
      delete st.localVars[OPTION_KEY];

      if (heal) {
        // ── 选项 1:owner 回复 X 点体力 ──
        if (st.players[from]?.alive && X > 0) {
          await applyAtom(st, { type: '回复体力', target: from, amount: X, source: target });
        }
      } else {
        // ── 选项 2:target 选至多 X 名攻击范围内角色,各造 1 伤 ──
        delete st.localVars[TARGETS_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: TARGETS_RT,
          target,
          prompt: {
            type: 'selectTarget',
            title: `献州:选择至多 ${X} 名你攻击范围内的角色(对其各造成 1 点伤害)`,
            description: '可放弃(选 0 名);伤害来源为你',
            targetFilter: {
              min: 0,
              max: X,
              filter: (view, t) => {
                if (t === target) return false;
                const tp = view.players.find((pl) => pl.index === t);
                if (!tp || tp.alive === false) return false;
                return viewCanAttack(view.players, view.cardMap, target, t);
              },
            },
          },
          defaultChoice: [] as unknown as Json,
          timeout: 30,
        });
        const targetsRaw = st.localVars[TARGETS_KEY];
        delete st.localVars[TARGETS_KEY];
        const dmgTargets = Array.isArray(targetsRaw) ? (targetsRaw as number[]) : [];
        for (const t of dmgTargets) {
          if (!st.players[t]?.alive) continue;
          // 后端权威校验:必须在 target 攻击范围内
          if (!inAttackRange(st, target, t)) continue;
          await applyAtom(st, { type: '造成伤害', target: t, amount: 1, source: target });
        }
      }

      delete st.localVars[COUNT_KEY];
      delete st.localVars[TARGET_KEY];
      await popFrame(st);
    },
  );

  // ── respond:target 选择 option / damageTargets(注册到每个座次)──
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const seatId = p.index;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, params: Record<string, Json>): string | null => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as Record<string, unknown>;
        if (atom['type'] !== '请求回应') return '当前不需要回应';
        const rt = atom['requestType'] as string;
        if (rt !== OPTION_RT && rt !== TARGETS_RT) return '当前不是献州询问';
        if (rt === OPTION_RT) {
          // confirm:接受 choice/confirmed 布尔
          return null;
        }
        // TARGETS_RT:校验 targets
        const raw = params.targets;
        if (!Array.isArray(raw)) return '需要 targets 数组';
        const targets = raw as number[];
        const X = st.localVars[COUNT_KEY] as number;
        if (typeof X !== 'number') return '询问状态异常';
        if (targets.length > X) return `至多选 ${X} 名目标`;
        // 不重复
        const unique = new Set(targets);
        if (unique.size !== targets.length) return '不能选重复目标';
        const targetPlayer = seatId;
        for (const t of targets) {
          if (typeof t !== 'number') return '目标必须是数字';
          if (t === targetPlayer) return '不能选自己';
          if (!st.players[t]?.alive) return '目标已死亡';
          if (!inAttackRange(st, targetPlayer, t)) return '目标不在你的攻击范围内';
        }
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        const rt = (slot?.atom as Record<string, unknown> | undefined)?.['requestType'] as string;
        if (rt === OPTION_RT) {
          st.localVars[OPTION_KEY] = params.choice === true || params.confirmed === true;
        } else if (rt === TARGETS_RT) {
          st.localVars[TARGETS_KEY] = params.targets as Json;
        }
      },
    );
    unloaders.push(u);
  }

  return () => {
    unloaders.forEach((u) => u());
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'selectTarget',
      title: '献州:将装备区所有牌交给一名其他角色,其选择回血或造伤',
      description: '限定技(整局一次);X = 你交出的装备数',
      targetFilter: {
        min: 1,
        max: 1,
        filter: (_view, t) => t !== skill.ownerId,
      },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      const me = ctx.view.players[ctx.perspectiveIdx];
      if (!me) return false;
      // 装备区需有牌(限定技"已使用"由后端 validate 兜底;view 不暴露持久 vars)
      return Object.values(me.equipment).some((id) => !!id);
    },
  });

  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'confirm',
      title: '献州',
      confirmLabel: '令其回血',
      cancelLabel: '造伤',
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
