// 界刚烈(界夏侯惇·被动技):当你受到伤害后,你可以进行判定,
// 若结果不为红桃,则伤害来源选择一项:弃置两张手牌,或受到 1 点伤害。
// 界版新增:然后若伤害来源的武将牌未翻面,你可以将其翻面。
//
// 模式 A(被动触发):after hook 挂在「造成伤害」。
//   造成伤害(target=自己, source 存活) → 判定 → 非红桃 → 来源二选一 →
//   界版:若来源未翻面,界夏侯惇可选择将其翻面。
//
// 关键点:
//   - 来源选择需要来源玩家 respond,而界刚烈只注册在界夏侯惇座次。
//     引擎 dispatch 按 (skillId, message.ownerId, actionType) 精确查 action,
//     因此把 'respond' action 注册到每个座次(以 skillId='界刚烈' 隔离,不与他技冲突)。
//   - 判定结果通过「判定」after hook 在判定牌进弃牌堆前捕获花色,存 localVars。
//   - 来源手牌不足两张时只能选择受到伤害(规则 FAQ)。
//   - 翻面复用据守/放逐/悲歌的标签+阶段 hook 机制(tag 名独立为 '刚烈/翻面'):
//     加标签 → 下一回合准备阶段 before-hook 消费标签 + 设 skipAll + cancel 所有阶段 →
//     阶段结束 before-hook 主动推进回合。
//   - 翻面前检查来源武将牌未翻面(无任何 '/翻面' 后缀标签)。
import type {
  AtomAfterContext,
  AtomBeforeContext,
  FrontendAPI,
  GameState,
  HookResult,
  Json,
  Skill,
} from '../types';
import { applyAtom, frameCards } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook } from '../skill';

const CHOOSE_REQUEST = '刚烈/choose';
const FLIP_REQUEST = '刚烈/flipConfirm';
const CHOICE_KEY = '刚烈/choice';
const JUDGE_SUIT_KEY = '刚烈/judgeSuit';
const FLIP_KEY = '刚烈/flipChoice';
const SKIP_TAG = '刚烈/翻面';
const SKIP_FLAG = '刚烈/skipAll';

