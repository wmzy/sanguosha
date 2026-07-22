// 界解烦(界韩当·吴·限定技,OL hero/676 界限突破官方逐字):
//   "限定技,出牌阶段,你可以选择一名角色,
//    令所有攻击范围内包含其的角色选择一项:
//    1.弃置一张武器牌;2.令该角色摸一张牌。
//    若此时为第一轮,回合结束时,此技能视为未发动过。"
//
// 与标版解烦(韩当·一将成名,未实现)的差异(参考 docs/research/武将技能/吴国/韩当.md):
//   1. 标版:"令所有攻击范围内包含其的角色各选择一项:1.弃置一张武器牌;2.令其摸一张牌。"
//      ——无第一轮重置。
//   2. 界版:措辞从"令其摸一张牌"改为"令该角色摸一张牌"(同义);新增第一轮重置条款。
//
// 实现要点:
//   - 限定技 registerAction 'use':参数 { target }(任一存活角色,可为自己)。
//   - 整局一次:player.vars['界解烦/used'](永久,不被 回合结束 atom 清空)。
//   - 第一轮重置:发动时若 state.turn.round === 1,设 turn.vars['界解烦/resetOnEnd']=ownerId;
//     回合结束 after-hook 见此标记则清空 USED_KEY(限定技"视为未发动过")。
//   - "所有攻击范围内包含其的角色":遍历存活其他角色 P,检查 inAttackRange(state, P, target)。
//     依 inAttackRange 语义(P===target 返回 false),target 自身不在受影响集合内。
//   - 每个受影响角色依次(按座次顺序)请求回应,二选一:
//     选项1(弃武器):受影响角色手中有武器牌则可弃;弃一张武器牌。
//     选项2(令摸牌):target 摸一张牌。
//     无武器牌的角色只能选选项2(弃武器时 execute 校验拦截,前端 prompt 提示)。
//   - 超时默认:有武器选弃武器(履行义务不令他人摸牌),否则触发选项2。
//   - respond 路由:任何座次都可能成为受影响者,onInit 遍历所有座次注册 respond
//     (镜像 界眩惑 模式)。requestType 按受影响者座次区分:`界解烦/choose/<p>`。
//
// 命名:文件名/loader key/character skill name 均为 '界解烦'(避开标版冲突);
//   内部 Skill.name = '解烦'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import {
  registerAction,
  registerBeforeHook,
  hasBlockingPending,
  type SkillModule,
} from '../skill';
import { inAttackRange } from '../distance';
import { defaultPlayActive } from '../action-active';

const SKILL_ID = '界解烦';
const DISPLAY_NAME = '解烦';

/** player.vars key:限定技已用(永久,不被 回合结束 atom 清空) */
const USED_KEY = `${SKILL_ID}/used`;
/** turn.vars key:第一轮发动标记(回合结束 hook 据此清空 USED_KEY) */
const RESET_ON_END_VAR = `${SKILL_ID}/resetOnEnd`;

// 询问 requestType(每个受影响角色独立):`界解烦/choose/<seatId>`
const CHOOSE_RT_PREFIX = `${SKILL_ID}/choose/`;

/** localVars key:受影响者 p 的选择结果。值 'discard' / 'draw' */
const choiceKey = (p: number) => `${SKILL_ID}/choice/${p}`;

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '限定技,出牌阶段选择一名角色,令所有攻击范围内包含其的角色各选:弃一张武器牌 或 令该角色摸一张牌。第一轮发动后回合结束视为未发动',
  };
}

/** 是否为武器牌 */
function isWeaponCard(card: { type?: string; subtype?: string } | undefined): boolean {
  return !!card && card.type === '装备牌' && card.subtype === '武器';
}

/** 玩家手牌中的武器牌 cardId 列表 */
function weaponCardsInHand(state: GameState, player: number): string[] {
  const p = state.players[player];
  if (!p) return [];
  return p.hand.filter((cid) => isWeaponCard(state.cardMap[cid]));
}

