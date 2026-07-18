// 行殇(曹丕·被动技):当其他角色死亡时,你可以立即获得其所有牌(手牌、装备牌、判定区牌)。
//
// 模式 A(被动触发):before hook 挂在「击杀」。
//   击杀 before(死亡角色≠曹丕自己且曹丕存活) → 询问是否发动 →
//   获得手牌/装备/判定区的所有牌 → 击杀 apply 继续执行(hand/equip 已空,no-op)。
//
// 关键点:
//   - 击杀 atom 自身会把死亡角色的手牌/装备移入弃牌堆,但不会处理判定区(pendingTricks)。
//     行殇在 before hook 中先把所有牌拿走,使后续 击杀 apply 的 card-loop 成为 no-op。
//   - 卡牌转移统一走「获得」atom:它对 hand/equipment 做 filter 移除(no-op 若不存在),
//     再 push 到获得者手牌;判定区牌的 pendingTricks 维护通过「移除延时锦囊」atom 完成。
//   - FAQ:行殇是主动发动,可选择不获得(请求回应 confirm)。
import type {
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerBeforeHook } from '../skill';

const CONFIRM_RT = '行殇/confirm';
const CONFIRMED_KEY = '行殇/confirmed';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '行殇',
    description: '当其他角色死亡时,你可以获得其所有牌(手牌/装备/判定区)',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:曹丕回应是否发动行殇 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (st: GameState, _params: Record<string, Json>) => {
      const slot = st.pendingSlots.get(ownerId);
      if (!slot) return '当前不需要回应';
      const atom = slot.atom as Record<string, unknown>;
      if (atom['type'] !== '请求回应') return '当前不需要回应';
      if (atom['requestType'] !== CONFIRM_RT) return '当前不是行殇确认';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 击杀 before hook:死亡角色所有牌转移给曹丕 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '击杀',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number };
      if (atom.type !== '击杀') return;
      const deadIdx = atom.player;
      if (deadIdx === undefined) return;
      if (deadIdx === ownerId) return; // 自己死亡不触发
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return; // 曹丕需存活
      const dead = ctx.state.players[deadIdx];
      if (!dead) return;

      // 收集死亡角色的所有牌(快照,避免转移过程中数组变动)
      const handCards = [...dead.hand];
      const equipCards = Object.values(dead.equipment).filter(
        (id): id is string => typeof id === 'string',
      );
      const judgeCards = dead.pendingTricks.map((t) => ({
        trickName: t.name,
        cardId: t.card.id,
      }));
      const total = handCards.length + equipCards.length + judgeCards.length;
      if (total === 0) return; // 无牌可拿,不触发

      // 询问是否发动(FAQ:行殇主动发动,可不发动)
      delete ctx.state.localVars[CONFIRMED_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: CONFIRM_RT,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: `是否发动行殇?(从 P${deadIdx} 获得 ${total} 张牌)`,
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (!ctx.state.localVars[CONFIRMED_KEY]) return;

      // 转移所有牌:
      //   - 手牌:获得 atom 直接处理(hand filter + push)
      //   - 装备:获得 atom 直接处理(equipment filter + push)
      //   - 判定区:先移除延时锦囊(从 pendingTricks 清除),再获得 atom push 到手牌
      //     (此时 cardId 已不在 hand/equip,获得 的 filter 为 no-op,只 push)
      for (const cardId of handCards) {
        await applyAtom(ctx.state, {
          type: '获得',
          player: ownerId,
          cardId,
          from: deadIdx,
        });
      }
      for (const cardId of equipCards) {
        await applyAtom(ctx.state, {
          type: '获得',
          player: ownerId,
          cardId,
          from: deadIdx,
        });
      }
      for (const { trickName, cardId } of judgeCards) {
        await applyAtom(ctx.state, {
          type: '移除延时锦囊',
          player: deadIdx,
          trickName,
        });
        await applyAtom(ctx.state, {
          type: '获得',
          player: ownerId,
          cardId,
          from: deadIdx,
        });
      }

      // 不 cancel:让击杀 apply 正常执行(alive=false + hand/equip 已空,no-op card loop)
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '行殇',
    style: 'primary',
    prompt: {
      type: 'confirm',
      title: '是否发动行殇?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
