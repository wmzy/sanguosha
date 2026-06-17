// 验证选将/respond 注册到每玩家座次,dispatch 精确查找命中
import { describe, it, expect, beforeEach } from 'vitest';
import { resetForTest } from '../../src/engine/create-engine';
import { findActionEntry } from '../../src/engine/skill';
import { registerSystemRespondActions } from '../../src/engine/skills/系统规则';
import '../../src/engine/atoms';
import '../../src/engine/skills';

describe('选将/respond 注册到每玩家座次', () => {
  beforeEach(() => resetForTest());

  it('registerSystemRespondActions 注册到具体座次,findActionEntry 精确命中', () => {
    registerSystemRespondActions(0);
    registerSystemRespondActions(1);
    // 玩家0 的选将/respond
    expect(findActionEntry('系统规则', 0, '选将')).toBeDefined();
    expect(findActionEntry('系统规则', 0, 'respond')).toBeDefined();
    // 玩家1
    expect(findActionEntry('系统规则', 1, '选将')).toBeDefined();
    expect(findActionEntry('系统规则', 1, 'respond')).toBeDefined();
    // -1 不应存在(不再全局注册)
    expect(findActionEntry('系统规则', -1, '选将')).toBeUndefined();
    expect(findActionEntry('系统规则', -1, 'respond')).toBeUndefined();
  });

  it('选将 validate 校验只有被问询玩家能回应', () => {
    registerSystemRespondActions(0);
    registerSystemRespondActions(1);
    const entry0 = findActionEntry('系统规则', 0, '选将')!;
    // 构造选将询问 pending,target=0
    const state: any = {
      pendingSlots: new Map([[0, { atom: { type: '选将询问', target: 0, candidates: [{ name: '刘备', skills: ['仁德'] }] } }]]),
      players: [],
    };
    // 玩家0 能回应(被问询)
    expect(entry0.validate(state, { character: '刘备' })).toBeNull();
    // 玩家1 不能回应(不是被问询的玩家)
    const entry1 = findActionEntry('系统规则', 1, '选将')!;
    expect(entry1.validate(state, { character: '刘备' })).not.toBeNull();
  });
});
