// 界伏枥(界廖化·限定技,OL 界限突破官方逐字):
//   限定技,当你处于濒死状态时,你可以将体力回复至X点且手牌摸至X张
//   (X为全场势力数)。然后若X大于你造成的伤害数,你翻面。
//
// 与标版伏枥的区别(标版未实现;OL 一将成名·廖化 伏枥):
//   - 标版:"濒死时,你可以回复至X点体力(X为全场势力数)并翻面"(无摸牌、无条件翻面)
//   - 界版:回复至X体力 + 摸至X张牌;若 X > 你造成的伤害数 才翻面(造成过足够伤害可免翻面)
//
// 实现要点:
//   - 触发:陷入濒死 after-hook(target===ownerId 且 未用过伏枥)。
//     陷入濒死 atom 由 系统规则.runDyingFlow 在 造成伤害/失去体力 后触发,
//     本 hook 在 runDyingFlow 进入求桃循环前运行,救活后 health>0 → 循环退出,廖化不死。
//   - X = 全场存活玩家的不同势力数量(魏/蜀/吴/群)。
//   - 回复至 X:applyAtom(回复体力, amount = max(0, X - cur_health))。
//   - 摸至 X:applyAtom(摸牌, count = max(0, X - cur_hand.length))。
//   - "你造成的伤害数":owner 累计造成的伤害总额(永久计数,非 /usedThisTurn 不被自动清空)。
//     由 造成伤害 after-hook(source===ownerId 且 amount>0)+= amount。
//   - 翻面:复用据守/放逐/悲歌等的手法,加 '伏枥/翻面' 标签,下一回合 准备阶段开始时
//     before-hook 消费标签 + 设 skipAll + cancel 阶段;阶段结束(准备) before-hook 亲自
//     推进回合。tag 名独立,与其他翻面技能互不干扰。
//   - 限定技:player.vars['伏枥/used'](永久 vars,后缀不匹配 /usedThisTurn 不被自动清理)。
//   - 键名前缀 '伏枥/'(界版规范:与显示名一致,不带"界"前缀)。
//
// 命名:文件名/loader key/character skill name 均为 '界伏枥'(避开标伏枥冲突);
//   内部 Skill.name = '伏枥'(OL 官方技能名,玩家可见)。
import type {
  FrontendAPI,
  GameState,
  Skill,
  SkillModule,
} from '../types';
import { applyAtom } from '../core/apply';
import { flipFaceDown, isFaceDown, registerFlipSkipTurnHooks } from '../flows/face-down';
import { registerAfterHook } from '../core/skill';
import { askConfirm, defineConfirmAction, registerConfirmRespond } from '../util/skillRuntime';
import { countFactions } from '../util/player-query';

const DISPLAY_NAME = '伏枥';

/** player.vars:伏枥是否已用过(整局一次,永久不被自动清空)。 */
const USED_KEY = '伏枥/used';
/** player.vars:owner 累计造成的伤害数(永久不被自动清空)。 */
const DMG_DEALT_KEY = '伏枥/damageDealt';

/** localVars:玩家是否发动伏枥。 */
const CONFIRMED_KEY = '伏枥/confirmed';
/** requestType:确认发动询问。 */
const CONFIRM_RT = '界伏枥/confirm';

export function createSkill(id: string, ownerId: number): Skill {
  return {
    id,
    ownerId,
    name: DISPLAY_NAME,
    description:
      '限定技:濒死时,将体力回复至X点且手牌摸至X张(X为全场势力数);然后若X大于你造成的伤害数,你翻面',
  };
}

export function onInit(skill: Skill, state: GameState): (() => void) | void {
  const ownerId = skill.ownerId;

  // ── respond:廖化回应是否发动伏枥 ──
  registerConfirmRespond(state, skill.id, ownerId, CONFIRM_RT, CONFIRMED_KEY, {
    mismatchError: '当前不是伏枥询问',
  });

  // ── 陷入濒死 after-hook:伏枥主逻辑 ──
  registerAfterHook(state, skill.id, ownerId, '陷入濒死', async (ctx) => {
    const atom = ctx.atom;
    if (atom.target !== ownerId) return;
    // 限定技:整局一次
    if (ctx.state.players[ownerId]?.vars[USED_KEY]) return;
    const self = ctx.state.players[ownerId];
    if (!self?.alive) return;
    // 重入保护:若其他救援技(不屈/仁心/补益等)已在本 陷入濒死 中先行救活(health>0),则跳过
    // (与标版涅槃/界涅槃一致——同为 陷入濒死 自救型限定技,均含此守卫。)
    if (self.health > 0) return;

    // 询问是否发动
    const confirmed = await askConfirm(ctx.state, CONFIRM_RT, ownerId, {
      confirmedKey: CONFIRMED_KEY,
      title: '是否发动伏枥?(限定技:回复至X体力并摸至X张手牌;X=全场势力数;若X>你造成的伤害数则翻面)',
      confirmLabel: '发动',
      cancelLabel: '不发动',
      defaultChoice: false,
      timeout: 15,
    });
    if (!confirmed) return;

    // 标记已使用(限定技)。在读到 confirmed 后立即设,防重入。
    ctx.state.players[ownerId].vars[USED_KEY] = true;

    // 1) X = 全场存活玩家的不同势力数
    const x = countFactions(ctx.state);

    // 2) 体力回复至 X
    const curHealth = ctx.state.players[ownerId].health;
    const healAmount = Math.max(0, x - curHealth);
    if (healAmount > 0) {
      await applyAtom(ctx.state, {
        type: '回复体力',
        target: ownerId,
        amount: healAmount,
      });
    }

    // 3) 手牌摸至 X(摸 max(0, X - 当前手牌数) 张)
    const curHand = ctx.state.players[ownerId].hand.length;
    const drawCount = Math.max(0, x - curHand);
    if (drawCount > 0) {
      await applyAtom(ctx.state, {
        type: '摸牌',
        player: ownerId,
        count: drawCount,
      });
    }

    // 4) 若 X > 你造成的伤害数,翻面
    const damageDealt = (ctx.state.players[ownerId].vars[DMG_DEALT_KEY] as number | undefined) ?? 0;
    if (x > damageDealt) {
      // 已翻面则不重复(理论上罕见——限定技只触发一次)
      const flipped = isFaceDown(ctx.state, ownerId);
      if (!flipped) {
        await flipFaceDown(ctx.state, ownerId, '伏枥');
      }
    }
  });

  // ── 造成伤害 after-hook:累计 owner 造成的伤害数 ──
  registerAfterHook(state, skill.id, ownerId, '造成伤害后', async (ctx) => {
    const atom = ctx.atom;
    if (atom.source !== ownerId) return;
    if ((atom.amount ?? 0) <= 0) return;
    const cur = (ctx.state.players[ownerId].vars[DMG_DEALT_KEY] as number | undefined) ?? 0;
    ctx.state.players[ownerId].vars[DMG_DEALT_KEY] = cur + (atom.amount ?? 0);
  });

  // ── 翻面:下一回合跳过(共用 face-down 通用版 hook 对,机制同据守/放逐)──
  registerFlipSkipTurnHooks(state, skill.id, ownerId, '伏枥');

  return () => {};
}

export function onMount(_skill: Skill, api: FrontendAPI): (() => void) | void {
  defineConfirmAction(api, 'respond', {
    label: DISPLAY_NAME,
    title: '是否发动伏枥?',
  });
  return;
}

export default { createSkill, onInit, onMount } satisfies SkillModule;
