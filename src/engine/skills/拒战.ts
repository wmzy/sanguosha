// 拒战(严颜·蜀·被动技·转换技,OL hero/400 风林火山官方逐字):
//   "转换技,阳:当你成为其他角色使用【杀】的目标后,你可以与其各摸一张牌,
//    然后其本回合不能再对你使用牌。
//    阴:当你使用【杀】指定一名角色为目标后,你可以获得其一张牌,
//    然后你本回合不能再对其使用牌。"
//
// 转换技状态: player.vars['拒战/态'] = '阳'(默认) | '阴',跨回合持久。
//   - 阳(被动 after-hook on '成为目标后'):严颜成为其他角色杀的目标后,询问发动;
//     发动 → 双方各摸一张牌 → 设禁制(source→owner,本回合) → 翻为 阴。
//   - 阴(被动 after-hook on '指定目标后'):严颜使用杀指定目标后,询问发动;
//     发动 → 获得目标一张牌(选牌面板 obtain) → 设禁制(owner→target,本回合) → 翻为 阳。
//
// "其/你本回合不能再对…使用牌"实现(成目标 before-hook cancel,与界惴恐/空城同构):
//   - 禁制对存 turn.vars['拒战/禁对'] = [{from,to},...],随「回合结束」atom 自动清空。
//   - 成为目标 before-hook:若 (source→target) 命中禁制 → cancel(跳过该目标结算)。
//   - 必须挂「成为目标」:runUseFlow 声明阶段对「指定目标」applyAtom 返回值不检查(cancel 无效),
//     只有「成为目标」cancel 才会计入 skippedTargets、跳过结算。
//   - 不影响触发杀本身:禁制在「成为目标后」/「指定目标后」(均晚于「成为目标」声明阶段)才写入,
//     当前杀的「成为目标」早已通过 → 仅阻断本回合后续用牌(覆盖杀/决斗/顺手牵羊/过河拆桥/
//     火攻/借刀杀人/AOE/激将虚拟杀 等所有走 runUseFlow 且带目标的牌)。
//
// 关键点:
//   - 转换态经「回合用量」atom 投影 view.turnUsage['拒战/态'];该字段无 /usedThisTurn 后缀,
//     player.vars 跨回合持久,但 view.turnUsage 在「回合结束」整体清空,故在拥有者「回合开始」
//     after-hook 重新同步一次(供前端展示当前阴阳态)。
//   - 一个 respond action 按 requestType 分支(阳确认 / 阴确认 / 阴选牌)。
//   - 选牌面板与反馈/顺手牽羊共用(../flows/pick-card-panel.ts);obtain 模式,includeJudge=false。
//   - 阴仅在目标有牌(手牌+装备)时触发(否则"获得其一张牌"无可获)。
//   - 阳/阴均"你可以"=可选:confirm 不发动则不摸/不获、不设禁制、不翻转。
import type {
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../core/apply';
import { registerAction, registerAfterHook, registerBeforeHook } from '../core/skill';
import { runPickTargetCardPanel } from '../flows/pick-card-panel';
import type { SkillModule } from '../types';
import { PICK_RESULT_KEY } from '../rules/vars-keys';

const SKILL_ID = '拒战';
/** 转换态 state key(跨回合持久,无 /usedThisTurn 后缀)。 */
const STATE_KEY = '拒战/态';
/** 转换态 view 同步 key(经 回合用量 atom 投影 turnUsage)。 */
const STATE_VIEW_KEY = '拒战/态';
/** turn.vars key:本回合禁制对(随「回合结束」atom 自动清空)。 */
const FORBIDDEN_VAR = '拒战/禁对';

const YANG_CONFIRM_RT = '拒战/阳/confirm';
const YIN_CONFIRM_RT = '拒战/阴/confirm';
const YIN_PICK_RT = '拒战/阴/选牌';

const YANG_CONFIRMED_KEY = '拒战/阳/confirmed';
const YIN_CONFIRMED_KEY = '拒战/阴/confirmed';

type ForbiddenPair = { from: number; to: number };

function getState(state: GameState, ownerId: number): '阳' | '阴' {
  return state.players[ownerId]?.vars[STATE_KEY] === '阴' ? '阴' : '阳';
}

async function syncStateView(state: GameState, ownerId: number): Promise<void> {
  await applyAtom(state, {
    type: '回合用量',
    player: ownerId,
    key: STATE_VIEW_KEY,
    value: getState(state, ownerId),
  });
}

function isForbidden(state: GameState, from: number, to: number): boolean {
  const arr = state.turn.vars[FORBIDDEN_VAR] as ForbiddenPair[] | undefined;
  return !!arr?.some((p) => p.from === from && p.to === to);
}

function addForbidden(state: GameState, from: number, to: number): void {
  const arr = (state.turn.vars[FORBIDDEN_VAR] as ForbiddenPair[] | undefined) ?? [];
  if (!arr.some((p) => p.from === from && p.to === to)) {
    arr.push({ from, to });
    state.turn.vars[FORBIDDEN_VAR] = arr;
  }
}

/** 判定当前结算牌是否为杀(cardId 对应卡牌名为"杀",含转化/虚拟杀)。 */
function isSlashCard(state: GameState, cardId: string | undefined): boolean {
  if (!cardId) return false;
  return state.cardMap[cardId]?.name === '杀';
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: SKILL_ID,
    description:
      '转换技。阳:成为其他角色杀的目标后,你可与其各摸一张牌,然后其本回合不能再对你使用牌。阴:使用杀指定目标后,你可获得其一张牌,然后你本回合不能再对其使用牌',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:阳确认 / 阴确认 / 阴选牌(单 action 按 requestType 分支) ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>): string | null => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as { type?: string; requestType?: string };
      if (atom.type !== '请求回应') return '当前不需要回应';
      const rt = atom.requestType;
      if (rt === YANG_CONFIRM_RT || rt === YIN_CONFIRM_RT) {
        return null; // confirm:接受 choice/confirmed 布尔
      }
      if (rt === YIN_PICK_RT) {
        // 选牌面板:校验 zone + cardId/handIndex(同反馈/过河拆桥)
        const zone = params.zone;
        if (zone === 'equipment') {
          if (typeof params.cardId !== 'string') return 'cardId required';
        } else if (zone === 'hand') {
          if (typeof params.handIndex !== 'number') return 'handIndex required';
        } else {
          return 'zone required (equipment|hand)';
        }
        return null;
      }
      return '当前不是拒战回应';
    },
    async (st: GameState, params: Record<string, Json>): Promise<void> => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === YANG_CONFIRM_RT) {
        st.localVars[YANG_CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === YIN_CONFIRM_RT) {
        st.localVars[YIN_CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === YIN_PICK_RT) {
        // 选牌面板结果(与反馈/过河拆桥共用 '选牌/结果' 契约)
        st.localVars[PICK_RESULT_KEY] = {
          zone: params.zone,
          cardId: params.cardId ?? null,
          handIndex: params.handIndex ?? null,
        };
      }
    },
  );

  // ── 成为目标 before-hook:禁制对 → cancel(跳过该目标结算) ──
  // 永久注册,内部按 turn.vars[FORBIDDEN_VAR] 判定;随「回合结束」atom 自动清。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '成为目标',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      const source = atom.source;
      const target = atom.target;
      if (typeof source !== 'number' || typeof target !== 'number') return;
      if (source === target) return; // 对自己用牌(桃/酒)允许
      if (!isForbidden(ctx.state, source, target)) return;
      return { kind: 'cancel' };
    },
  );

  // ── 阳:成为目标后 after-hook(严颜成为其他角色杀的目标) ──
  registerAfterHook(state, skill.id, ownerId, '成为目标后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return; // 严颜成为目标
    const source = atom.source;
    if (source === ownerId) return; // 仅"其他角色"
    if (!isSlashCard(ctx.state, atom.cardId)) return; // 仅杀
    if (getState(ctx.state, ownerId) !== '阳') return; // 仅阳状态
    if (!ctx.state.players[ownerId]?.alive) return;
    if (!ctx.state.players[source]?.alive) return;

    // 询问是否发动
    delete ctx.state.localVars[YANG_CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: YANG_CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '拒战(阳):是否与其各摸一张牌,然后其本回合不能再对你使用牌?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars[YANG_CONFIRMED_KEY]) return; // 不发动 → 不翻转
    delete ctx.state.localVars[YANG_CONFIRMED_KEY];

    // 双方各摸一张牌(严颜先,来源后)
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 1 });
    if (ctx.state.players[source]?.alive) {
      await applyAtom(ctx.state, { type: '摸牌', player: source, count: 1 });
    }

    // 设禁制:source 本回合不能再对 ownerId 使用牌
    addForbidden(ctx.state, source, ownerId);

    // 翻转为阴
    ctx.state.players[ownerId].vars[STATE_KEY] = '阴';
    await syncStateView(ctx.state, ownerId);
  });

  // ── 阴:指定目标后 after-hook(严颜使用杀指定目标) ──
  registerAfterHook(state, skill.id, ownerId, '指定目标后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return; // 严颜使用的杀
    const target = atom.target;
    if (typeof target !== 'number') return;
    if (target === ownerId) return; // 杀不可指定自己(防御)
    if (!isSlashCard(ctx.state, atom.cardId)) return; // 仅杀
    if (getState(ctx.state, ownerId) !== '阴') return; // 仅阴状态
    if (!ctx.state.players[ownerId]?.alive) return;
    const targetPlayer = ctx.state.players[target];
    if (!targetPlayer?.alive) return;
    // 阴需获得其一张牌:目标无牌(手牌+装备)则不触发
    const hasCards =
      targetPlayer.hand.length > 0 || Object.keys(targetPlayer.equipment).length > 0;
    if (!hasCards) return;

    // 询问是否发动
    delete ctx.state.localVars[YIN_CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: YIN_CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '拒战(阴):是否获得其一张牌,然后你本回合不能再对其使用牌?',
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars[YIN_CONFIRMED_KEY]) return; // 不发动 → 不翻转
    delete ctx.state.localVars[YIN_CONFIRMED_KEY];

    // 获得其一张牌(选牌面板 obtain,不含判定区;手牌盲选/装备明选)
    await runPickTargetCardPanel(ctx.state, ownerId, target, targetPlayer, {
      mode: 'obtain',
      requestType: YIN_PICK_RT,
      title: `拒战(阴):选择从 ${targetPlayer.name} 获得的一张牌`,
      includeJudge: false,
    });

    // 设禁制:ownerId 本回合不能再对 target 使用牌
    addForbidden(ctx.state, ownerId, target);

    // 翻转为阳
    ctx.state.players[ownerId].vars[STATE_KEY] = '阳';
    await syncStateView(ctx.state, ownerId);
  });

  // ── 回合开始:重新同步转换态到 view(回合结束会整体清空 turnUsage) ──
  registerAfterHook(state, skill.id, ownerId, '回合开始', async (ctx) => {
    if (ctx.atom.player !== ownerId) return;
    await syncStateView(ctx.state, ownerId);
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: SKILL_ID,
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '拒战',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
