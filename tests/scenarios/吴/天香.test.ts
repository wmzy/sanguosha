import { describe, expect, it } from 'vitest';
import { scenario } from '../../scenario-runner';

describe('小乔 - 天香', () => {
  it.skip('天香：受到伤害时弃置红桃手牌转移伤害（需要伤害转移机制支持）', () => {
    // 天香需要在 damageReceived 事件中拦截伤害并转移给其他角色
    // 涉及伤害取消+重定向机制，当前引擎基础设施不支持
  });
});
