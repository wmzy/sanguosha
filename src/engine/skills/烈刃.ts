// 烈刃(祝融·被动技):每当你使用【杀】造成伤害后,可与受伤害的角色拼点:
//   若你赢,你获得对方的一张牌。
//
// 分析(步骤1):
//   类型:被动技 | 时机:造成伤害 after-hook(source===ownerId 且 cardId 是杀)
//   流程:
//     1. 请求回应(confirm):是否发动烈刃(target=owner)
//     2. 发动 → 双方各选一张手牌拼点:
//        a. 请求回应(useCard):owner 选自己的拼点牌
//        b. 请求回应(useCard):受害者选拼点牌
//        c. runRankCompareFlow(扣置→亮出→后→弃牌堆,两张牌面朝下同时扣置)
//     3. 拼点赢(owner 点数 > 受害者)→ 获得 受害者一张牌(手牌盲取随机,其次装备)
//     4. 没赢(输或平)→ 无事发生
//   限制:无次数限制;拼点需双方都有手牌,任一方无手牌则不发动
//
//   关键:
//   - 受害者可能是任意玩家,需为所有玩家注册 respond(confirm/选牌)
//   - 拼点点数:A=1, 2-10=面值, J=11, Q=12, K=13;大者赢,相等算没赢
//   - 拼点流程参考驱虎.ts;获得牌参考反馈.ts
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../core/apply'
import { popFrame, pushFrame } from '../core/frame';
import { askRankCard, runRankCompareOrForfeit } from '../flows/rank';
import { registerAction, registerAfterHook } from '../core/skill';
import { createRng } from '../util/rng';

