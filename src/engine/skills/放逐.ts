// 放逐(曹丕·被动技):每当你受到一次伤害后,可以令除你以外的任一角色补 X 张牌
//   (X 为你已损失体力值),然后该角色将其武将牌翻面。
//
// 模式 A(被动触发):after hook 挂在「受到伤害后」。
//   受到伤害(target=自己) → 询问发动 → 选目标 → 摸 X 张(X=已损失体力) → 翻面。
//   (结算语序按版本注入:标版先摸后翻 / 界版先翻后摸,官方语序)
//
// 翻面实现(同据守的手法,但标签名独立,与据守互不干扰):
//   - 加标签 `放逐/翻面` 到目标(下一回合开始时消费)
//   - 跳回合 hook 对复用 flows/face-down 的 registerFlipSkipTurnHooks:
//     目标准备阶段开始 + 有翻面标签 → 移除标签 + 设 skipAll 标志 + cancel,
//     skipAll 存续期间 cancel 其余所有阶段;阶段结束 hook 主动推进回合
//     (避免 phase-end after-hook 推进产生幻影阶段链)
//
// 关键点:
//   - X = maxHealth - health(已损失体力值),血越少摸牌越多
//   - 目标不能是自己(FAQ)
//   - 已知简化:对已背面目标再次放逐不实现官方 toggle(翻面两次=翻回正面),
//     与全引擎翻面模型一致(flipFaceDown 只追加标签,回合管理的 flipFaceUpAll
//     一次清全部 /翻面 标签,双翻无法对消)
//   - 翻面 hook 注册在曹丕座次,但 hook 对所有玩家的阶段 atom 触发,callback 内
//     检查目标 player 是否有翻面标签。曹丕存活期内有效。
//
// 本文件同时导出 createFangzhuSkill 工厂(放逐族共享实现),界放逐 复用之,
// 仅注入 技能名/描述/询问 requestType(界放逐/…)/文案/结算语序 差异;
// localVars 确认与目标键、翻面标签 '放逐/翻面' 与标版共用——同一角色只会拥有一版放逐。
import type {
  FrontendAPI,
  GameState,
  GameView,
  Json,
  Skill,
  SkillModule,
} from '../types';
import { getHealthValue } from '../types';
import { applyAtom } from '../core/apply';
import { flipFaceDown, registerFlipSkipTurnHooks } from '../flows/face-down';
import { registerAction, registerAfterHook } from '../core/skill';
import { askConfirm, askResponse, currentRequestType, defineConfirmAction, firstTarget, requireRequestType } from '../util/skillRuntime';

// 放逐族共享键(localVars):确认与目标结果
// (翻面标签 '放逐/翻面' 与跳过标志 '放逐/skipAll' 由 face-down 通用版按 reason '放逐'
//  构造,标/界放逐共用——同一角色只会拥有一版放逐)
const CONFIRMED_KEY = '放逐/confirmed';
const TARGET_KEY = '放逐/target';

/** 放逐族差异参数。 */
export interface FangzhuOptions {
  /** 技能名(Skill.name / 询问文案前缀;标 '放逐' / 界 '界放逐') */
  name: string;
  description: string;
  /** 询问 requestType(键空间按版本隔离:标 '放逐/confirm' / 界 '界放逐/confirm') */
  confirmRt: string;
  targetRt: string;
  /** 发动确认标题(lostHealth = 已损失体力值 X) */
  confirmTitle: (lostHealth: number) => string;
  /** 选目标询问标题 */
  chooseTitle: string;
  /** 结算语序:true = 先摸牌后翻面(标)/ false = 先翻面后摸牌(界,官方语序) */
  drawFirst: boolean;
  /** onMount confirm 按钮(label/title) */
  mountLabel: string;
  mountTitle: string;
}

