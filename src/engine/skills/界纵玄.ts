// 界纵玄(界虞翻·被动技,OL hero/603 官方逐字):
//   当你的牌因弃置而置入弃牌堆后,或你上家的牌于每回合首次因弃置而置入弃牌堆后,
//   你可以将其中任意张牌置于牌堆顶。
//
// 界限突破(相对标版 src/engine/skills/纵玄.ts,标版未实现):
//   标版:"当你的牌因弃置而置入弃牌堆后,你可以将其中任意张牌置于牌堆顶。"
//   界版新增:"或你上家的牌于每回合首次因弃置而置入弃牌堆后"——上家弃牌亦可触发,
//             但每回合限首次一次。
//
// 触发条件:
//   - 自己弃置(atom.player === ownerId):每次弃置均可触发,无次数限制
//   - 上家弃置(atom.player === 上家):仅每回合首次触发
//   "上家"= findNextAlive(state, candidate) === ownerId 的 candidate
//   (该 candidate 的下一个存活玩家是 ownerId,即 candidate 在 ownerId 之前一手)
//
// 牌堆顶=deck 末尾(摸牌 atom 从末尾抽 slice(-count)),故 移动牌 to '牌堆' 即置顶。
// 多张牌时:玩家逐张选择,每次 push 到 deck 末尾——最后选的牌成为新的最顶(最先被摸)。
//
// "任意张":玩家可选 0..N 张(任意子集)。实现用循环 pickProcessingCard(单选)+ 询问是否继续。
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界纵玄';
const DISPLAY_NAME = '纵玄';
/** requestType */
const CONFIRM_RT = '界纵玄/confirm'; // 是否发动
const PICK_RT = '界纵玄/pick'; // 选一张置于牌堆顶
const AGAIN_RT = '界纵玄/again'; // 是否继续选
/** localVars key */
const CONFIRM_KEY = '界纵玄/confirmed';
const PICK_KEY = '界纵玄/cardId';
const AGAIN_KEY = '界纵玄/again';
/** turn.vars key:本回合上家弃牌触发已用过一次(回合结束 atom 自动清空 turn.vars) */
const UPSTREAM_TRIGGERED_KEY = '界纵玄/upstreamTriggeredThisTurn';

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

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '当你的牌因弃置置入弃牌堆后,或你上家每回合首次因弃置置入弃牌堆后,你可以将其中任意张牌置于牌堆顶',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 弃置 after-hook:自己弃置(任意次)或上家弃置(每回合首次)──
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom;
    const st = ctx.state;
    const discarder = atom.player;

    if (!st.players[ownerId]?.alive) return; // 自己须存活

    let isUpstream = false;
    if (discarder === ownerId) {
      // 自己弃置——任意次触发
    } else if (isUpstreamOf(st, discarder, ownerId)) {
      // 上家弃置——每回合首次
      if (st.turn.vars[UPSTREAM_TRIGGERED_KEY]) return;
      st.turn.vars[UPSTREAM_TRIGGERED_KEY] = true;
      isUpstream = true;
    } else {
      // 非自己非上家——不触发
      return;
    }

    // 过滤仍在弃牌堆的牌(防御性:理论上不会被中途移走)
    const eligible = atom.cardIds.filter((id) => st.zones.discardPile.includes(id));
    if (eligible.length === 0) return;

    await pushFrame(st, SKILL_ID, ownerId, { cardIds: [...eligible] });
    try {
      // ── 第一步:是否发动纵玄 ──
      delete st.localVars[CONFIRM_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动纵玄?(${isUpstream ? '上家' : '你'}弃置了 ${eligible.length} 张牌,可选若干置于牌堆顶)`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 30,
      });
      if (st.localVars[CONFIRM_KEY] !== true) {
        delete st.localVars[CONFIRM_KEY];
        return;
      }
      delete st.localVars[CONFIRM_KEY];

      // ── 循环:每次选一张置于牌堆顶,玩家可选 0..N 张 ──
      const remaining = [...eligible];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const available = remaining.filter((id) => st.zones.discardPile.includes(id));
        if (available.length === 0) break;

        delete st.localVars[PICK_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: PICK_RT,
          target: ownerId,
          prompt: {
            type: 'pickProcessingCard',
            title: '纵玄:选择一张牌置于牌堆顶',
            cards: available.map((id) => {
              const c = st.cardMap[id];
              return {
                cardId: id,
                cardName: c?.name ?? '?',
                suit: c?.suit ?? '',
                rank: c?.rank ?? '',
              };
            }),
          },
          defaultChoice: available[0],
          timeout: 30,
        });
        const pickedId = st.localVars[PICK_KEY] as string | undefined;
        delete st.localVars[PICK_KEY];
        // 未选/超时/无效 → 停止(玩家结束选牌)
        if (!pickedId || !available.includes(pickedId)) break;

        // 弃牌堆 → 牌堆顶(deck 末尾)
        await applyAtom(st, {
          type: '移动牌',
          cardId: pickedId,
          from: { zone: '弃牌堆' },
          to: { zone: '牌堆' },
        });
        // 从候选列表中移除(防止重复选)
        const idx = remaining.indexOf(pickedId);
        if (idx >= 0) remaining.splice(idx, 1);

        // 若还有可选,问是否继续
        const rest = remaining.filter((id) => st.zones.discardPile.includes(id));
        if (rest.length === 0) break;

        delete st.localVars[AGAIN_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: AGAIN_RT,
          target: ownerId,
          prompt: {
            type: 'confirm',
            title: `纵玄:是否继续选牌?(剩余 ${rest.length} 张可选)`,
            confirmLabel: '继续',
            cancelLabel: '完成',
          },
          defaultChoice: false,
          timeout: 30,
        });
        if (st.localVars[AGAIN_KEY] !== true) {
          delete st.localVars[AGAIN_KEY];
          break;
        }
        delete st.localVars[AGAIN_KEY];
      }
    } finally {
      await popFrame(st);
    }
  });

  // ── respond action:处理三步回应(confirm / pick / again)──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      if (slot.atom.type !== '请求回应') return '当前不是纵玄窗口';
      const atom = slot.atom as { requestType?: string };
      if (atom.requestType === CONFIRM_RT || atom.requestType === AGAIN_RT) {
        return null;
      }
      if (atom.requestType === PICK_RT) {
        const cardId = params.cardId;
        if (typeof cardId !== 'string') return '需要选择一张牌';
        return null;
      }
      return '当前不是纵玄窗口';
    },
    async (st: GameState, params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      const rt = (slot?.atom as { requestType?: string } | undefined)?.requestType;
      if (rt === CONFIRM_RT) {
        st.localVars[CONFIRM_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === AGAIN_RT) {
        st.localVars[AGAIN_KEY] = params.choice === true || params.confirmed === true;
      } else if (rt === PICK_RT) {
        if (typeof params.cardId === 'string') st.localVars[PICK_KEY] = params.cardId;
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, _api: FrontendAPI): (() => void) | void {
  // 被动技——无主动 action 按钮需要声明
  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
