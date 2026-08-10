// 纯展示型 atom:这些 ViewEvent.type 不是引擎 dispatch 的 Atom.type
// (AtomName 联合不含它们),而是其他 atom 的 toViewEvents othersView 使用的展示型事件
// (如选将询问的 othersView=等待选将、移动牌的 othersView=打出)。
//
// 导出为独立 map,core/atom.ts 的 getAtomDef 在 atomMap 未命中时 fallback 查此处,
// 调用空 applyView 安全跳过——避免 getAtomDef 抛错中断 events 批次处理。
import type { AtomDefinition } from '../types';

/** 纯展示型 atom 模板:无 validate/apply 副作用,空 applyView */
function displayOnly(type: string): AtomDefinition {
  return {
    type,
    validate: () => null,
    apply: () => {},
    applyView: () => {},
  };
}

/** 展示型 ViewEvent.type → no-op AtomDefinition。getAtomDef fallback 查此处。 */
export const 展示型atoms: Record<string, AtomDefinition> = {
  '等待选将': displayOnly('等待选将'),
  '打出': displayOnly('打出'),
};
