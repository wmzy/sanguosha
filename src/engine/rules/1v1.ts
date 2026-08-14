// 1v1 规则包:两人对决(主公 vs 反贼,先死即负)。
// 引擎级规则(濒死/技能生命周期)与身份局一致,复用 skills/系统规则 组合;
// 胜负判定复用身份局逻辑的两人特化(主公死=反贼胜,反贼死=主公胜)。
// 差异在开局:无主公特权——全员并行等额选将(每人 5 候选),
// 主公体力上限不 +1(分配武将的 +1 仅 5 人以上生效,2 人局天然不触发)。
import type { GameState } from '../types';
import type { RulesetModule } from './types';
import 身份局, { checkIdentityGameOver } from './身份局';

const ruleset: RulesetModule = {
  mode: '1v1',
  onInit(state: GameState): () => void {
    return 身份局.onInit(state);
  },
  checkGameOver: checkIdentityGameOver,
  opening: {
    candidatesPerIdentity: { 主公: 5, 反贼: 5, 忠臣: 5, 内奸: 5 },
    lordPickEnabled: false,
  },
};

export default ruleset;
