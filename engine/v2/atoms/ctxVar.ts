import type { Json } from '../types';
import { registerSimpleAtom } from '../atom';

/**
 * setCtxVar — 将值写入 SkillContext.localVars。
 * 不修改 GameState，仅作为信号 atom 由 executePlan 处理。
 */
registerSimpleAtom(
  'setCtxVar',
  (state, _atom: { key: string; value: Json }) => state,
  (_state, atom: { key: string; value: Json }): Json => ({ key: atom.key, value: atom.value }),
);
