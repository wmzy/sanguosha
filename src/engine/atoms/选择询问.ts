import type { AtomDefinition } from "../types";

export const 选择询问: AtomDefinition<{ choice: number }> = { 
    type: '选择询问', validate: (state) => {
    if (state.choiceQueue?.length === 0) return '没有选择询问选项';
    return null;
  }, apply: (state, atom) => {
    const { choice } = atom;
    const choiceSlot = state.choiceQueue?.[choice];
    state.pendingSlot = choiceSlot;
    state.choiceQueue = state.choiceQueue?.filter((_, i) => i !== choice);
  }
};
