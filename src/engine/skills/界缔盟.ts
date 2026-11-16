// 界缔盟(界鲁肃·吴·界限突破):出牌阶段限一次，
//   你可以令两名其他角色交换手牌（两者手牌数之差不大于你的牌数量），
//   若如此做，出牌阶段结束时，你弃置X张牌（X为这两名角色手牌数之差）。
//
// 官方文本(hero/485 逐字):
//   "出牌阶段限一次，你可以令两名其他角色交换手牌（两者手牌数之差不大于你的牌数量），
//    若如此做，出牌阶段结束时，你弃置X张牌（X为这两名角色手牌数之差）。"
//
// 与标缔盟三处实质差异:
//   1. 前置条件:两者手牌数差 ≤ 鲁肃的牌数(手牌+装备)
//   2. 结算顺序:先交换手牌,后弃牌(标版是先弃后换)
//   3. 弃牌时机:出牌阶段结束时延迟弃(标版是交换前立即弃)
//
// 主流程(校验/选目标/respond/onMount)复用标版缔盟导出的 createDimengSkill 工厂;
// 本文件只写差异:选目标后结算(前置校验+先交换+记延迟弃)、阶段结束 before-hook 延迟弃、
// respond 弃牌分支的宽松校验(标版严格校验张数+归属)。
//
// 阶段结束 hook 必须用 before-hook 而非 after-hook:回合管理 的 阶段结束(出牌) after-hook
// 会同步推进到弃牌阶段(阻塞等待弃牌)并连锁到回合结束、轮到下家;而 DEFAULT_SKILLS 先于
// 角色技能注册,after-hook 会令本弃牌发生在该回合结束之后(时机错误 + 残留 pending 污染
// 下家回合)。before-hook 先于 回合管理 after-hook 结算,确保在出牌阶段结束、阶段推进前
// 完成弃牌(与截辎「额外摸牌阶段」改用 before-hook 同因)。
//
// 命名:文件名/loader key/character name = '界缔盟';内部 Skill.name = '缔盟'。
import { registerBeforeHook } from '../core/skill';
import {
  createDimengSkill,
  swapHands,
  askMandatoryDiscard,
  type DimengOptions,
} from './缔盟';
import { totalCardCount } from '../util/player-query';
import type { SkillModule } from '../types';

const DISCARD_RT = '界缔盟/discard';
const DISCARD_KEY = '界缔盟/discardCards';
/** 出牌阶段结束时待弃牌数(X)。localVars: 鲁肃座次 → 弃牌数 */
const PENDING_DISCARD_KEY = '界缔盟/待弃数';
/** localVars: 出牌阶段结束时弃牌的归属者(鲁肃座次) */
const PENDING_OWNER_KEY = '界缔盟/待弃归属';

const OPTIONS: DimengOptions = {
  skillKey: '界缔盟',
  displayName: '缔盟',
  description:
    '出牌阶段限一次,令两名角色交换手牌(差不大于你的牌数),出牌阶段结束时弃X张牌(X为手牌数差)',
  chooseTitle: '缔盟:选择两名其他角色交换手牌(差不大于你的牌数)',
  mismatchError: '当前不是界缔盟询问',
  strictDiscardRespond: false,
  resolveAfterTargets: async (st, ownerId, A, B, diff, _discardRt, _discardKey) => {
    // 前置条件:两者手牌数差 ≤ 鲁肃的牌数(手牌+装备)
    const myCards = totalCardCount(st.players[ownerId]);
    if (diff > myCards) return; // 差值超过鲁肃牌数,不执行

    // 界版:先交换手牌(不等弃牌)
    await swapHands(st, A, B);

    // 记录延迟弃牌:X=手牌数差,出牌阶段结束时弃
    if (diff > 0) {
      st.localVars[PENDING_DISCARD_KEY] = diff;
      st.localVars[PENDING_OWNER_KEY] = ownerId;
    }
  },
  extraInit: (state, skillId, ownerId) => [
    // ── 阶段结束(出牌) before-hook:出牌阶段结束时,鲁肃弃 X 张牌 ──
    registerBeforeHook(state, skillId, ownerId, '阶段结束', async (ctx): Promise<void> => {
      const atom = ctx.atom;
      if (atom.phase !== '出牌') return;
      if (atom.player !== ownerId) return;

      const st = ctx.state;
      const pendingX = st.localVars[PENDING_DISCARD_KEY] as number | undefined;
      const pendingOwner = st.localVars[PENDING_OWNER_KEY] as number | undefined;
      if (typeof pendingX !== 'number' || pendingOwner !== ownerId) return;
      // 清除标记(无论是否成功弃牌)
      delete st.localVars[PENDING_DISCARD_KEY];
      delete st.localVars[PENDING_OWNER_KEY];

      if (!st.players[ownerId]?.alive) return;
      const actualDiscard = Math.min(pendingX, st.players[ownerId].hand.length);
      if (actualDiscard <= 0) return;

      await askMandatoryDiscard(
        st,
        ownerId,
        DISCARD_RT,
        DISCARD_KEY,
        actualDiscard,
        `缔盟:出牌阶段结束,弃置 ${actualDiscard} 张牌`,
      );
    }),
  ],
};

export const { createSkill, onInit, onMount } = createDimengSkill(OPTIONS);

const _skillModule: SkillModule = { createSkill, onInit, onMount };
export default _skillModule;
