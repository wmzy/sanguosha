// src/engine/skills/乐不思蜀.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/卡牌信息.md):
//   乐不思蜀(延时锦囊):
//     - 使用条件:出牌阶段使用
//     - 距离限制:**目标必须在你距离 1 以内**
//     - 目标限制:距离 1 以内的 1 名其他角色
//     - 判定条件:目标角色判定阶段进行判定
//       - 若判定结果**不为♥(红桃)**,则跳过该角色的出牌阶段
//       - 若判定结果为♥(红桃),则无效果,乐不思蜀弃置
//     - 特殊规则:
//       - 延时锦囊放置在目标角色的判定区
//       - 在目标角色的判定阶段开始时进行判定
//       - 可以被【无懈可击】抵消(判定前抵消或判定后抵消效果)
//       - 可以被【过河拆桥】拆掉
//
// 关键原子操作:
//   use 路径:
//     pushFrame → 移动牌(手牌→处理区) → 添加延时锦囊(target, trick='乐不思蜀') →
//     移动牌(处理区→弃牌堆) → popFrame
//   判定阶段:
//     before '阶段开始' phase='判定':若自己有 pendingTricks='乐不思蜀' →
//       触发 判定 atom(judgeType='乐不思蜀')。after 钩子读 judgeZone 顶牌花色。
//       ♥  → 仅移除延时锦囊(无效);
//       其它 → 移除延时锦囊 + 加标签 '乐不思蜀/跳过出牌'。
//   出牌阶段:
//     before '阶段开始' phase='出牌':若自己有 '乐不思蜀/跳过出牌' 标签 →
//       返回 cancel + 触发 阶段结束 出牌(让回合管理推进到 弃牌)+ 去标签。
//
// 关键时机:
//   - 添加延时锦囊到目标的 pendingTricks 数组
//   - 判定时机:目标的判定阶段开始(由回合管理阶段链触发 阶段开始 判定)
//   - 跳过时机:目标的出牌阶段开始(由回合管理阶段链触发 阶段开始 出牌)
//
// 引擎机制说明(参考 src/engine/create-engine.ts):
//   判定 atom 是事件标记:apply 是 no-op。
//   引擎在 applyAtom pipeline 中:
//     applyAtomImpl → pushEvent → moveJudgeCardToZone(push card to judgeZone) →
//     after hooks(can read judgeZone top) → atomStack.pop → cleanupJudgeZone(pop card to discard)
//   因此判定牌花色必须在 判定 atom 的 after hook 中读取;过后 judgeZone 已被清空。
// ============================================================
import type {
  AtomAfterContext,
  AtomBeforeContext,
  Card,
  GameState,
  Json,
  Skill,
} from '../types';
import { applyAtom, popFrame, pushFrame } from '../create-engine';
import { registerAction, registerAfterHook, registerBeforeHook, type SkillModule } from '../skill';

/** 跳过出牌阶段的 tag 名(实现为 mark id='tag:乐不思蜀/跳过出牌') */
const SKIP_TAG = '乐不思蜀/跳过出牌';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '乐不思蜀', description: '延时锦囊:判定非红桃则跳过出牌阶段' };
}

