// tests/integration/双人对战.test.ts
import { describe, it, expect } from 'vitest';
import { 创建游戏, 开始游戏 } from '@engine/state';
import { 进入下一阶段, 摸牌阶段, 弃牌阶段检查, 弃牌阶段执行 } from '@engine/turn';
import { useKill, usePeach } from '@engine/effect';
import { 曹操, 刘备 } from '@shared/characters';

describe('双人对战', () => {
  it('应该能完成一局完整的2人游戏流程', () => {
    // 创建游戏
    let 游戏 = 创建游戏([曹操, 刘备]);
    游戏 = 开始游戏(游戏);

    expect(游戏.status).toBe('进行中');
    expect(游戏.players.length).toBe(2);
    expect(游戏.currentPlayer).toBe('曹操');

    // 第一回合: 准备阶段
    expect(游戏.phase).toBe('准备');
    游戏 = 进入下一阶段(游戏);

    // 判定阶段
    expect(游戏.phase).toBe('判定');
    游戏 = 进入下一阶段(游戏);

    // 摸牌阶段
    expect(游戏.phase).toBe('摸牌');
    const 摸牌结果 = 摸牌阶段(游戏);
    游戏 = 摸牌结果.status;
    expect(游戏.players[0].hand.length).toBe(2);

    // 出牌阶段 - 使用杀
    游戏 = 进入下一阶段(游戏);
    expect(游戏.phase).toBe('出牌');

    // 找到一张杀
    const 杀牌 = 游戏.players[0].hand.find(c => c.name === '杀');
    if (杀牌) {
      const 杀结果 = useKill(游戏, '曹操', '刘备');
      expect(杀结果.success).toBe(true);
      游戏 = 杀结果.status;
      expect(游戏.players[1].health).toBe(3);
    }

    // 弃牌阶段
    游戏 = 进入下一阶段(游戏);
    expect(游戏.phase).toBe('弃牌');
    const 需要弃牌 = 弃牌阶段检查(游戏);
    if (需要弃牌) {
      游戏 = 弃牌阶段执行(游戏, [0]); // 弃第一张牌
    }

    // 结束阶段
    游戏 = 进入下一阶段(游戏);
    expect(游戏.phase).toBe('结束');

    // 进入下一回合 (刘备的回合)
    游戏 = 进入下一阶段(游戏);
    expect(游戏.phase).toBe('准备');
    expect(游戏.currentPlayer).toBe('刘备');
    expect(游戏.round).toBe(2);
  });

  it('应该正确处理伤害和死亡', () => {
    const 游戏 = 创建游戏([曹操, 刘备]);
    游戏.status = '进行中';

    // 对刘备造成4点伤害 (致命)
    let 当前游戏 = 游戏;
    for (let i = 0; i < 4; i++) {
      const 结果 = useKill(当前游戏, '曹操', '刘备');
      当前游戏 = 结果.status;
    }

    const 刘备玩家 = 当前游戏.players.find(p => p.name === '刘备')!;
    expect(刘备玩家.health).toBe(0);
  });

  it('应该正确使用桃恢复体力', () => {
    const 游戏 = 创建游戏([曹操, 刘备]);
    游戏.status = '进行中';
    游戏.currentPlayer = '曹操';

    // 先受伤
    const 伤害结果 = useKill(游戏, '曹操', '刘备');
    expect(伤害结果.status.players[1].health).toBe(3);

    // 给刘备一张桃 (注: 使用桃仅检查体力上限，不检查手牌)
    const 受伤游戏 = 伤害结果.status;
    受伤游戏.players[1].hand = [{ name: '桃', type: '基本牌', 子type: '桃', suit: '♥', rank: '7', description: '' }];

    // 刘备使用桃
    const 桃结果 = usePeach(受伤游戏, '刘备');
    expect(桃结果.success).toBe(true);
    expect(桃结果.status.players[1].health).toBe(4);
  });
});
