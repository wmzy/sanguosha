// 规则包注册表:模式名 → 动态 import loader。
// core/bootstrap、开局 skill、session 通过 loadRuleset 按需加载,ES 模块缓存
// 保证重复加载零开销(无需自建 memo Map,也符合引擎无模块级可变状态的约束)。
// 本文件自身零副作用:只有静态表 + 函数,不 import 任何具体规则包。
import type { GameMode, RulesetModule } from './types';

/** 模式 → 规则包模块 loader(解包 default 导出)。新增模式:扩 GameMode 字面量 + 在此注册。 */
const RULESET_LOADERS: Record<GameMode, () => Promise<RulesetModule>> = {
  身份局: async () => (await import('./身份局')).default,
  '1v1': async () => (await import('./1v1')).default,
};

/** 加载指定模式的规则包。未知模式(旧快照脏数据/未实现)抛错,调用方以默认模式兜底。 */
export function loadRuleset(mode: GameMode): Promise<RulesetModule> {
  const loader = RULESET_LOADERS[mode];
  if (!loader) {
    throw new Error(`不支持的游戏模式: ${String(mode)}`);
  }
  return loader();
}