const CONFIRM_RT = '烈刃/confirm';
const CONFIRMED_KEY = '烈刃/confirmed';
const OWNER_PD_RT = '烈刃/选牌';
const OWNER_CARD_KEY = '烈刃/ownerCard';
const VICTIM_PD_RT = '烈刃/拼点';
const VICTIM_CARD_KEY = '烈刃/victimCard';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '烈刃',
    description: '使用杀造成伤害后,可与受害者拼点,赢则获得对方一张牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond(注册到所有玩家):owner 确认发动 / owner 选拼点牌 / 受害者 选拼点牌 ──
  // dispatch 按 (skillId, ownerId, actionType) 查;受害者可能是任意玩家。
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
        const reqType = atom['requestType'] as string;
        if (reqType === CONFIRM_RT) {
          // 仅祝融确认发动
          if (seatId !== ownerId) return '只有祝融可以确认';
          return null;
        }
        if (reqType === OWNER_PD_RT) {
          // 仅祝融选自己的拼点牌
          if (seatId !== ownerId) return '只有祝融可以选择拼点牌';
          const cardId = params.cardId as string;
          if (typeof cardId !== 'string') return '请选择一张拼点牌';
          if (!st.players[seatId].hand.includes(cardId)) return '拼点牌不在手牌中';
          return null;
        }
        if (reqType === VICTIM_PD_RT) {
          // 受害者选拼点牌
          const cardId = params.cardId as string;
          if (typeof cardId !== 'string') return '请选择一张拼点牌';
          if (!st.players[seatId].hand.includes(cardId)) return '拼点牌不在手牌中';
          return null;
        }
        return '当前不是烈刃回应';
      },
      async (st: GameState, params: Record<string, Json>): Promise<void> => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return;
        const atom = slot.atom as Record<string, unknown>;
        const reqType = atom['requestType'] as string;
        if (reqType === CONFIRM_RT) {
          st.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
        } else if (reqType === OWNER_PD_RT) {
          st.localVars[OWNER_CARD_KEY] = params.cardId;
        } else if (reqType === VICTIM_PD_RT) {
          st.localVars[VICTIM_CARD_KEY] = params.cardId;
        }
      },
    );
    unloaders.push(u);
  }

  // ── 造成伤害 after-hook:烈刃主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (atom.target === undefined || atom.target === ownerId) return;
    // 仅杀造成的伤害
    const dmgCardId = atom.cardId;
    if (!dmgCardId) return;
    const dmgCard = ctx.state.cardMap[dmgCardId];
    if (dmgCard?.name !== '杀') return;

    const victim = atom.target;
    const victimPlayer = ctx.state.players[victim];
    if (!victimPlayer?.alive) return;

    // 拼点需双方都有手牌,任一方无手牌则不发动
    const ownerPlayer = ctx.state.players[ownerId];
    if (!ownerPlayer || ownerPlayer.hand.length === 0) return;
    if (victimPlayer.hand.length === 0) return;

    // 1. 询问是否发动烈刃
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `是否发动烈刃,与 ${victimPlayer.name} 拼点?`,
        confirmLabel: '发动',
        cancelLabel: '不发动',
      },
      defaultChoice: false,
      timeout: 15,
    });
    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    // 再校验双方手牌(发动期间可能变化)
    if (ctx.state.players[ownerId].hand.length === 0) return;
    if (ctx.state.players[victim].hand.length === 0) return;

    // 2a. owner 选拼点牌(询问封装于 flows/rank.askRankCard)
    const ownerCardId = await askRankCard(ctx.state, {
      requestType: OWNER_PD_RT,
      answerKey: OWNER_CARD_KEY,
      target: ownerId,
      title: '烈刃:请选择一张拼点牌',
      timeout: 30,
    });
    if (!ownerCardId) return;

    // 2b. 受害者 选拼点牌(询问封装于 flows/rank.askRankCard)
    const victimCardId = await askRankCard(ctx.state, {
      requestType: VICTIM_PD_RT,
      answerKey: VICTIM_CARD_KEY,
      target: victim,
      title: `烈刃:与 ${ctx.state.players[ownerId].name} 拼点,请出一张手牌`,
      timeout: 30,
    });

    // 2c-f. 拼点两步化(扣置→亮出→后→弃牌堆):runRankCompareFlow 内部由
    //   拼点扣置 统一同时扣置两张牌(面朝下),不再预先移入处理区。
    //   结算帧入栈位置须保持在询问与比点之间,故拆用 askRankCard + runRankCompareOrForfeit。
    await pushFrame(ctx.state, '烈刃', ownerId, { victim });

    // 受害者拼点牌(若出了)——拼点两步化。未出牌(超时)走弃权兜底
    // (清理 owner 拼点牌,按 owner 默认胜出),封装于 flows/rank.runRankCompareOrForfeit。
    const win = await runRankCompareOrForfeit(
      ctx.state,
      ownerId,
      victim,
      ownerCardId,
      victimCardId,
    );

    await popFrame(ctx.state);

    // 3. 结算输赢:owner 赢 → 获得 受害者一张牌(手牌对使用者不可见,seed RNG 盲取;
    //    固定取首张 = 可被对手按手牌排列利用的确定性策略,与突袭/界突袭范式不一致)
    if (!win) return;
    const target = ctx.state.players[victim];
    if (!target) return;
    if (target.hand.length > 0) {
      const rng = createRng(ctx.state.rngSeed);
      const cardId = target.hand[rng.nextInt(target.hand.length)];
      ctx.state.rngSeed = rng.getState();
      await applyAtom(ctx.state, { type: '获得', player: ownerId, cardId, from: victim });
    } else {
      const equipSlot = Object.keys(target.equipment)[0] as keyof typeof target.equipment;
      if (equipSlot) {
        const cardId = target.equipment[equipSlot];
        if (cardId) {
          await applyAtom(ctx.state, { type: '获得', player: ownerId, cardId, from: victim });
        }
      }
    }
  });

  return () => {
    unloaders.forEach((u) => u());
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: '烈刃',
    style: 'danger',
    prompt: {
      type: 'confirm',
      title: '是否发动烈刃?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
