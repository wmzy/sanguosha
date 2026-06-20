// src/client/hooks/useSkillActions.ts
// 技能 action 注册表管理 hook。从 GameView.tsx 提取。
//
// view 变化时异步重新注册所有玩家的技能前端 actions(defineAction)。
// registerSkillActions 是 async:内部动态 import 技能模块并调用 onMount → defineAction,
// 必须 await 才能让 defineAction 完成,registry 才有内容。
//
// 设计:注册按 view.players 全量注册(所有 owner),读取只取当前 perspective 的 actions。
// registry 是全局单例,clearRegistry + 全量重注册保证视角切换时数据一致。

import { useState, useEffect } from 'react';
import type { GameView } from '../../engine/types';
import { getActionsForPlayer, registerSkillActions, clearRegistry, type SkillActionDef } from '../skillActionRegistry';

export interface UseSkillActionsResult {
  /** 当前视角玩家已注册的技能 actions(技能按钮区/装备技能按钮用) */
  skillActions: SkillActionDef[];
}

/**
 * 管理 skillActionRegistry 的注册生命周期。
 * @param view      引擎视图(取 players 注册 / perspective 取 actions)
 * @param perspectiveIdx 当前视角座次
 */
export function useSkillActions(view: GameView, perspectiveIdx: number): UseSkillActionsResult {
  // 注册 key:players + skills 组合变化时重新注册
  const skillActionsKey = view.players.map(p => `${p.name}:${p.skills.join(',')}`).join('|');
  const [skillActions, setSkillActions] = useState<SkillActionDef[]>([]);

  useEffect(() => {
    let cancelled = false;
    clearRegistry();
    (async () => {
      for (const p of view.players) {
        await registerSkillActions(p.index, p.skills);
      }
      if (!cancelled) {
        setSkillActions(getActionsForPlayer(perspectiveIdx));
      }
    })();
    return () => { cancelled = true; };
  }, [skillActionsKey, perspectiveIdx]);

  return { skillActions };
}
