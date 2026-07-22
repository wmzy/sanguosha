// 界暴虐(界董卓·主公技,OL 界限突破官方逐字):
//   主公技,当其他群势力角色造成1点伤害后,你可以判定,
//   若结果为黑桃,你回复1点体力并获得此判定牌。
//
// 与标版区别:
//   1. 触发条件:"造成1点伤害后"(标版为"造成伤害后")。本实现按字面解读为 amount===1
//      (即仅当该次伤害实例正好为 1 点时触发);2 点及以上伤害实例不触发。
//      [实现差异/边界] 官方详细规则可能按"每点伤害一次"结算,引擎以单 atom 模型
//      无法天然支持,此处采用字面 amount===1 解读。
//   2. 决策权:"你可以判定"(标版为"其可以令你判定")。两者最终都是问董卓是否判定,
//      实现一致。
//   3. 结算效果:黑桃 → 回复1点体力 **并获得此判定牌**(标版仅回复体力)。
//
// 关键时序(获得判定牌):
//   - 判定 atom 的 def.afterHooks 直接 mutate state.zones.discardPile.push(judgeCard)
//     (不经过 移动牌 atom,故无法用 移动牌 after-hook 拦截)。
//   - 判定 atom 的 toViewEvents.applyView 无条件 discardPileCount += 1
//     (假设判定牌最终入弃牌堆)。
//   - 若在判定 atom 的 runAfterHooks 阶段(即 判定 after-hook 内)直接移动判定牌
//     (处理区→手牌),会导致状态与视图不一致:state 中弃牌堆未增加,但 view 已 +1。
//   - 解决:不在 判定 上挂 after-hook,而是在 造成伤害 after-hook 内 await 判定
//     完成后(此时 def.afterHooks 已执行,判定牌已在 discardPile 末尾,视图一致),
//     再通过 移动牌 atom(弃牌堆→手牌)拿走。移动牌的 applyView 会同时减 discardPileCount
//     和加 handCount,保持视图一致。
//
// 模式 A(被动触发):单个 after hook on '造成伤害'。
//   造成 1 点伤害 → 询问董卓是否判定 → 判定 → 若黑桃 → 回复 + 移动牌(弃牌堆→手牌)
//
// 关键点:
//   - 仅主公董卓可用(identity==='主公');非主公时 hook 注册但不触发
//   - "其他群雄角色":source≠自己 + source.faction==='群'
//   - 系统伤害(source<0,如闪电)不触发
//   - "1点伤害":atom.amount === 1(字面解读)
//   - 黑桃 = ♠
//   - 获得判定牌:在 await applyAtom(判定) 完成后,从 discardPile 末尾拿
import type { FrontendAPI, GameState, Json, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook } from '../skill';

const CONFIRM_RT = '暴虐/confirm';
const CONFIRMED_KEY = '暴虐/confirmed';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '暴虐',
    description:
      '主公技:其他群势力角色造成1点伤害后可判定,黑桃则回复1点体力并获得此判定牌',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:董卓回应是否发动暴虐判定 ──
  registerAction(
    state,
    skill.id,
    ownerId,
    'respond',
    (s: GameState, _params: Record<string, Json>) => {
      const slot = s.pendingSlots.get(ownerId);
      if (slot?.atom.type !== '请求回应') return '当前不需要回应';
      const rt = (slot.atom as unknown as { requestType?: string }).requestType;
      if (rt !== CONFIRM_RT) return '当前不是暴虐确认';
      return null;
    },
    async (s: GameState, params: Record<string, Json>) => {
      s.localVars[CONFIRMED_KEY] = params.choice === true || params.confirmed === true;
    },
  );

  // ── 造成伤害 after:其他群雄角色造成 1 点伤害 → 询问 → 判定 → 黑桃则回复+获牌 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx) => {
    const atom = ctx.atom;
    if (atom.type !== '造成伤害') return;

    // 仅主公董卓可用
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    if (self.identity !== '主公') return;

    // 界版限定:造成 **1 点** 伤害后(字面解读)
    if (atom.amount !== 1) return;

    const sourceIdx = atom.source;
    if (typeof sourceIdx !== 'number') return;
    if (sourceIdx === ownerId) return; // 自己造成的伤害不触发
    if (sourceIdx < 0) return; // 系统伤害(闪电等)不触发

    const source = ctx.state.players[sourceIdx];
    if (!source?.alive) return;
    if (source.faction !== '群') return; // 仅群雄角色

    // 询问是否判定
    delete ctx.state.localVars[CONFIRMED_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: CONFIRM_RT,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: `暴虐:${source.name} 造成 1 点伤害,是否进行判定?(黑桃回复1点体力并获得判定牌)`,
        confirmLabel: '判定',
        cancelLabel: '不判定',
      },
      defaultChoice: false,
      timeout: 10,
    });

    if (!ctx.state.localVars[CONFIRMED_KEY]) return;

    // 记录判定前 discardPile 长度,以便定位判定牌(判定 atom 完成后 push 到末尾)
    const discardLenBefore = ctx.state.zones.discardPile.length;

    // 进行判定(await 完成后,判定牌已入 discardPile 末尾,视图一致)
    await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '暴虐' });

    // 读判定结果:判定 atom 的 def.afterHooks 把判定牌 push 到 discardPile 末尾
    const discard = ctx.state.zones.discardPile;
    if (discard.length <= discardLenBefore) return; // 判定未发生(牌堆空)
    const judgeCardId = discard[discard.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    // 非黑桃不回复/不获得
    if (judgeCard.suit !== '♠') return;

    // 黑桃 → 回复1点体力
    await applyAtom(ctx.state, { type: '回复体力', target: ownerId, amount: 1 });

    // 获得此判定牌:从弃牌堆移入手牌。
    // 此时判定 atom 已完成,视图已记录 discardPile+1;
    // 此 移动牌 atom 的 applyView 会同时 discardPileCount-1 + handCount+1,保持视图一致。
    await applyAtom(ctx.state, {
      type: '移动牌',
      cardId: judgeCardId,
      from: { zone: '弃牌堆' },
      to: { zone: '手牌', player: ownerId },
    });
  });

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '暴虐',
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动暴虐?(判定,黑桃回复1点体力并获得判定牌)',
      confirmLabel: '判定',
      cancelLabel: '不发动',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