/** 放逐族共享实现:标放逐与界放逐机制同构,仅 文案/RT/语序 不同。 */
export function createFangzhuSkill(opts: FangzhuOptions) {
  function createSkill(id: string, ownerId: number): Skill {
    return {
      id,
      ownerId,
      name: opts.name,
      description: opts.description,
    };
  }

  function onInit(skill: Skill, state: GameState): () => void {
    const ownerId = skill.ownerId;

    // ── respond:曹丕回应放逐的确认 + 目标选择 ──
    registerAction(
      state,
      skill.id,
      ownerId,
      'respond',
      (st: GameState, _params: Record<string, Json>) => {
        return requireRequestType(st, ownerId, [opts.confirmRt, opts.targetRt], {
          mismatchError: '当前不是放逐询问',
        }).error;
      },
      async (st: GameState, params: Record<string, Json>) => {
        const rt = currentRequestType(st, ownerId);
        if (rt === opts.confirmRt) {
          st.localVars[CONFIRMED_KEY] = params.choice === true;
        } else if (rt === opts.targetRt) {
          const t = firstTarget(params);
          if (typeof t === 'number') st.localVars[TARGET_KEY] = t;
        }
      },
    );

    // ── 受到伤害后 after:曹丕受伤后,选目标 → 摸 X 张 + 翻面(语序按版本注入)──
    registerAfterHook(state, skill.id, ownerId, '受到伤害后', async (ctx) => {
      const atom = ctx.atom;
      if (atom.target !== ownerId) return;
      if ((atom.amount ?? 0) <= 0) return;
      const self = ctx.state.players[ownerId];
      if (!self?.alive) return;

      // X = 已损失体力值
      const lostHealth = self.maxHealth - getHealthValue(self);
      if (lostHealth <= 0) return; // 满血时 X=0,放逐无意义

      // 必须有其他存活角色可选
      const hasOtherAlive = ctx.state.players.some(
        (p) => p.alive && p.index !== ownerId,
      );
      if (!hasOtherAlive) return;

      // 询问是否发动
      const confirmed = await askConfirm(ctx.state, opts.confirmRt, ownerId, {
        confirmedKey: CONFIRMED_KEY,
        title: opts.confirmTitle(lostHealth),
        confirmLabel: '发动',
        cancelLabel: '不发动',
        defaultChoice: false,
        timeout: 10,
      });
      if (!confirmed) return;

      // 选目标(其他存活角色)
      const target = await askResponse<number>(ctx.state, opts.targetRt, ownerId, {
        resultKey: TARGET_KEY,
        prompt: {
          type: 'choosePlayer',
          title: opts.chooseTitle,
          min: 1,
          max: 1,
          filter: (_view: GameView, t: number) =>
            t !== ownerId && ctx.state.players[t]?.alive === true,
        },
        timeout: 15,
      });
      if (typeof target !== 'number') return;
      if (!ctx.state.players[target]?.alive) return;

      if (opts.drawFirst) {
        // 摸 X 张牌 → 翻面(标版语序)
        await applyAtom(ctx.state, { type: '摸牌', player: target, count: lostHealth });
        // 翻面:加标签(下一回合开始时消费)
        await flipFaceDown(ctx.state, target, '放逐');
      } else {
        // 翻面 → 摸 X 张牌(界版官方语序:「令一名其他角色翻面,并令其摸X张牌」)
        await flipFaceDown(ctx.state, target, '放逐');
        await applyAtom(ctx.state, { type: '摸牌', player: target, count: lostHealth });
      }
    });

    // ── 翻面跳过 hooks(共用 face-down 通用版;放逐翻的是目标他人 → scope 'any',
    //    注册在曹丕座次,但对所有玩家的阶段 atom 触发,callback 内按 player 检查)──
    registerFlipSkipTurnHooks(state, skill.id, ownerId, '放逐', { scope: 'any' });

    return () => {};
  }

  function onMount(_skill: Skill, api: FrontendAPI): void {
    defineConfirmAction(api, 'respond', {
      label: opts.mountLabel,
      title: opts.mountTitle,
    });
  }

  return { createSkill, onInit, onMount };
}

const OPTIONS: FangzhuOptions = {
  name: '放逐',
  description: '受到伤害后,令一名其他角色摸 X 张牌(X=已损失体力)并翻面',
  confirmRt: '放逐/confirm',
  targetRt: '放逐/target',
  confirmTitle: (lostHealth) => `是否发动放逐?(令一名其他角色摸 ${lostHealth} 张牌并翻面)`,
  chooseTitle: '放逐:选择一名其他角色(摸牌并翻面)',
  drawFirst: true,
  mountLabel: '放逐',
  mountTitle: '是否发动放逐?',
};

export const { createSkill, onInit, onMount } = createFangzhuSkill(OPTIONS);

export default { createSkill, onInit, onMount } satisfies SkillModule;
