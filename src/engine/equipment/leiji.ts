// engine/skills/leiji.ts — 雷击（张角）v3 registerAtomHook 实现
//
// 雷击真 game rule：
// - 当你使用或打出【闪】时，可令任意一名角色判定
// - 若结果为黑桃 2-9，对该角色造成 3 点雷电伤害
//
// 本文件实现：v3 钩子骨架 + 判定结果（ctx）驱动的 onAfter。
// filter：source=张角 && card.suit=♠ && card.rank 在 2-9 之间
// onAfter：读 state.localVars.leijiJudgeResult
//   - 'success' → emit 3 点雷电伤害
//   - 'fail' 或缺失 → 不 emit
//
// 完整 useCard 阶段 inject leijiJudgeResult 留 follow-up。
// 真实 `useCard` 原子 3 阶段（specifyTarget / becomeTarget / resolveCard）
// 在 [T-13] 决策下替代旧的 useCard 路径——但 hook 仍按 `useCard` 注册，
// 等 useCard atom 上线后此钩子自动接入。
//
// 本文件是角色技能（张角），由 @engine/skills/qun.ts 的 registerSkill
// 占位注册做真实实现；本钩子是叠加在 useCard 路径上的"真 game rule"骨架。

import type { HookRegistry } from '../skill-hook';
import { getPlayer } from '../state';
import type { Atom, GameState, SkillDef } from '../types';

/**
 * `useCard` atom 当前不在 Atom 联合里（[T-13] 决策下被 specifyTarget /
 * becomeTarget / resolveCard 三原子取代），但 hook 注册仍按 `useCard`
 * 字面量走——等 useCard atom 上线后此钩子自动接入。
 *
 * 因此用本文件局部 type guard 把 `atom: Atom` 在 hook 闭包内
 * 收窄到一个 *已知 shape*（UseCardAtom），避免 unchecked cast 关闭类型检查。
 */
interface UseCardAtom {
  type: 'useCard';
  source?: unknown;
  target?: unknown;
  cardId?: unknown;
}

function asUseCard(atom: Atom): UseCardAtom | null {
  // 严格 type guard：atom.type 必须是字面量 'useCard'，但当前 Atom 联合
  // 不含 'useCard'，所以走 unknown 边界 — 保留运行时正确性 + 静态类型推断。
  const candidate = atom as unknown;
  if (
    candidate !== null &&
    typeof candidate === 'object' &&
    (candidate as { type?: unknown }).type === 'useCard'
  ) {
    return candidate as UseCardAtom;
  }
  return null;
}

export const skills: SkillDef[] = [
  {
    id: '雷击',
    name: '雷击',
    description:
      '当你使用或打出【闪】时，可令任意一名角色判定，若结果为黑桃 2-9，对该角色造成 3 点雷电伤害。',
    registerHooks(registry: HookRegistry) {
      registry.register({
        atomType: 'useCard',
        filter(state: GameState, atom: Atom): boolean {
          const useCard = asUseCard(atom);
          if (!useCard) return false;
          const source = typeof useCard.source === 'string' ? useCard.source : undefined;
          if (!source) return false;
          const p = getPlayer(state, source);
          if (!p) return false;
          // 张角的 characterId
          if (p.info?.characterId !== '张角') return false;
          const cardId = typeof useCard.cardId === 'string' ? useCard.cardId : undefined;
          if (!cardId) return false;
          const card = state.cardMap[cardId];
          if (!card) return false;
          if (card.suit !== '♠') return false;
          // card.rank 是 Rank 字符串（'A' | '2' | ... | 'K'）。判定黑桃 2-9：
          // Number('2'..'9') = 2..9；其他（A=NaN, 10/J/Q/K=NaN）→ 跳过
          const rankNum = Number(card.rank);
          if (!Number.isFinite(rankNum) || rankNum < 2 || rankNum > 9) return false;
          return true;
        },
        onAfter({ state, atom }) {
          const useCard = asUseCard(atom);
          if (!useCard) return {};
          const target = typeof useCard.target === 'string' ? useCard.target : undefined;
          if (!target) return {};
          const source = typeof useCard.source === 'string' ? useCard.source : undefined;
          const cardId = typeof useCard.cardId === 'string' ? useCard.cardId : undefined;
          if (!source || !cardId) return {};
          // 真 game rule：读 state.localVars.leijiJudgeResult
          // 'success' → emit 3 点 thunder damage；'fail' 或缺失 → 不 emit
          const judge = state.localVars?.leijiJudgeResult;
          if (judge !== 'success') return {};
          return {
            additionalAtoms: [
              {
                type: '造成伤害' as const,
                target,
                amount: 3,
                source,
                cardId,
                damageType: 'thunder' as const,
              },
            ],
          };
        },
      });
    },
  },
];
