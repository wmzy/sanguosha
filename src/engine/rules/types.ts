// 规则包(Ruleset)类型定义:游戏模式的引擎级扩展点。
// 一个规则包 = 模式级全局规则(胜负判定) + 开局流程配置 + 全局 hooks 组合。
// core 层只认识本接口(经 registry 动态加载),不静态依赖任何具体规则实现——
// 见 ADR 0029。
import type { GameState } from '../types';

/** 游戏模式。新模式(如 国战)在此扩字面量并在 registry 注册后即可用。 */
export type GameMode = '身份局' | '1v1';

export interface GameOverResult {
  gameOver: boolean;
  /** 获胜阵营代表座次(前端按其 identity 推导获胜阵营文案) */
  winner?: number;
}

/** 开局流程配置(开局 skill 消费):选将候选数与主公开局特权。 */
export interface OpeningConfig {
  /** 各身份的选将候选数(按玩家 identity 下发)。 */
  candidatesPerIdentity: Record<string, number>;
  /** 主公是否先选(串行,常备/非常备拆分 7 候选)。
   *  false = 全员并行等额选将(1v1:无主公特权)。 */
  lordPickEnabled: boolean;
}

/** 规则包模块接口:src/engine/rules/<模式>.ts 的统一契约。 */
export interface RulesetModule {
  /** 模式标识(与 GameMode 字面量一一对应)。 */
  mode: GameMode;
  /** 开局前注册全局 hooks 与系统级 respond actions(bootstrap/registerSkillsFromState 调用)。
   *  实现为各规则组合(身份局/1v1 复用 skills/系统规则 的引擎级 hooks)。 */
  onInit(state: GameState): () => void;
  /** 胜负判定。纯函数,基于 state 计算;session 在每次 onStateChange 后同步调用。 */
  checkGameOver(state: GameState): GameOverResult;
  /** 开局流程配置。 */
  opening: OpeningConfig;
}
