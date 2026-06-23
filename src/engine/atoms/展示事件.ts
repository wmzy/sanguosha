// 纯展示型 atom 注册:这些 ViewEvent.type 不是引擎 dispatch 的 atom,
// 而是其他 atom 的 toViewEvents othersView 使用的展示型事件
// (如选将询问的 othersView=等待选将、移动牌的 othersView=打出)。
//
// 注册它们使前端 viewReducer 能通过 getAtomDef 找到对应定义,
// 调用空 applyView 安全跳过——避免 getAtomDef 抛错中断 events 批次处理。
import type { AtomDefinition } from '../types';
import { registerAtom } from '../atom';

/** 纯展示型 atom 模板:无 validate/apply 副作用,空 applyView */
function displayOnly(type: string): AtomDefinition {
  return {
    type,
    validate: () => null,
    apply: () => {},
    applyView: () => {},
  };
}

registerAtom(displayOnly('等待选将'));
registerAtom(displayOnly('打出'));
