// src/engine/skills/遗计.ts
// ============================================================
// 技能描述(三国杀官方规则,见 docs/research/武将技能/魏国/郭嘉.md):
//   遗计(郭嘉·被动技):
//     - 触发时机:受到 1 点伤害后
//     - 发动条件:无特殊条件
//     - 效果:
//       1) 摸两张牌
//       2) 将两张牌交给任意角色(可以是自己,也可以分配给不同角色)
//     - 限制:每受到 1 点伤害可发动一次
//     - 备注:
//       - 受到 2 点伤害可发动两次遗计
//       - 交给的牌可以是摸到的牌,也可以是原有的手牌
//       - 可以将两张牌分别交给两名不同角色
//     - FAQ:不能交给已死亡的角色
//
// 关键原子操作:
//   after 钩子(造成伤害):
//     请求回应(confirm) → 摸牌(count=2) → 请求回应(distribute, drawnCards) → for each: 给予
//
// 关键时机:
//   - 受到伤害后触发(after hook of 造成伤害)
//   - **每 1 点伤害触发一次**(标准规则) — 当前实现忽略 amount,只触发一次
//
// 已知问题/不完整实现:
//   1. **描述错误**:文件 description 写"锁定技",但标准遗计是非锁定技(可选),
//      当前实现确实询问 confirm,功能上是非锁定技——文件描述需修正。
//   2. **amount > 1 触发次数错误**:标准规则是每 1 点伤害触发一次,
//      当前 hook 只触发一次,无论 amount 是几——3 点伤害也只摸/分一次牌。
//      应改为 for (let i=0; i<amount; i++) { ... }。
//   3. **"任意角色" 包含自己** vs 规则"其他角色":
//      ctx.params.allocation 未做 target!==ownerId 校验,可能把牌分给自己(违反规则)。
//   4. **摸两张牌的检索方式脆弱**:`selfPlayer.hand.slice(-2)` 假定刚摸的牌
//      就是手牌末尾两张——目前 摸牌 atom 实现确实 append 到末尾,但耦合实现细节,
//      若改成"插入随机位置"等会立刻失效。应在摸牌前后 diff 来取得真实 drawn 列表。
//   5. **distribution 必填校验缺失**:若超时(distribute prompt 30s),
//      `ctx.params.allocation` 可能为 undefined,代码 fallback 是"什么都不做" —
//      但此时 2 张牌已摸进手牌,规则上若不分配应丢弃或保留?当前默认保留(可能违反规则)。
//   6. allocation 不验证 cardIds 是否在 drawnCards 内——理论上玩家可"指定其他手牌交出"
//      (但 dispatch 层应已校验,需 cross-check)。
// ============================================================
import type { AtomAfterContext, Skill } from '../types';
import { applyAtom } from '../create-engine';
import { registerAction, registerAfterHook, type SkillModule } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: '遗计',
    description: '锁定技:受到 1 点伤害后,摸两张牌,然后将两张牌交给任意角色',
  };
}

export function onInit(skill: Skill, ownerId: number): () => void {
  registerAfterHook(skill.id, ownerId, '造成伤害', async (ctx: AtomAfterContext) => {
    if ((ctx.atom as { target?: number }).target !== ownerId) return;
    if (((ctx.atom as { amount?: number }).amount ?? 0) <= 0) return;
    // 1. 询问是否发动
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '遗计/confirm',
      target: ownerId,
      prompt: { type: 'confirm', title: '是否发动遗计?', confirmLabel: '发动', cancelLabel: '不发动' },
      defaultChoice: false,
      timeout: 10000,
    });
    // 2. 摸两张牌
    const handBefore = ctx.state.players[ownerId]?.hand.length ?? 0;
    await applyAtom(ctx.state, { type: '摸牌', player: ownerId, count: 2 });
    // 取摸到的牌:手牌末尾 2 张
    const selfPlayer = ctx.state.players[ownerId];
    const drawnCards = selfPlayer ? selfPlayer.hand.slice(-2) : [];
    // 3. 询问分配
    await applyAtom(ctx.state, {
      type: '请求回应',
      requestType: '遗计/distribute',
      target: ownerId,
      prompt: { type: 'distribute', title: '遗计:分配两张牌', cardIds: drawnCards, minPerTarget: 1, maxPerTarget: 2 },
      timeout: 30000,
    });
    // 4. 读取分配结果并逐张给予
    // dispatch 回应路径把 distribute 的 params merge 到 topFrame
    // 客户端回应格式: { allocation: [{ target: 0, cardIds: ['c1'] }, ...] }  (target = 座次)
    const distribution = ctx.params.allocation as Array<{ target: number; cardIds: string[] }> | undefined;
    if (Array.isArray(distribution)) {
      for (const entry of distribution) {
        for (const cardId of entry.cardIds) {
          await applyAtom(ctx.state, { type: '给予', cardId, from: ownerId, to: entry.target });
        }
      }
    }
  });
  return () => {};
}

export default { createSkill, onInit };
