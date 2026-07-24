// 界完杀(界贾诩·群·锁定技,OL 界限突破官方逐字):
//   "锁定技,在你的回合内:只有你和处于濒死状态的角色才能使用【桃】;
//    任意角色的濒死结算中,除你和濒死角色外的其他角色的非锁定技失效。"
//
// 与标版完杀(src/engine/skills/完杀.ts)的区别:
//   - 标版:仅"在你的回合,除你以外,只有处于濒死状态的角色才能使用【桃】"。
//   - 界版:在标版基础上新增"任意角色的濒死结算中,除你和濒死角色外的其他角色的
//     非锁定技失效"。即贾诩回合内,濒死结算期间他人(非贾诩、非濒死者)的非锁定技
//     不触发(锁定技与装备技仍生效)。
//
// 实现要点:
//   ① 标版完杀(桃 限制):before-hook 挂 请求回应(requestType='桃/求桃'):贾诩回合内,
//     被问询者既非贾诩、又非当前濒死者时 cancel(同标版)。
//   ② 界版新增(非锁定技失效):
//     - before-hook 挂 陷入濒死:贾诩回合内任意濒死发生时,为"非贾诩且非濒死者"的
//       存活玩家加 tag '完杀/非锁定技失效'(若未持有)。before-hook 保证在陷入濒死的
//       after-hooks(如界曹冲仁心、界吴国太补益等救援技)运行前 tag 已就位 → 这些
//       非锁定技的 after-hook 被 isHookSuppressed 过滤,不触发。
//     - after-hook 挂 死亡后 / 回复体力:cleanup 时点。每次都重新扫描"是否仍有人濒死",
//       若无人濒死则移除所有完杀 tag。回复体力也覆盖不屈(陷入濒死后由其他 hook
//       直接 回复体力 救活,无 死亡流程)的退出路径。
//       (模块 B:击杀 拆分为 runDeathFlow,cleanup 时点从 击杀 after-hook 迁至 死亡后 after-hook)
//   ③ SUPPRESSION_TAGS(create-engine.ts)新增 '完杀/非锁定技失效',引擎在
//     runBeforeHooks/runAfterHooks 中据 player.tags 自动过滤被压制技能的非锁定技 hook。
//
// 边界与差异:
//   - 嵌套濒死(濒死结算中又触发新濒死):tag 在第一次濒死已加,后续不再重复加;
//     cleanup 只在最后一个濒死结算结束时(无人濒死)移除。
//   - 贾诩本人濒死:贾诩=你=濒死者,不在 tag 候选中;其他存活玩家仍被压制。
//   - 标版完杀的桃 cancel 沿用,行为不变。
//
// 命名:文件名/loader key/character skill name 均为 '界完杀';内部 Skill.name='完杀'。
import type { HookResult, Skill, GameState } from '../types';
import { registerBeforeHook, registerAfterHook, type SkillModule } from '../skill';
import { registerSuppressionProvider } from '../skill-suppression';

const SKILL_ID = '界完杀';
const DISPLAY_NAME = '完杀';

/** 非锁定技失效 tag(由 SUPPRESSION_TAGS 识别,见 create-engine.ts) */
const SUPPRESSION_TAG = '完杀/非锁定技失效';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '锁定技,在你的回合内,只有你和处于濒死状态的角色才能使用【桃】;任意濒死结算中,除你和濒死者外其他角色的非锁定技失效',
    isLocked: true,
  };
}

/** 当前是否有任意存活玩家处于濒死(health<=0 且 alive) */
function anyoneDying(state: GameState): boolean {
  return state.players.some((p) => p.alive && p.health <= 0);
}

/**
 * 若无人处于濒死,清理所有玩家身上的 '完杀/非锁定技失效' tag。
 * 用于 击杀 / 回复体力 等濒死退出时点的防御性扫描。
 * 直接 mutate player.tags(tag 是引擎内部状态,无 view 同步需求)。
 */
function cleanupIfNoDying(state: GameState): void {
  if (anyoneDying(state)) return;
  for (const p of state.players) {
    if (!p) continue;
    if (!p.tags.includes(SUPPRESSION_TAG)) continue;
    p.tags = p.tags.filter((t) => t !== SUPPRESSION_TAG);
  }
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;
  const unloaders: Array<() => void> = [];

  // ── ⓪ 非锁定技失效 provider:持有 SUPPRESSION_TAG 的玩家,其非锁定技 hook 被压制 ──
  //   通过 skill-suppression 扩展点注册,避免引擎核心硬编码技能名/标签。
  unloaders.push(
    registerSuppressionProvider(
      state,
      (st, targetOwnerId, _skillId) =>
        st.players[targetOwnerId]?.tags.includes(SUPPRESSION_TAG) === true,
    ),
  );

  // ── ① 桃 限制(标版完杀沿用)──
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '请求回应',
      async (ctx): Promise<HookResult | void> => {
        const atom = ctx.atom;
        if (atom.requestType !== '桃/求桃') return; // 仅干预濒死求桃
        // 仅在贾诩回合内生效
        if (ctx.state.currentPlayerIndex !== ownerId) return;
        const asked = atom.target;
        if (typeof asked !== 'number') return;
        if (asked === ownerId) return; // 贾诩本人可使用桃
        // 濒死者本人可对自己使用桃
        const dying = ctx.state.players.findIndex((p) => p.alive && p.health <= 0);
        if (asked === dying) return;
        // 其余角色:不能使用桃 → 跳过对该角色的问询
        return { kind: 'cancel' };
      },
    ),
  );

  // ── ② 非锁定技失效:陷入濒死 before-hook,贾诩回合内为他人加 tag ──
  //    before-hook 保证在 陷入濒死的 after-hooks(界曹冲仁心/界吴国太补益等救援技)前 tag 就位
  unloaders.push(
    registerBeforeHook(
      state,
      skill.id,
      ownerId,
      '陷入濒死',
      async (ctx): Promise<HookResult | void> => {
        // 仅在贾诩回合内生效
        if (ctx.state.currentPlayerIndex !== ownerId) return;
        const atom = ctx.atom;
        const dyingIdx = atom.target;
        if (typeof dyingIdx !== 'number') return;
        // 为"非贾诩且非濒死者"的存活玩家加 tag(若未持有)
        for (let i = 0; i < ctx.state.players.length; i++) {
          if (i === ownerId) continue;
          if (i === dyingIdx) continue;
          const p = ctx.state.players[i];
          if (!p?.alive) continue;
          if (!p.tags.includes(SUPPRESSION_TAG)) p.tags.push(SUPPRESSION_TAG);
        }
        return; // pass:不阻止陷入濒死 atom 本身
      },
    ),
  );

  // ── ③ cleanup:死亡后 after-hook(目标死亡 → 濒死结束)──
  // 模块 B:击杀拆分为 runDeathFlow,濒死退出时点改为「死亡后」(系统处理牌+奖惩之后)。
  unloaders.push(
    registerAfterHook(state, skill.id, ownerId, '死亡后', async (_ctx) => {
      cleanupIfNoDying(state);
    }),
  );

  // ── ④ cleanup:回复体力 after-hook(救援成功 / 不屈救活 → 濒死结束)──
  unloaders.push(
    registerAfterHook(state, skill.id, ownerId, '回复体力', async (_ctx) => {
      cleanupIfNoDying(state);
    }),
  );

  return () => {
    for (const u of unloaders) u();
  };
}

const _skillModule: SkillModule = { createSkill, onInit };
export default _skillModule;