/** 列出所有攻击范围内包含 target 的存活其他角色(按座次顺序) */
function affectedPlayers(state: GameState, target: number): number[] {
  const result: number[] = [];
  for (const p of state.players) {
    if (!p.alive) continue;
    if (p.index === target) continue; // inAttackRange(self,self)=false,显式跳过
    if (inAttackRange(state, p.index, target)) result.push(p.index);
  }
  return result;
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloads: Array<() => void> = [];

  // ── use:主动发动解烦(仅界韩当 owner 注册)──
  unloads.push(
    registerAction(
      state,
      skill.id,
      ownerId,
      'use',
      (st: GameState, params: Record<string, Json>): string | null => {
        if (st.currentPlayerIndex !== ownerId) return '不是你的回合';
        if (st.phase !== '出牌') return '只能在出牌阶段发动';
        if (hasBlockingPending(st)) return '当前有未完成的询问';
        if (st.players[ownerId]?.vars[USED_KEY] === true)
          return '解烦已发动过(限定技)';
        const self = st.players[ownerId];
        if (!self?.alive) return '玩家不存在或已死亡';
        const target = params.target as number | undefined;
        if (typeof target !== 'number') return '需要指定目标';
        if (!st.players[target]?.alive) return '目标不合法';
        return null;
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const from = ownerId;
        const target = params.target as number;

        // 标记限定技已用(永久 player.vars)。即便后续询问异常也算用过。
        st.players[from].vars[USED_KEY] = true;
        // 第一轮发动:设 turn-scoped 重置标记
        if (st.turn.round === 1) {
          st.turn.vars[RESET_ON_END_VAR] = from;
          await applyAtom(st, {
            type: '回合用量',
            player: from,
            key: RESET_ON_END_VAR,
            value: true,
          });
        }

        await pushFrame(st, SKILL_ID, from, { ...params, chosenTarget: target });

        try {
          // 收集受影响角色(攻击范围内包含 target 的存活其他角色)
          const affected = affectedPlayers(st, target);

          // 依次询问每个受影响角色(按座次顺序)
          for (const p of affected) {
            if (!st.players[target]?.alive) break; // 目标死亡则停止
            if (!st.players[p]?.alive) continue; // 受影响角色死亡则跳过

            const weapons = weaponCardsInHand(st, p);
            const requestType = `${CHOOSE_RT_PREFIX}${p}`;
            delete st.localVars[choiceKey(p)];

            // 默认选择:有武器→弃武器(选项1);无武器→令其摸牌(选项2)
            const defaultDiscard = weapons.length > 0;

            await applyAtom(st, {
              type: '请求回应',
              requestType,
              target: p,
              prompt: {
                type: 'confirm',
                title: `解烦(目标 ${st.players[target].name}):弃一张武器牌 或 令 ${st.players[target].name} 摸一张牌?${
                  weapons.length === 0 ? '(你无武器牌,只能选令其摸牌)' : ''
                }`,
                description: `confirm=true 弃一张武器牌;confirm=false(choice 取消 / 超时)令其摸一张牌`,
                confirmLabel: '弃武器牌',
                cancelLabel: '令其摸牌',
              },
              defaultChoice: defaultDiscard,
              timeout: 20,
            });

            // 读选择:choice/confirmed=true → 弃武器;否则 → 令摸牌
            const choiceDiscard = st.localVars[choiceKey(p)] === 'discard';

            if (choiceDiscard) {
              // 弃武器:再次校验仍有武器牌
              const currentWeapons = weaponCardsInHand(st, p);
              if (currentWeapons.length > 0) {
                await applyAtom(st, {
                  type: '弃置',
                  player: p,
                  cardIds: [currentWeapons[0]],
                });
                continue;
              }
              // 选择弃武器但无武器牌 → 退回令摸牌
            }
            // 令 target 摸一张牌
            if (st.players[target]?.alive) {
              await applyAtom(st, { type: '摸牌', player: target, count: 1 });
            }
          }
        } finally {
          // 清理所有 choice localVars(防泄漏到下次发动)
          for (const key of Object.keys(st.localVars)) {
            if (key.startsWith(`${SKILL_ID}/choice/`)) delete st.localVars[key];
          }
          await popFrame(st);
        }
      },
    ),
  );

  // ── respond:遍历所有座次注册(任何座次都可能成为受影响者)──
  //    镜像 界眩惑 模式:requestType 按受影响者座次区分。
  for (const player of state.players) {
    const seatId = player.index;
    unloads.push(
      registerAction(
        state,
        skill.id,
        seatId,
        'respond',
        (st: GameState, _params: Record<string, Json>): string | null => {
          const slot = st.pendingSlots.get(seatId);
          if (!slot || slot.atom.type !== '请求回应') return '当前不需要回应';
          const rt = (slot.atom as { requestType?: string }).requestType ?? '';
          // 解烦 CHOOSE 询问:requestType 必须是 `界解烦/choose/<seatId>`,
          // 且 target === seatId(本座次 slot)
          if (rt !== `${CHOOSE_RT_PREFIX}${seatId}`) return '当前不是解烦询问';
          return null;
        },
        async (st: GameState, params: Record<string, Json>): Promise<void> => {
          const slot = st.pendingSlots.get(seatId);
          const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType ?? '';
          if (rt !== `${CHOOSE_RT_PREFIX}${seatId}`) return;
          // choice=true / confirmed=true → discard;否则 → draw
          st.localVars[choiceKey(seatId)] =
            params.choice === true || params.confirmed === true ? 'discard' : 'draw';
        },
      ),
    );
  }

  // ── 回合结束 before-hook:第一轮发动的解烦,清空 USED_KEY(视为未发动) ──
  //   注:用 before-hook 而非 after-hook,因 回合结束 atom 的 apply 会清空 turn.vars。
  //   before-hook 在 apply 之前执行,turn.vars[RESET_ON_END_VAR] 仍可读。
  unloads.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '回合结束',
      async (ctx): Promise<void> => {
        const atom = ctx.atom;
        if (atom.type !== '回合结束') return;
        if (atom.player !== ownerId) return;
        if (ctx.state.turn.vars[RESET_ON_END_VAR] !== ownerId) return;
        // 清空限定技已用标记(视为未发动过)
        delete ctx.state.players[ownerId].vars[USED_KEY];
        // turn.vars 由 回合结束 atom apply 阶段清空(RESET_ON_END_VAR 随之消失)
      },
    ),
  );

  return () => {
    for (const fn of unloads) fn();
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: DISPLAY_NAME,
    style: 'danger',
    prompt: {
      type: 'selectTarget',
      title: '解烦:选择一名角色(所有攻击范围内包含其的角色各选:弃武器 或 令其摸牌)',
      targetFilter: {
        min: 1,
        max: 1,
        filter: (_view, t) => true, // 任意存活角色(后端 validate 校验)
      },
    },
    activeWhen: (ctx) => {
      if (!defaultPlayActive(ctx)) return false;
      // 限定技未用过才显示
      const used = ctx.view.players[ctx.perspectiveIdx]?.turnUsage?.[USED_KEY];
      return used !== true;
    },
  });
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'default',
    prompt: { type: 'confirm', title: '解烦' },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
