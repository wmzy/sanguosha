// 界眩惑(界法正·蜀·主动技,OL 界限突破 hero/610 官方逐字):
//   摸牌阶段结束时,你可以交给一名其他角色两张牌,令其选择一项:
//   1.对你指定的另一名角色使用一张【杀】;
//   2.你观看其手牌并获得其两张牌。
//
// 与标版法正(标版未实现,此处为界版独立实现)差异:
//   - 标版: 摸牌阶段"改为"令其摸两张(替代正常摸牌) → 选项 1 限"其攻击范围内"
//           → 选项 2 仅"获得两张牌"(无观看)
//   - 界版: 摸牌阶段"结束后"(额外触发,保留正常摸牌 2 张) → 法正"交给"两张(从自己手牌)
//           → 选项 1 去掉"攻击范围内"限制 → 选项 2 多"观看其手牌"
//
// 实现:
//   - 阶段结束(摸牌) after-hook: 自己回合 + 自己摸牌阶段结束 + 存活 + 手牌≥2 + 有其他存活角色
//     → 询问是否发动 → 选目标 X (其他存活角色) → 选 2 张手牌交给 X
//     → X 选择 1 或 2:
//       · 1: 法正指定 Y(≠X 的存活角色) → X 从手牌出杀对 Y(走完整 杀 结算,无距离限制;
//         不计出杀次数: 回合外触发,与 杀/quota 无关)
//       · 2: 法正观看 X 手牌 → 法正从中选 2 张获得(经 获得 atom)
//   - 选项前置检查: X 无杀则不可选 1;X 手牌<2 则不可选 2;两者皆不可则不询问 X 直接结束。
//
// respond 路由: 法正询问走法正座次的 respond;X 询问(X 选 1/2、X 出杀)需在 X 座次注册
//   respond。故 onInit 遍历所有座次注册(同 刚烈/护驾/激将 模式)。
//
// 命名:文件名/loader key/character skill name 均为 '界眩惑'(避开与未来标版冲突);
//   内部 Skill.name = '眩惑'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameView,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame, frameCards } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

const SKILL_ID = '界眩惑';
const DISPLAY_NAME = '眩惑';

// localVars 键(法正侧)
const TRIGGER_KEY = `${SKILL_ID}/triggered`; // confirm: 是否发动
const TARGET_KEY = `${SKILL_ID}/target`; // X: 接收两张牌的角色
const CARDS_KEY = `${SKILL_ID}/cards`; // 法正交给 X 的两张牌 cardId[]
const VICTIM_KEY = `${SKILL_ID}/victim`; // Y: 选项 1 法正指定的杀目标
const PICK_KEY = `${SKILL_ID}/pickHand`; // 选项 2 法正选的卡 cardId
// localVars 键(X 侧)
const XCHOICE_KEY = `${SKILL_ID}/xchoice`; // X 的选择: 'kill' | 'gain'
const SLASH_KEY = `${SKILL_ID}/slashCardId`; // X 选的杀牌 cardId

// 询问 requestType
const RT_TRIGGER = `${SKILL_ID}/trigger`; // 法正 confirm 是否发动
const RT_TARGET = `${SKILL_ID}/pickTarget`; // 法正 choosePlayer X
const RT_CARDS = `${SKILL_ID}/pickCards`; // 法正 distribute select 2 own cards
const RT_VICTIM = `${SKILL_ID}/pickVictim`; // 法正 choosePlayer Y
const RT_PICK0 = `${SKILL_ID}/pickHand0`; // 法正 pickTargetCard 第 1 张
const RT_PICK1 = `${SKILL_ID}/pickHand1`; // 法正 pickTargetCard 第 2 张
const RT_XCHOICE = `${SKILL_ID}/xchoice`; // X confirm 选 1/2
const RT_SLASH = `${SKILL_ID}/pickSlash`; // X useCard 选杀

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '摸牌阶段结束时,交给一名其他角色两张牌,令其选:①对你指定的另一名角色出杀;②你观看其手牌并获得两张',
  };
}

/** X 手牌中是否有【杀】 */
function hasKillInHand(state: GameState, player: number): boolean {
  const hand = state.players[player]?.hand ?? [];
  return hand.some((id) => state.cardMap[id]?.name === '杀');
}

