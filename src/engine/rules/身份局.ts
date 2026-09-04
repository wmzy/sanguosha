// 身份局规则包:标准身份局(2-8 人,主公/忠臣/反贼/内奸)。
// 组合 skills/系统规则 的引擎级 hooks(技能生命周期/濒死/装备兜底)与身份局胜负判定。
// checkGameOver 自 core/index.ts 迁入——core 层不再感知任何具体模式规则(ADR 0029)。
import type { GameState } from '../types';
import type { GameOverResult, RulesetModule } from './types';
import {
  createSkill as createSystemSkill,
  onInit as systemOnInit,
  registerSystemRespondActions,
} from '../skills/系统规则';

/** 身份局胜负判定(纯函数)。
 *  结束条件:主公死亡,或主公存活但所有反贼/内奸均已死亡,或存活 ≤ 1 人。
 *  胜方判定:winner 为某阵营代表座次,前端按其 identity 推导获胜阵营文案。
 *  - 主公阵亡:反贼仍存活 → 反贼胜;反贼全灭且内奸存活(内奸清场单挑残局)→ 内奸胜;
 *    极端(反贼/内奸均无存活)→ 仍判反贼胜。
 *  - 主公存活但反贼/内奸全灭:主公方(主忠)胜,winner=主公座次。
 *  - 仅剩一人存活:winner=存活者(主公→主公方,反贼→反贼,内奸→内奸)。
 *  1v1(2 人身份局)是本逻辑的特化:主公死=反贼胜,反贼死=主公胜。 */
export function checkIdentityGameOver(state: GameState): GameOverResult {
  // 主公死亡 → 游戏立即结束
  const lord = state.players.find((p) => p.identity === '主公');
  if (lord && !lord.alive) {
    const aliveRebel = state.players.find((p) => p.alive && p.identity === '反贼');
    if (aliveRebel) return { gameOver: true, winner: aliveRebel.index };
    const aliveRenegade = state.players.find((p) => p.alive && p.identity === '内奸');
    if (aliveRenegade) return { gameOver: true, winner: aliveRenegade.index };
    // 极端(反贼/内奸均无存活,如闪电连劈)→ 仍判反贼获胜,取任一反贼座次作阵营代表
    const anyRebel = state.players.find((p) => p.identity === '反贼');
    return { gameOver: true, winner: anyRebel?.index };
  }
  // 主公存活:所有反贼和内奸均已死亡 → 主公方(主忠)获胜
  if (lord?.alive) {
    const aliveEnemy = state.players.find(
      (p) => p.alive && (p.identity === '反贼' || p.identity === '内奸'),
    );
    if (!aliveEnemy) return { gameOver: true, winner: lord.index };
  }
  const aliveCount = state.players.filter((p) => p.alive).length;
  if (aliveCount <= 1) {
    const winner = state.players.find((p) => p.alive);
    return { gameOver: true, winner: winner?.index };
  }
  return { gameOver: false };
}

/** 身份局选将候选数(三国杀OL身份模式标准)。
 *  主公:常备主公 + 非常备主公共 7 个候选位置;
 *  忠臣/内奸:比普通玩家多 1 个,即 5 个;反贼:基础 4 个。 */
const CANDIDATES_PER_IDENTITY: Record<string, number> = {
  主公: 7,
  忠臣: 5,
  反贼: 4,
  内奸: 5,
};

const ruleset: RulesetModule = {
  mode: '身份局',
  onInit(state: GameState): () => void {
    // 系统规则 hooks(技能生命周期/濒死检查/装备兜底) + 每座次 选将/弃牌 respond actions
    systemOnInit(createSystemSkill('系统规则', -1), state);
    for (const player of state.players) {
      registerSystemRespondActions(state, player.index);
    }
    return () => {};
  },
  checkGameOver: checkIdentityGameOver,
  opening: {
    candidatesPerIdentity: CANDIDATES_PER_IDENTITY,
    lordPickEnabled: true,
  },
};

export default ruleset;
