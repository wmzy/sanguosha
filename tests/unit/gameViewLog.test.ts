// tests/unit/gameViewLog.test.ts
// GameView 日志格式化：面向玩家的文本不得暴露内部 cardId / 座次下标 / __skip。
import { describe, it, expect } from 'vitest';
import { formatLogEntry } from '../../src/engine/view/buildView';
import type { Card, ClientMessage } from '../../src/engine/types';

const cardMap: Record<string, Card> = {
  '杀-♣6-92': { id: '杀-♣6-92', name: '杀', type: '基本牌', suit: '♣', rank: '6' } as Card,
  '的卢-♣5-91': { id: '的卢-♣5-91', name: '的卢', type: '装备牌', suit: '♣', rank: '5' } as Card,
  '无懈可击-♦Q-78': {
    id: '无懈可击-♦Q-78',
    name: '无懈可击',
    type: '锦囊牌',
    suit: '♦',
    rank: 'Q',
  } as Card,
};
const names = ['孙权', '毌丘俭', '刘备'];
const ctx = { cardMap, resolveName: (i: number) => names[i] };

function msg(partial: Partial<ClientMessage> & Pick<ClientMessage, 'skillId' | 'actionType' | 'params'>): ClientMessage {
  return { ownerId: 0, baseSeq: 0, ...partial };
}

describe('formatLogEntry', () => {
  it('装备通用使用实际牌名与花色点数，不暴露实例 id', () => {
    const text = formatLogEntry(
      msg({
        skillId: '装备通用',
        actionType: 'use',
        params: { cardId: '的卢-♣5-91' },
      }),
      ctx,
    );
    expect(text).toBe('使用【的卢】(♣5)');
    expect(text).not.toContain('91');
  });

  it('杀 + 目标：输出【杀】(♣6) 与目标角色名', () => {
    const text = formatLogEntry(
      msg({
        skillId: '杀',
        actionType: 'use',
        params: { cardId: '杀-♣6-92', targets: [1] },
      }),
      ctx,
    );
    expect(text).toBe('使用【杀】(♣6) → 毌丘俭');
  });

  it('延时锦囊单数 target 也显示目标角色名', () => {
    const text = formatLogEntry(
      msg({
        skillId: '乐不思蜀',
        actionType: 'use',
        params: { cardId: '无懈可击-♦Q-78', target: 2 },
      }),
      ctx,
    );
    expect(text).toBe('使用【无懈可击】(♦Q) → 刘备');
  });

  it('回应：输出牌名而不是内部 cardId', () => {
    const text = formatLogEntry(
      msg({
        skillId: '无懈可击',
        actionType: 'respond',
        params: { cardId: '无懈可击-♦Q-78' },
      }),
      ctx,
    );
    expect(text).toBe('响应【无懈可击】(♦Q)');
  });

  it('影子卡 id 取 # 前的原牌', () => {
    const text = formatLogEntry(
      msg({
        skillId: '杀',
        actionType: 'use',
        params: { cardId: '杀-♣6-92#武圣' },
      }),
      ctx,
    );
    expect(text).toBe('使用【杀】(♣6)');
  });

  it('自动跳过显示为「跳过」，不暴露 __skip', () => {
    expect(
      formatLogEntry(msg({ skillId: '__skip', actionType: 'skip', params: {} }), ctx),
    ).toBe('跳过');
  });

  it('弃牌列出实际牌名', () => {
    const text = formatLogEntry(
      msg({
        skillId: '弃牌',
        actionType: 'discard',
        params: { cardIds: ['杀-♣6-92', '的卢-♣5-91'] },
      }),
      ctx,
    );
    expect(text).toBe('弃置【杀】(♣6)、【的卢】(♣5)');
  });
});