/** X 是否能选 选项 1(出杀):X 手牌有杀 且 存在另一名存活角色 Y(≠X) */
function canOptionKill(state: GameState, x: number): boolean {
  if (!hasKillInHand(state, x)) return false;
  return state.players.some((p) => p.alive && p.index !== x);
}

/** X 是否能选 选项 2(被获得):X 手牌至少 2 张 */
function canOptionGain(state: GameState, x: number): boolean {
  return (state.players[x]?.hand.length ?? 0) >= 2;
}

/**
 * 执行一次【杀】结算(镜像 界诛害.runSlashResolution):
 * 指定目标→成为目标→检测有效性→询问闪→伤害/抵消→收尾。
 * 真实杀牌:手牌→处理区→(结算末尾)弃牌堆。不计出杀次数(回合外触发)。
 * 无距离限制(眩惑特例)。
 */
async function runSlashResolution(
  state: GameState,
  source: number,
  target: number,
  cardId: string,
): Promise<void> {
  if (!state.players[target]?.alive) return;
  const damageType = state.cardMap[cardId]?.damageType;
  await pushFrame(state, SKILL_ID, source, { target, cardId });
  try {
    await applyAtom(state, {
      type: '移动牌',
      cardId,
      from: { zone: '手牌', player: source },
      to: { zone: '处理区' },
    });
    await applyAtom(state, { type: '指定目标', source, target, cardId });
    const becameTarget = await applyAtom(state, {
      type: '成为目标',
      source,
      target,
      cardId,
    });
    if (!becameTarget) return;
    const valid = await applyAtom(state, {
      type: '检测有效性',
      source,
      target,
      cardId,
    });
    if (!valid) return;
    await applyAtom(state, { type: '询问闪', target, source });
    const dodgeIds = frameCards(state).filter((id) => state.cardMap[id]?.name === '闪');
    if (dodgeIds.length > 0) {
      await applyAtom(state, { type: '被抵消', source, target, cardId });
      for (const dId of dodgeIds) {
        await applyAtom(state, {
          type: '移动牌',
          cardId: dId,
          from: { zone: '处理区' },
          to: { zone: '弃牌堆' },
        });
      }
    } else if (state.players[target]?.alive) {
      await applyAtom(state, {
        type: '造成伤害',
        target,
        amount: 1,
        source,
        cardId,
        damageType,
      });
    }
  } finally {
    if (frameCards(state).includes(cardId)) {
      await applyAtom(state, {
        type: '移动牌',
        cardId,
        from: { zone: '处理区' },
        to: { zone: '弃牌堆' },
      });
    }
    await popFrame(state);
  }
}

/** 选项 1 流程:法正指定 Y → X 出杀对 Y */
async function runOptionKill(
  state: GameState,
  ownerId: number,
  X: number,
): Promise<void> {
  // 法正选 Y (≠X 的存活角色,可为法正自己)
  delete state.localVars[VICTIM_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: RT_VICTIM,
    target: ownerId,
    prompt: {
      type: 'choosePlayer',
      title: '眩惑:指定 X 出杀的目标 Y(可为法正自己)',
      min: 1,
      max: 1,
      filter: (view: GameView, target: number) =>
        target !== X && view.players[target]?.alive === true,
    },
    timeout: 15,
  });
  const Y = state.localVars[VICTIM_KEY] as number;
  if (typeof Y !== 'number' || Y < 0 || !state.players[Y]?.alive) return;

  // X 选一张杀
  delete state.localVars[SLASH_KEY];
  await applyAtom(state, {
    type: '请求回应',
    requestType: RT_SLASH,
    target: X,
    prompt: {
      type: 'useCard',
      title: '眩惑:选择一张【杀】使用',
      cardFilter: { filter: (c) => c.name === '杀', min: 1, max: 1 },
    },
    timeout: 15,
  });
  const slashId = state.localVars[SLASH_KEY] as string;
  if (typeof slashId !== 'string' || !state.players[X]?.hand.includes(slashId)) return;

  await runSlashResolution(state, X, Y, slashId);
}

