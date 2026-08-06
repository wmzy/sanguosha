// 白银狮子(防具):锁定技。当你受到大于1点的伤害时,伤害改为1点;
//   当你失去装备区里的白银狮子后,回复1点体力。
//   (官方文案见 src/cards/description.ts)
import type { HookResult, Skill, GameState } from '../types';
import { applyAtom } from '../index';
import { registerAfterHook, registerBeforeHook } from '../skill';

export function createSkill(id: string, ownerId: number): Skill {
  return { id, ownerId, name: '白银狮子', description: '防具:每次受伤最多1点', isLocked: true };
}

/** ownerId 装备区的防具是否为白银狮子,返回其 cardId(否则 null)。
 *  动态校核装备仍在(陷阱8):装备可能同帧内被换下,触发时按当前装备区实时判定。 */
function equippedSilverLion(state: GameState, ownerId: number): string | null {
  const armorId = state.players[ownerId]?.equipment['防具'];
  if (!armorId) return null;
  return state.cardMap[armorId]?.name === '白银狮子' ? armorId : null;
}

export function onInit(skill: Skill, state: GameState): () => void {
  const ownerId = skill.ownerId;
  const loseKey = `白银狮子/失去/${ownerId}`;

  // ── 减伤:before hook 挂「受到伤害时」──
  // target=自己 + amount>1 + 仍装备白银狮子 → 伤害改为 1(锁定技)。
  registerBeforeHook(
    state,
    skill.id,
    ownerId,
    '受到伤害时',
    async (ctx): Promise<HookResult | void> => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      if ((atom.amount ?? 0) <= 1) return;
      if (!equippedSilverLion(ctx.state, ownerId)) return;
      return { kind: 'modify', atom: { ...ctx.atom, amount: 1 } as typeof ctx.atom };
    },
  );

  // ── 失去装备区里的白银狮子 → 回复 1 点体力(锁定技,无条件)──
  // 白银狮子离开装备区的四条路径(对齐枭姬的三路径 + 替换特例):
  //   1. 卸下(借刀杀人/国色/奇袭等直接卸下,或孤立卸下):卸下 atom 触发时仍在装备区。
  //   2. 弃置(过河拆桥/寒冰剑/麒麟弓/制衡/弃牌阶段):弃置 atom 触发时仍在装备区;
  //      弃置 after hook 先于系统规则兜底的 移除技能 执行,故此处可安全回血。
  //   3. 获得(顺手牵羊/反馈):获得 atom 触发时仍在装备区。
  //   4. 替换(装备通用/据守/界直言/界直谏 等换装):先 移除技能(白银狮子) 再 卸下,
  //      卸下 时本技能 hook 已被卸载 → 卸下 hook 不会触发。故特例:挂 移除技能,
  //      仅当触发时白银狮子仍在装备区(替换流程 step1)才回血。
  //      弃置路径兜底的 移除技能 触发时白银狮子已被 弃置 移出装备区,门禁自然排除,无重复回血。
  // before hook 记录 loseKey,after hook 据此回血。各路径互斥(同一失去只经一条路径)。

  // 路径 1:卸下
  registerBeforeHook(state, skill.id, ownerId, '卸下', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId || atom.slot !== '防具') return;
    if (equippedSilverLion(ctx.state, ownerId)) ctx.state.localVars[loseKey] = true;
  });
  // 路径 2:弃置(过河拆桥/寒冰剑/麒麟弓/制衡 等直接弃装备)
  registerBeforeHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    const armorId = equippedSilverLion(ctx.state, ownerId);
    if (armorId && (atom.cardIds ?? []).includes(armorId)) ctx.state.localVars[loseKey] = true;
  });
  // 路径 3:获得(顺手牵羊/反馈 从装备区顺走)
  registerBeforeHook(state, skill.id, ownerId, '获得', async (ctx) => {
    const atom = ctx.atom;
    if (atom.from !== ownerId) return;
    const armorId = equippedSilverLion(ctx.state, ownerId);
    if (armorId && atom.cardId === armorId) ctx.state.localVars[loseKey] = true;
  });
  // 路径 4:替换特例(移除技能)——仅当白银狮子仍在装备区(替换流程 step1)
  registerBeforeHook(state, skill.id, ownerId, '移除技能', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId || atom.skillId !== '白银狮子') return;
    if (equippedSilverLion(ctx.state, ownerId)) ctx.state.localVars[loseKey] = true;
  });

  // 共用回血:读 loseKey → 回 1 血(存活才回)。各路径 after hook 在自身门禁通过后调用。
  async function healIfLost(s: GameState): Promise<void> {
    if (!s.localVars[loseKey]) return;
    delete s.localVars[loseKey];
    if (!s.players[ownerId]?.alive) return; // 已亡不再回血
    await applyAtom(s, { type: '回复体力', target: ownerId, amount: 1 });
  }

  registerAfterHook(state, skill.id, ownerId, '卸下', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId || atom.slot !== '防具') return;
    await healIfLost(ctx.state);
  });
  registerAfterHook(state, skill.id, ownerId, '弃置', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId) return;
    await healIfLost(ctx.state);
  });
  registerAfterHook(state, skill.id, ownerId, '获得', async (ctx) => {
    const atom = ctx.atom;
    if (atom.from !== ownerId) return;
    await healIfLost(ctx.state);
  });
  registerAfterHook(state, skill.id, ownerId, '移除技能', async (ctx) => {
    const atom = ctx.atom;
    if (atom.player !== ownerId || atom.skillId !== '白银狮子') return;
    await healIfLost(ctx.state);
  });

  return () => {};
}
