// 义绝(界关羽·蜀·主动技,OL 界限突破官方逐字):
//   出牌阶段限一次,你可以弃置一张牌,然后令一名其他角色展示一张手牌。若此牌为:
//     黑色,其本回合非锁定技失效且不能使用或打出手牌,你本回合对其使用的红桃【杀】伤害+1;
//     红色,你获得之,然后你可以令其回复1点体力。
//
// 流程(主动技):
//   1. use action:出牌阶段弃置一张手牌(代价) + 指定一名其他有手牌的角色(限一次/回合)
//   2. 目标 respond:从自己手牌中选一张展示(pickProcessingCard 列明目标自己的手牌)
//   3. 引擎 用 展示 atom 公开所选牌(全员可见其牌面)
//   4. 按展示牌颜色分支:
//        黑色(♠/♣):目标加三标签——
//          '义绝/非锁定技失效'(create-engine hook 过滤器读取,跳过目标非锁定技 hook)
//          '义绝/禁出牌'(本技能 before-hook on '请求回应' 读取,cancel 任何要求该目标
//                       使用/打出牌的 prompt;纯选择型 prompt 如 confirm/chooseSuit 不受影响)
//          '义绝/红桃杀加伤'(本技能 before-hook on '造成伤害' 读取,owner 红桃杀+1 伤)
//        红色(♥/♦):发起者获得此牌(移动牌 target→owner),然后询问发起者是否令其回 1 体力
//   5. 回合结束 after-hook:清除所有玩家的义绝标签(本回合生效,回合结束失效)
//
// 关键点:
//   - 每回合限一次:义绝/usedThisTurn(once-per-turn 工具)
//   - "展示一张手牌":目标自己选一张,引擎再通过 展示 atom 公开给全员
//   - 选牌 prompt 注册到每个座次:目标可能是任意玩家(参考反间/界反间模式)
//   - 超时兜底:目标选第一张(不放弃展示机会)
//   - "其本回合...":标签挂目标,owner 回合结束清;owner 的红桃杀+1 伤只对该目标生效
import type {
  AtomBeforeContext,
  AtomOfName,
  Card,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { usedThisTurn, markOncePerTurn, activeUnlessUsedThisTurn } from '../once-per-turn';
import { registerAction, registerAfterHook, registerBeforeHook, hasBlockingPending, type SkillModule } from '../skill';
import { registerSuppressionProvider } from '../skill-suppression';

/** 请求类型:目标展示一张手牌。 */
const REVEAL_REQUEST = '义绝/reveal';
/** 请求类型:发起者选择是否令目标回复 1 点体力。 */
const HEAL_REQUEST = '义绝/heal';
/** localVars:目标展示的 cardId。 */
const REVEAL_KEY = '义绝/revealedCardId';
/** localVars:发起者是否选择回血(choice=true/false)。 */
const HEAL_KEY = '义绝/healChoice';

/** 标签:目标本回合非锁定技失效(create-engine isHookSuppressed 读取)。 */
const SUPPRESSION_TAG = '义绝/非锁定技失效';
/** 标签:目标本回合不能使用或打出手牌(本技能 before-hook on '请求回应' 读取)。 */
const BAN_TAG = '义绝/禁出牌';
/** 标签:owner 本回合对该目标使用的红桃【杀】伤害+1(before-hook on '造成伤害' 读取)。 */
const HEART_BONUS_TAG = '义绝/红桃杀加伤';

/** 义绝打出的所有标签(回合结束统一清理)。 */
const ALL_TAGS = [SUPPRESSION_TAG, BAN_TAG, HEART_BONUS_TAG];

/** 需要打出/使用手牌的 prompt 类型(纯选择型如 confirm/chooseSuit 不在此列)。 */
const CARD_PLAY_PROMPTS = new Set([
  'useCard',
  'useCardAndTarget',
  'pickProcessingCard',
  'pickTargetCard',
  'distribute',
]);

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '义绝',
    description:
      '出牌阶段限一次,弃置一张牌并令一名其他角色展示一张手牌;黑色则其本回合非锁定技失效且不能使用或打出手牌,你对其红桃杀伤害+1;红色则你获得之,然后可令其回1点体力',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── 非锁定技失效 provider:目标持有 SUPPRESSION_TAG 时,其非锁定技 hook 被压制 ──
  //   通过 skill-suppression 扩展点注册,避免引擎核心(create-engine.ts)硬编码技能名/标签。
  const unloadSuppression = registerSuppressionProvider(
    state,
    (st, targetOwnerId, _skillId) =>
      st.players[targetOwnerId]?.tags.includes(SUPPRESSION_TAG) === true,
  );

  // ── use action:出牌阶段弃牌(代价) + 指定目标 ──────────────
  registerAction(
    state,
    skill.id,
    ownerId,
    'use',
    (st: GameState, params: Record<string, Json>) => {
      const self = st.players[ownerId];
      if (!self) return 'player not found';
      if (!self.alive) return '你已死亡';
      if (st.currentPlayerIndex !== ownerId) return '只能在你的回合使用';
      if (st.phase !== '出牌') return '只能在出牌阶段使用';
      if (hasBlockingPending(st)) return '当前有未完成的询问';
      if (usedThisTurn(st, ownerId, '义绝')) return '本回合已使用过义绝';
      // 代价牌:必须在手牌中
      const cardId = params.cardId as string | undefined;
      if (!cardId) return '请选择要弃置的牌';
      if (!self.hand.includes(cardId)) return '弃置的牌必须在手牌中';
      // 目标:其他存活角色且有手牌
      const targets = params.targets as number[] | undefined;
      if (!Array.isArray(targets) || targets.length !== 1) return '需要指定一名目标';
      const target = targets[0];
      if (target === ownerId) return '不能对自己使用义绝';
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive) return '目标不合法';
      if (targetPlayer.hand.length === 0) return '目标没有手牌';
      return null;
    },
    async (st: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const target = (params.targets as number[])[0];
      const costCardId = params.cardId as string;
      await pushFrame(st, '义绝', from, { ...params });

      // 限一次标记:同步设 vars + 回合用量 atom 投影 view(防 dispatch 重入)
      await markOncePerTurn(st, from, '义绝');

      // ── 弃置代价牌 ──
      await applyAtom(st, { type: '弃置', player: from, cardIds: [costCardId] });

      // ── 令目标展示一张手牌(目标自选) ──
      const targetPlayer = st.players[target];
      if (!targetPlayer?.alive || targetPlayer.hand.length === 0) {
        await popFrame(st);
        return;
      }

      const cards = targetPlayer.hand
        .map((id) => {
          const c = st.cardMap[id];
          if (!c) return null;
          return { cardId: id, cardName: c.name, suit: c.suit, rank: c.rank };
        })
        .filter(
          (c): c is { cardId: string; cardName: string; suit: Card['suit']; rank: string } =>
            c !== null,
        );

      delete st.localVars[REVEAL_KEY];
      await applyAtom(st, {
        type: '请求回应',
        requestType: REVEAL_REQUEST,
        target,
        prompt: {
          type: 'pickProcessingCard',
          title: '义绝:选择一张手牌展示',
          cards,
        },
        timeout: 30,
      });

      // 读取目标的选择(超时兜底:选目标手牌第一张,不放弃展示机会)
      let revealedId = st.localVars[REVEAL_KEY] as string | undefined;
      const targetHand = st.players[target]?.hand ?? [];
      if (!revealedId || !targetHand.includes(revealedId)) {
        revealedId = targetHand[0];
      }
      delete st.localVars[REVEAL_KEY];

      const revealedCard = revealedId ? st.cardMap[revealedId] : undefined;
      if (!revealedCard) {
        await popFrame(st);
        return;
      }

      // ── 公开展示的牌(全员可见其牌面)──
      await applyAtom(st, { type: '展示', player: target, cardId: revealedId });

      // ── 按颜色分支 ──
      if (revealedCard.color === '黑') {
        // 黑色:封非锁定技 + 禁出牌 + 红桃杀加伤(标签回合结束统一清)
        await applyAtom(st, { type: '加标签', player: target, tag: SUPPRESSION_TAG });
        await applyAtom(st, { type: '加标签', player: target, tag: BAN_TAG });
        await applyAtom(st, { type: '加标签', player: target, tag: HEART_BONUS_TAG });
      } else {
        // 红色:发起者获得此牌(移动牌 target→owner)
        await applyAtom(st, {
          type: '移动牌',
          cardId: revealedId,
          from: { zone: '手牌', player: target },
          to: { zone: '手牌', player: from },
        });

        // 询问发起者是否令其回复 1 点体力
        delete st.localVars[HEAL_KEY];
        await applyAtom(st, {
          type: '请求回应',
          requestType: HEAL_REQUEST,
          target: from,
          prompt: {
            type: 'confirm',
            title: `义绝:是否令 ${st.players[target]?.name ?? '目标'} 回复1点体力?`,
            confirmLabel: '回复',
            cancelLabel: '不回复',
          },
          defaultChoice: false,
          timeout: 15,
        });

        if (st.localVars[HEAL_KEY] === true) {
          const tp = st.players[target];
          // 仅存活且未满血时回血(回复体力 atom 自带上限校验,这里跳过满血情况避免无意义结算)
          if (tp?.alive && tp.health < tp.maxHealth) {
            await applyAtom(st, { type: '回复体力', target, amount: 1, source: from });
          }
        }
        delete st.localVars[HEAL_KEY];
      }

      await popFrame(st);
    },
  );

  // ── respond:处理两种 requestType(reveal 由目标座次回应,heal 由发起者座次回应)
  //    为每个座次注册独立闭包,以 skillId='义绝' 隔离,不与其他技能 respond 冲突。
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const seatId = p.index;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as Record<string, unknown>;
        if (atom['type'] !== '请求回应') return '当前不需要回应';
        const reqType = atom['requestType'] as string | undefined;
        if (reqType === REVEAL_REQUEST) {
          // 目标展示一张手牌:cardId 必须在自己的手牌中
          const cardId = params.cardId as string | undefined;
          if (!cardId) return '请选择一张手牌展示';
          if (!st.players[seatId].hand.includes(cardId)) return '牌不在手牌中';
          return null;
        }
        if (reqType === HEAL_REQUEST) {
          // 发起者选择是否回血:choice 必须是布尔
          if (typeof params.choice !== 'boolean') return '需要选择一项';
          return null;
        }
        return '当前不是义绝回应';
      },
      async (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        const reqType = (slot?.atom as { requestType?: string } | undefined)?.requestType;
        if (reqType === REVEAL_REQUEST) {
          st.localVars[REVEAL_KEY] = params.cardId as string;
        } else if (reqType === HEAL_REQUEST) {
          st.localVars[HEAL_KEY] = params.choice === true;
        }
      },
    );
    unloaders.push(u);
  }

  // ── before-hook:禁出牌目标不能使用/打出手牌 ──
  //    覆盖三种出牌 prompt atom:'请求回应'(无瓣/拼点选牌等)、'询问闪'、'询问杀'。
  //    命中条件:atom.target 是有 BAN_TAG 的玩家 + prompt 需要打牌(useCard/pick* 等);
  //    纯选择型 prompt(confirm/chooseSuit/selectTarget/choosePlayer/chooseCharacter)不拦,
  //    以保证目标仍可处理非出牌选择。cancel 后该 atom 不再创建 pending,等同于目标不出牌。
  const banHandler = async (ctx: AtomBeforeContext<AtomOfName<'请求回应' | '询问闪' | '询问杀'>>): Promise<HookResult | void> => {
    const atom = ctx.atom;
    const target = atom.target;
    if (typeof target !== 'number' || target < 0) return; // 广播型(无瓣等)不在此处理
    if (target === ownerId) return; // 发起者自己不受禁出牌影响
    const player = ctx.state.players[target];
    if (!player?.tags.includes(BAN_TAG)) return;
    // 询问闪 / 询问杀 是独立 atom 类型,其 prompt 内置于 atom 定义(useCard型)——按类型判定即可。
    if (atom.type === '询问闪' || atom.type === '询问杀') {
      return { kind: 'cancel' };
    }
    // 请求回应:看 prompt.type 是否要求出牌
    const promptType = atom.prompt?.type;
    if (promptType && CARD_PLAY_PROMPTS.has(promptType)) {
      return { kind: 'cancel' };
    }
    return;
  };
  registerBeforeHook(state, skill.id, ownerId, '请求回应', banHandler);
  registerBeforeHook(state, skill.id, ownerId, '询问闪', banHandler);
  registerBeforeHook(state, skill.id, ownerId, '询问杀', banHandler);

  // ── before-hook on '造成伤害':owner 红桃杀对该目标伤害+1 ──
  //    命中条件:atom.source === ownerId + 目标有 HEART_BONUS_TAG + 牌为红桃杀;
  //    单次消费(去标签),保证同一杀只+1,且只对该义绝生效。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '造成伤害时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.source !== ownerId) return;
      if ((atom.amount ?? 0) <= 0) return;
      const target = atom.target;
      if (target === undefined) return;
      const cardId = atom.cardId;
      if (typeof cardId !== 'string') return;
      const card = ctx.state.cardMap[cardId];
      if (!card || card.name !== '杀' || card.suit !== '♥') return;
      const player = ctx.state.players[target];
      if (!player?.tags.includes(HEART_BONUS_TAG)) return;
      await applyAtom(ctx.state, { type: '去标签', player: target, tag: HEART_BONUS_TAG });
      return {
        kind: 'modify',
        atom: { ...ctx.atom, amount: (atom.amount ?? 0) + 1 } as typeof ctx.atom,
      };
    },
  );

  // ── after-hook on '回合结束':清除所有玩家的义绝标签 ──
  //    仅 owner 自己的回合结束触发(义绝在 owner 回合使用,效果绑本回合)。
  registerAfterHook(state, skill.id, ownerId, '回合结束', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    for (const p of ctx.state.players) {
      for (const tag of ALL_TAGS) {
        if (p.tags.includes(tag)) {
          await applyAtom(ctx.state, { type: '去标签', player: p.index, tag });
        }
      }
    }
  });

  return () => {
    unloaders.forEach((u) => u());
    unloadSuppression();
  };
}

export function onMount(skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('use', {
    label: '义绝',
    style: 'danger',
    prompt: {
      type: 'useCardAndTarget',
      title: '义绝:弃置一张牌,令一名其他角色展示一张手牌',
      cardFilter: { min: 1, max: 1 },
      targetFilter: {
        min: 1,
        max: 1,
        filter: (view, t) => t !== skill.ownerId && (view.players[t]?.handCount ?? 0) > 0,
      },
    },
    activeWhen: (ctx) => {
      if (!activeUnlessUsedThisTurn('义绝')(ctx)) return false;
      const p = ctx.view.players[ctx.perspectiveIdx];
      if (!p) return false;
      // 需要有手牌作为代价,且存在有手牌的其他存活角色
      const hasHand = (p.hand?.length ?? 0) > 0;
      if (!hasHand) return false;
      const hasTarget = ctx.view.players.some(
        (other) => other.index !== skill.ownerId && other.alive && (other.handCount ?? 0) > 0,
      );
      return hasTarget;
    },
  });

  api.defineAction('respond', {
    label: '义绝',
    style: 'danger',
    prompt: {
      type: 'pickProcessingCard',
      title: '义绝:选择一张手牌展示',
      cards: [],
    },
  });

  return () => {};
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
