// src/client/components/GameViewCtx.tsx
// GameView 共享数据 Context:承载「全树共享、随 view/技能注册变化」的横切数据
// (view/perspectiveIdx/perspectiveName/isSpectating/canOperate/currentPlayerName/
// skillActions/send),消除 GameView 编排层向子组件逐个透传重复 props;
// 各子组件的专属数据(动画状态/pending/交互 handler 等)仍走 props。
//
// 性能约定:value 由 GameView 用 useMemo 构造(view 每条 WS 消息都是新引用,
// value 引用随之变化)。带自定义 comparator 的 memo 子组件(GameHeader/ZoneInfoBar/
// PlayPhasePrompt/EquipColumn/PlayerCardLarge/InfoDock)一律采用「context 消费壳 +
// 内部 memo impl」模式消费本 context:导出的壳组件从 context 取共享字段转发给保持
// 原 comparator 的 memo impl;禁止在 memo impl 内直接 useContext——那会让 memo 拦截
// 失效,回归每条 WS 消息全量重渲染。

import { createContext, useContext, type ReactNode } from 'react';
import type { GameView as EngineGameView, Json } from '../../engine/types';
import type { SkillActionDef } from '../skillActionRegistry';

/** GameView 全树共享的横切数据(由 GameView useMemo 构造后经 Provider 下发)。 */
export interface GameViewCtxValue {
  /** 引擎视图(每条 WS 消息均为新引用) */
  view: EngineGameView;
  /** 展示视角座次(GameView 已 clamp 到有效范围;旁观者借用座次 0) */
  perspectiveIdx: number;
  /** 展示视角玩家名 */
  perspectiveName: string;
  /** 是否旁观视角(viewer<0,看不到任何手牌) */
  isSpectating: boolean;
  /** 是否可操作(回放只读时为 false) */
  canOperate: boolean;
  /** 当前回合玩家名 */
  currentPlayerName: string;
  /** 已注册的技能前端 actions(useSkillActions 产出,引用已 memo) */
  skillActions: SkillActionDef[];
  /** 玩家动作唯一出口(与 GameView 内 send 同签名;提交即清除粘性展示卡) */
  send: (
    skillId: string,
    actionType: string,
    params: Record<string, Json>,
    preceding?: Array<{ skillId: string; actionType: string; params: Record<string, Json> }>,
  ) => void;
}

const GameViewCtx = createContext<GameViewCtxValue | null>(null);

/** 在 GameView 返回树最外层下发共享数据。 */
export function GameViewProvider({
  value,
  children,
}: {
  value: GameViewCtxValue;
  children: ReactNode;
}) {
  return <GameViewCtx.Provider value={value}>{children}</GameViewCtx.Provider>;
}

/** 取 GameView 共享数据;必须在 GameViewProvider 内使用。 */
export function useGameView(): GameViewCtxValue {
  const ctx = useContext(GameViewCtx);
  if (ctx === null) {
    throw new Error(
      'useGameView 必须在 <GameViewProvider> 内使用:该组件是 GameView 渲染树的子组件,' +
        '正常由 GameView 自动提供;若需独立渲染(如测试),请构造 GameViewCtxValue 并用 ' +
        '<GameViewProvider value={...}> 包裹,或直接渲染组件的内部 impl。',
    );
  }
  return ctx;
}
