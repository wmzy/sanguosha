import { describe, expect } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('贾诩 - 帷幕', () => {
  scenario('不能成为黑色锦囊的目标')
    .setup(ctx => {
      ctx.selectCharacters('贾诩', '曹操');
    })
    .act('触发 turnStart 让帷幕标记生效', ctx => {
      ctx.emitEvent({ type: 'turnStart', player: 'P1' });
    })
    .check('贾诩拥有帷幕标记', ctx => {
      const p1 = ctx.player('P1');
      expect(p1.tags).toContain('barrier');
    })
    .run();
});

describe('贾诩 - 完杀', () => {
  it.skip('完杀：回合内只有濒死角色能用桃（需要濒死窗口的桃使用限制逻辑）', () => {
    // 完杀需要修改濒死窗口的桃使用验证逻辑，涉及验证层扩展
  });
});

describe('贾诩 - 乱武', () => {
  it.skip('乱武：限定技，令所有其他角色对最近角色出杀（需要复杂的AOE式链式交互）', () => {
    // 乱武需要遍历所有其他角色、计算距离最近、强制出杀或掉血
    // 是限定技且涉及多玩家串行交互，暂时跳过
  });
});