export function onInit(_skill: Skill, ownerId: number): () => void {
  // ─── use action:对目标放置延时锦囊 ────────────────────────
  registerAction(_skill.id, ownerId, 'use', (state: GameState, params: Record<string, Json>) => {
      if (typeof params.cardId !== 'string') return 'cardId required';
      if (typeof params.target !== 'number') return 'target required';
      return null;
    }, async (state: GameState, params: Record<string, Json>) => {
      const from = ownerId;
      const cardId = params.cardId as string;
      const target = params.target as number;
      pushFrame(state, '乐不思蜀', from, { ...params });
      // 移牌到处理区
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '手牌', player: from }, to: { zone: '处理区' } });
      // 添加延时锦囊到目标(用 cardMap 里的真卡;suit/rank 保留)
      const trickCard = state.cardMap[cardId];
      const pendingCard: Card = trickCard ?? {
        id: cardId,
        name: '乐不思蜀',
        suit: '♠',
        rank: 'A',
        type: '锦囊牌',
      };
      await applyAtom(state, {
        type: '添加延时锦囊',
        player: target,
        trick: { name: '乐不思蜀', source: from, card: pendingCard },
      });
      // 移牌到弃牌堆(原使用卡)
      await applyAtom(state, { type: '移动牌', cardId, from: { zone: '处理区' }, to: { zone: '弃牌堆' } });
      popFrame(state);
    });

  // ─── 判定阶段:有 乐不思蜀 → 触发判定 ────────────────────────
  registerBeforeHook(_skill.id, ownerId, '阶段开始', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '判定') return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    // 判定区是否有 乐不思蜀
    if (!self.pendingTricks.some(t => t.name === '乐不思蜀')) return;
    // 牌堆空:无法判定,跳过(规则允许直接弃置,但避免引擎崩;这里 no-op)
    if (ctx.state.zones.deck.length === 0) return;
    // 触发判定:判定 atom 是事件标记,引擎会自动从牌堆翻一张到 judgeZone,
    // 然后在 after hook 中读顶牌花色决定效果。
    await applyAtom(ctx.state, { type: '判定', player: ownerId, judgeType: '乐不思蜀' });
  });

  // ─── 判定 after:读判定牌花色,执行效果 ──────────────────────
  registerAfterHook(_skill.id, ownerId, '判定', async (ctx: AtomAfterContext) => {
    const atom = ctx.atom;
    if (atom.type !== '判定') return;
    if (atom.judgeType !== '乐不思蜀') return;
    if (atom.player !== ownerId) return;

    const self = ctx.state.players[ownerId];
    if (!self) return;
    // 没有 pendingTrick → 不处理(可能已被 过河拆桥 拆掉)
    if (!self.pendingTricks.some(t => t.name === '乐不思蜀')) return;

    // 读判定牌:此时 moveJudgeCardToZone 已 push、cleanupJudgeZone 尚未执行。
    // judgeZone 顶端就是本次判定的牌。
    if (self.judgeZone.length === 0) return;
    const judgeCardId = self.judgeZone[self.judgeZone.length - 1];
    const judgeCard = ctx.state.cardMap[judgeCardId];
    if (!judgeCard) return;

    if (judgeCard.suit === '♥') {
      // 红桃:无效,只移除延时锦囊(规则:♥ 时乐不思蜀无效果并弃置)
      await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: '乐不思蜀' });
    } else {
      // 其它花色:加跳过出牌标签,移除延时锦囊
      await applyAtom(ctx.state, { type: '加标签', player: ownerId, tag: SKIP_TAG });
      await applyAtom(ctx.state, { type: '移除延时锦囊', player: ownerId, trickName: '乐不思蜀' });
    }
  });

  // ─── 出牌阶段:有跳过标签 → 跳过出牌阶段 ────────────────────
  registerBeforeHook(_skill.id, ownerId, '阶段开始', async (ctx: AtomBeforeContext) => {
    const atom = ctx.atom;
    if (atom.type !== '阶段开始') return;
    if (atom.player !== ownerId) return;
    if (atom.phase !== '出牌') return;
    const self = ctx.state.players[ownerId];
    if (!self) return;
    // 检查跳过标签(存在 mark id='tag:乐不思蜀/跳过出牌')
    if (!self.marks.some(m => m.id === `tag:${SKIP_TAG}`)) return;

    // 顺序很重要:
    //   1) 先去标签(否则 阶段结束 出牌 之后回合管理阶段链会再次命中本 hook)
    //   2) 再触发 阶段结束 出牌(让回合管理的 after hook 把阶段推进到 弃牌)
    //   3) 返回 cancel → 当前 阶段开始 出牌 atom 不 apply,state.phase 已是 弃牌
    await applyAtom(ctx.state, { type: '去标签', player: ownerId, tag: SKIP_TAG });
    await applyAtom(ctx.state, { type: '阶段结束', player: ownerId, phase: '出牌' });
    return { kind: 'cancel' };
  });

  return () => {};
}

export default { createSkill, onInit };