/** 武将牌是否已翻面(存在任意 '/翻面' 后缀标签) */
function isFlipped(tags: string[]): boolean {
  return tags.some((t) => t.endsWith('/翻面'));
}

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '界刚烈',
    description: '受到伤害后判定,非红桃则来源弃两张手牌或受 1 点伤害;然后可将其翻面',
  };
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;

  // ── respond:来源二选一 + 界夏侯惇翻面确认 ──
  // 注册到每个座次:来源可能是任意玩家,dispatch 按 (skillId, ownerId, actionType) 查。
  // 各座次用独立闭包绑定 seatId;以 skillId='界刚烈' 隔离,不与其他技能 respond 冲突。
  const unloaders: Array<() => void> = [];
  for (const p of state.players) {
    const seatId = p.index;
    const u = registerAction(
      state,
      skill.id,
      seatId,
      'respond',
      (st: GameState, _params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        if (!slot) return '当前不需要回应';
        const atom = slot.atom as Record<string, unknown>;
        if (atom['type'] !== '请求回应') return '当前不需要回应';
        const rt = atom['requestType'] as string;
        if (rt !== CHOOSE_REQUEST && rt !== FLIP_REQUEST) return '当前不是刚烈询问';
        return null;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const slot = st.pendingSlots.get(seatId);
        const rt = (
          slot?.atom as unknown as { requestType?: string } | undefined
        )?.requestType;
        if (rt === CHOOSE_REQUEST) {
          st.localVars[CHOICE_KEY] = params.choice === true ? 'discard' : 'damage';
        } else if (rt === FLIP_REQUEST) {
          st.localVars[FLIP_KEY] = params.choice === true;
        }
      },
    );
    unloaders.push(u);
  }

  // ── 判定 after hook:捕获判定牌花色(判定牌进弃牌堆前)──
  registerAfterHook(state, skill.id, ownerId, '判定', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { type?: string; judgeType?: string; player?: number };
    if (atom.type !== '判定') return;
    if (atom.judgeType !== '刚烈') return;
    if (atom.player !== ownerId) return;
    const processing = frameCards(ctx.state);
    if (processing.length === 0) return;
    const judgeCardId = processing[processing.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;
    ctx.state.localVars[JUDGE_SUIT_KEY] = judgeCard.suit;
  });

  // ── 造成伤害 after hook:界刚烈主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom as { target?: number; source?: number; amount?: number };
    if (atom.target !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    if (atom.source === undefined || atom.source === ownerId) return;
    const sourceIdx = atom.source;
    const sourcePlayer = ctx.state.players[sourceIdx];
    if (!sourcePlayer?.alive) return; // 来源必须存活(FAQ)

    // 判定(牌堆空则跳过——无法判定则刚烈不触发)
    if (ctx.state.zones.deck.length === 0) return;
    delete ctx.state.localVars[JUDGE_SUIT_KEY];
    await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '刚烈' });
    const suit = ctx.state.localVars[JUDGE_SUIT_KEY] as string | undefined;
    delete ctx.state.localVars[JUDGE_SUIT_KEY];
    if (suit === undefined) return; // 判定未产出牌

    // 非红桃:来源二选一。手牌不足两张 → 只能受到伤害(FAQ)。
    if (suit !== '♥') {
      const canDiscard = ctx.state.players[sourceIdx].hand.length >= 2;
      if (canDiscard) {
        delete ctx.state.localVars[CHOICE_KEY];
        await applyAtom(ctx.state, {
          type: '请求回应',
          requestType: CHOOSE_REQUEST,
          target: sourceIdx,
          prompt: {
            type: 'confirm',
            title: '刚烈:弃置两张手牌,或受到 1 点伤害?',
            confirmLabel: '弃两张手牌',
            cancelLabel: '受 1 点伤害',
          },
          defaultChoice: false,
          timeout: 30,
        });
        const choice = ctx.state.localVars[CHOICE_KEY] as string | undefined;
        delete ctx.state.localVars[CHOICE_KEY];
        if (choice === 'discard') {
          const hand = [...ctx.state.players[sourceIdx].hand];
          await applyAtom(ctx.state, {
            type: '弃置',
            player: sourceIdx,
            cardIds: hand.slice(0, 2),
          });
        } else {
          // 受到 1 点伤害(来源为界夏侯惇本人)
          await applyAtom(ctx.state, {
            type: '造成伤害',
            target: sourceIdx,
            amount: 1,
            source: ownerId,
          });
        }
      } else {
        // 手牌不足两张 → 强制受到伤害(FAQ)
        await applyAtom(ctx.state, {
          type: '造成伤害',
          target: sourceIdx,
          amount: 1,
          source: ownerId,
        });
      }
    }

    // ── 界版新增:翻面 ──
    // 来源仍存活 + 武将牌未翻面 → 询问界夏侯惇是否将其翻面
    const sourceNow = ctx.state.players[sourceIdx];
    if (!sourceNow?.alive) return;
    if (isFlipped(sourceNow.tags)) return; // 已翻面

    delete ctx.state.localVars[FLIP_KEY];
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: FLIP_REQUEST,
      target: ownerId,
      prompt: {
        type: 'confirm',
        title: '界刚烈:是否将伤害来源的武将牌翻面?',
        confirmLabel: '翻面',
        cancelLabel: '不翻面',
      },
      defaultChoice: false,
      timeout: 15,
    });
    const flipChoice = ctx.state.localVars[FLIP_KEY] as boolean | undefined;
    delete ctx.state.localVars[FLIP_KEY];
    if (flipChoice === true) {
      await applyAtom(ctx.state, { type: '加标签', player: sourceIdx, tag: SKIP_TAG });
    }
  });

  // ── 阶段开始 before hook:检测翻面标签 → 启动跳过(手法同据守/放逐/悲歌)──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段开始',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number; phase?: string };
      if (atom.type !== '阶段开始') return;
      const player = atom.player;
      if (player === undefined) return;
      const p = ctx.state.players[player];
      if (!p) return;

      // 入口:准备阶段开始 + 该玩家有翻面标签 → 启动跳过
      if (atom.phase === '准备' && p.tags.includes(SKIP_TAG)) {
        await applyAtom(ctx.state, { type: '去标签', player, tag: SKIP_TAG });
        ctx.state.localVars[SKIP_FLAG] = player;
        return { kind: 'cancel' };
      }

      // skipAll 标志存在时,取消该玩家所有其他阶段(防 phase-end after-hook 推进)
      if (ctx.state.localVars[SKIP_FLAG] === player) {
        return { kind: 'cancel' };
      }
    },
  );

  // ── 阶段结束 before hook:skipAll → 主动推进回合 ──
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '阶段结束',
    async (ctx: AtomBeforeContext): Promise<HookResult | void> => {
      const atom = ctx.atom as { type?: string; player?: number };
      if (atom.type !== '阶段结束') return;
      const player = atom.player;
      if (player === undefined) return;
      if (ctx.state.localVars[SKIP_FLAG] !== player) return;

      // 清除 skipAll 标志
      delete ctx.state.localVars[SKIP_FLAG];

      // 亲自执行 end-turn 序列(与 回合管理.end action 一致,但跳过了被 cancel 的阶段)
      await applyAtom(ctx.state, { type: '清过期标记', player });
      await applyAtom(ctx.state, { type: '下一玩家' });
      await applyAtom(ctx.state, { type: '回合结束', player });

      return { kind: 'cancel' };
    },
  );

  return () => {
    unloaders.forEach((u) => u());
  };
}

export function onMount(_skill: Skill, api: FrontendAPI): void {
  api.defineAction('respond', {
    label: '界刚烈',
    style: 'danger',
    prompt: {
      type: 'confirm',
      title: '刚烈:弃置两张手牌,或受到 1 点伤害?',
      confirmLabel: '弃两张手牌',
      cancelLabel: '受 1 点伤害',
    },
  });
}

export default { createSkill, onInit, onMount } satisfies import('../types').SkillModule;