/** 选项 2 流程:法正观看 X 手牌 → 选 2 张获得 */
async function runOptionGain(
  state: GameState,
  ownerId: number,
  X: number,
): Promise<void> {
  const xp = state.players[X];
  if (!xp || xp.hand.length < 2) return;
  for (let i = 0; i < 2; i++) {
    if (xp.hand.length === 0) break;
    const rtKey = `${PICK_KEY}${i}`;
    delete state.localVars[rtKey];
    const rt = i === 0 ? RT_PICK0 : RT_PICK1;
    await applyAtom(state, {
      type: '请求回应',
      requestType: rt,
      target: ownerId,
      prompt: {
        type: 'pickTargetCard',
        title: `眩惑:观看 X 手牌,选第 ${i + 1} 张获得`,
        target: X,
        equipment: xp.hand.map((id, idx) => ({
          slot: `hand-${idx}`,
          cardId: id,
          cardName: state.cardMap[id]?.name ?? '?',
        })),
        judge: [],
        handCount: 0,
      },
      timeout: 20,
    });
    const picked = state.localVars[rtKey] as string | undefined;
    if (typeof picked === 'string' && xp.hand.includes(picked)) {
      await applyAtom(state, {
        type: '获得',
        player: ownerId,
        cardId: picked,
        from: X,
      });
    }
  }
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── 所有座次统一注册一个 respond —— 同一 (skillId, ownerId, actionType)
  //    只能注册一个 entry(Map.set 会覆盖),故按是否 ownerId 分支处理不同的 RT 集。
  //    · 法正座次:trigger/target/cards/victim/pickHand0/pickHand1
  //    · 所有座次(含法正):X 选 1/2、X 选杀(每个座次都可能成为 X)──
  for (const p of state.players) {
    const seatId = p.index;
    const isOwner = seatId === ownerId;
    registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (s) => {
        const slot = s.pendingSlots.get(seatId);
        if (!slot || slot.atom.type !== '请求回应') return '当前不需要回应';
        const rt = (slot.atom as unknown as { requestType?: string }).requestType ?? '';
        // 法正侧 RT
        const ownerRTs = [RT_TRIGGER, RT_TARGET, RT_CARDS, RT_VICTIM, RT_PICK0, RT_PICK1];
        // X 侧 RT(任何座次都可能成为 X)
        const xRTs = [RT_XCHOICE, RT_SLASH];
        if (isOwner && ownerRTs.includes(rt)) return null;
        if (xRTs.includes(rt)) return null;
        return '当前不是眩惑询问';
      },
      async (s, params) => {
        const slot = s.pendingSlots.get(seatId);
        const rt = (slot?.atom as unknown as { requestType?: string } | undefined)?.requestType;
        if (rt === RT_TRIGGER) {
          s.localVars[TRIGGER_KEY] = params.choice === true;
        } else if (rt === RT_TARGET) {
          const t = typeof params.target === 'number' ? params.target : undefined;
          const arr = Array.isArray(params.targets) ? (params.targets as number[]) : undefined;
          s.localVars[TARGET_KEY] = t ?? arr?.[0] ?? -1;
        } else if (rt === RT_CARDS) {
          const ids = params.cardIds as string[] | undefined;
          s.localVars[CARDS_KEY] = Array.isArray(ids) ? ids : [];
        } else if (rt === RT_VICTIM) {
          const t = typeof params.target === 'number' ? params.target : undefined;
          const arr = Array.isArray(params.targets) ? (params.targets as number[]) : undefined;
          s.localVars[VICTIM_KEY] = t ?? arr?.[0] ?? -1;
        } else if (rt === RT_PICK0 || rt === RT_PICK1) {
          // 法正选 X 手牌中的具体 cardId(prompt.equipment 已暴露 cardId)
          const cardId = typeof params.cardId === 'string' ? params.cardId : '';
          s.localVars[`${PICK_KEY}${rt === RT_PICK0 ? 0 : 1}`] = cardId;
        } else if (rt === RT_XCHOICE) {
          // choice=true → 选项 1(出杀);choice=false → 选项 2(被获得)
          s.localVars[XCHOICE_KEY] = params.choice === true ? 'kill' : 'gain';
        } else if (rt === RT_SLASH) {
          const cardId = typeof params.cardId === 'string' ? params.cardId : '';
          s.localVars[SLASH_KEY] = cardId;
        }
      },
    );
  }

  // ── 阶段结束(摸牌) after-hook:法正回合的摸牌阶段结束时发动 ──
  registerAfterHook(
    state,
    skill.id,
    ownerId,
    '阶段结束',
    async (ctx) => {
      const atom = ctx.atom;
      if (atom.phase !== '摸牌') return;
      if (atom.player !== ownerId) return;
      if (ctx.state.currentPlayerIndex !== ownerId) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;
      if (self.hand.length < 2) return;
      const hasOther = ctx.state.players.some((p) => p.alive && p.index !== ownerId);
      if (!hasOther) return;

      // 1. 询问是否发动
      delete ctx.state.localVars[TRIGGER_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: RT_TRIGGER,
        target: ownerId,
        prompt: {
          type: 'confirm',
          title: '是否发动眩惑?(交给一名其他角色两张牌)',
          confirmLabel: '发动',
          cancelLabel: '不发动',
        },
        defaultChoice: false,
        timeout: 10,
      });
      if (ctx.state.localVars[TRIGGER_KEY] !== true) return;

      // 2. 法正选目标 X
      delete ctx.state.localVars[TARGET_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: RT_TARGET,
        target: ownerId,
        prompt: {
          type: 'choosePlayer',
          title: '眩惑:选择接收两张牌的角色',
          min: 1,
          max: 1,
          filter: (view: GameView, target: number) =>
            target !== ownerId && view.players[target]?.alive === true,
        },
        timeout: 15,
      });
      const X = ctx.state.localVars[TARGET_KEY] as number;
      if (typeof X !== 'number' || X < 0 || !ctx.state.players[X]?.alive) return;

      // 3. 法正选 2 张手牌
      delete ctx.state.localVars[CARDS_KEY];
      await applyAtom(ctx.state, {
        type: '请求回应',
        requestType: RT_CARDS,
        target: ownerId,
        prompt: {
          type: 'distribute',
          mode: 'select',
          title: '眩惑:选择交给对方的 2 张手牌',
          source: 'hand',
          minTotal: 2,
          maxTotal: 2,
        },
        timeout: 20,
      });
      const cards = ctx.state.localVars[CARDS_KEY] as string[] | undefined;
      if (!Array.isArray(cards) || cards.length !== 2) return;
      const validCards = cards.filter((id) => self.hand.includes(id));
      if (validCards.length !== 2) return;

      await pushFrame(ctx.state, SKILL_ID, ownerId, { target: X, cards: validCards });
      try {
        // 4. 移动两张牌 法正 → X
        for (const cardId of validCards) {
          await applyAtom(ctx.state, {
            type: '移动牌',
            cardId,
            from: { zone: '手牌', player: ownerId },
            to: { zone: '手牌', player: X },
          });
        }

        // 5. 检查 X 可选项,选 1/2 或强制单项
        const optKill = canOptionKill(ctx.state, X);
        const optGain = canOptionGain(ctx.state, X);
        if (!optKill && !optGain) return;

        let choice: 'kill' | 'gain';
        if (optKill && optGain) {
          delete ctx.state.localVars[XCHOICE_KEY];
          await applyAtom(ctx.state, {
            type: '请求回应',
            requestType: RT_XCHOICE,
            target: X,
            prompt: {
              type: 'confirm',
              title:
                '眩惑:选择一项(确认=对法正指定角色出杀,取消=法正观看并取得你两张手牌)',
              confirmLabel: '对法正指定角色出杀',
              cancelLabel: '法正取得两张手牌',
            },
            defaultChoice: false,
            timeout: 15,
          });
          const xc = ctx.state.localVars[XCHOICE_KEY];
          choice = xc === 'kill' ? 'kill' : 'gain';
        } else {
          choice = optKill ? 'kill' : 'gain';
        }

        if (choice === 'kill') {
          await runOptionKill(ctx.state, ownerId, X);
        } else {
          await runOptionGain(ctx.state, ownerId, X);
        }
      } finally {
        await popFrame(ctx.state);
      }
    },
  );

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  api.defineAction('respond', {
    label: DISPLAY_NAME,
    style: 'default',
    prompt: {
      type: 'confirm',
      title: '是否发动眩惑?',
      confirmLabel: '发动',
      cancelLabel: '不发动',
    },
  });
  return undefined;
}

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
