// engine/效果.ts
import type { GameState } from '../shared/types';
import type { GameLogger } from './logger';

interface EffectResult {
  成功: boolean;
  状态: GameState;
  消息: string;
}

export function 使用杀(游戏: GameState, 使用者名: string, 目标名: string, logger?: GameLogger): EffectResult {
  const 使用者 = 游戏.玩家列表.find(p => p.name === 使用者名);
  const 目标 = 游戏.玩家列表.find(p => p.name === 目标名);

  if (!使用者 || !目标) {
    return { 成功: false, 状态: 游戏, 消息: '玩家不存在' };
  }

  if (使用者名 === 目标名) {
    return { 成功: false, 状态: 游戏, 消息: '不能对自己使用杀' };
  }

  if (!目标.存活) {
    return { 成功: false, 状态: 游戏, 消息: '目标已死亡' };
  }

  // 造成1点伤害
  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.name === 目标名) {
      return { ...p, 体力: p.体力 - 1 };
    }
    return p;
  });

  const result: EffectResult = {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表 },
    消息: `${使用者名} 对 ${目标名} 使用杀，造成1点伤害`,
  };

  if (logger) {
    logger.logServerOp('damage', {
      source: 使用者名,
      target: 目标名,
      amount: 1,
      cardName: '杀',
    }, `${使用者名} 对 ${目标名} 使用杀，造成1点伤害`);
    for (const 玩家 of 游戏.玩家列表) {
      logger.logPlayerOp(玩家.name, 'damage', {
        source: 使用者名,
        target: 目标名,
        amount: 1,
      }, `${使用者名} 对 ${目标名} 使用杀，造成1点伤害`);
    }
  }

  return result;
}

export function 使用桃(游戏: GameState, 使用者名: string, logger?: GameLogger): EffectResult {
  const 使用者 = 游戏.玩家列表.find(p => p.name === 使用者名);

  if (!使用者) {
    return { 成功: false, 状态: 游戏, 消息: '玩家不存在' };
  }

  if (使用者.体力 >= 使用者.体力上限) {
    return { 成功: false, 状态: 游戏, 消息: '体力已满，不能使用桃' };
  }

  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.name === 使用者名) {
      return { ...p, 体力: Math.min(p.体力 + 1, p.体力上限) };
    }
    return p;
  });

  const result: EffectResult = {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表 },
    消息: `${使用者名} 使用桃，恢复1点体力`,
  };

  if (logger) {
    logger.logServerOp('heal', {
      player: 使用者名,
      amount: 1,
      newHealth: 使用者.体力 + 1,
    }, `${使用者名} 使用桃，恢复1点体力`);
    for (const 玩家 of 游戏.玩家列表) {
      logger.logPlayerOp(玩家.name, 'heal', {
        player: 使用者名,
        amount: 1,
      }, `${使用者名} 使用桃，恢复1点体力`);
    }
  }

  return result;
}

// ============================================================
// 普通锦囊 - 单目标
// ============================================================

export function 使用过河拆桥(游戏: GameState, 使用者名: string, 目标名: string, logger?: GameLogger): EffectResult {
  const 使用者 = 游戏.玩家列表.find(p => p.name === 使用者名);
  const 目标 = 游戏.玩家列表.find(p => p.name === 目标名);

  if (!使用者 || !目标) {
    return { 成功: false, 状态: 游戏, 消息: '玩家不存在' };
  }

  if (使用者名 === 目标名) {
    return { 成功: false, 状态: 游戏, 消息: '不能对自己使用过河拆桥' };
  }

  if (!目标.存活) {
    return { 成功: false, 状态: 游戏, 消息: '目标已死亡' };
  }

  if (目标.手牌.length === 0) {
    return { 成功: false, 状态: 游戏, 消息: `${目标名} 没有手牌` };
  }

  // 随机弃置目标一张手牌
  const 弃牌索引 = Math.floor(Math.random() * 目标.手牌.length);
  const 被弃的牌 = 目标.手牌[弃牌索引];

  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.name === 目标名) {
      return { ...p, 手牌: p.手牌.filter((_, i) => i !== 弃牌索引) };
    }
    return p;
  });

  const result: EffectResult = {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表, 弃牌堆: [...游戏.弃牌堆, 被弃的牌] },
    消息: `${使用者名} 对 ${目标名} 使用过河拆桥，弃置了一张牌`,
  };

  if (logger) {
    logger.logServerOp('discard', {
      source: 使用者名,
      target: 目标名,
      cards: [{ name: 被弃的牌.name, 花色: 被弃的牌.花色, 点数: 被弃的牌.点数 }],
    }, `${使用者名} 对 ${目标名} 使用过河拆桥，弃置了 ${被弃的牌.name}`);
    for (const 玩家 of 游戏.玩家列表) {
      // 使用者看到被弃的牌，目标和其他人只知道被弃了一张牌
      const 描述 = 玩家.name === 使用者名 || 玩家.name === 目标名
        ? `${使用者名} 对 ${目标名} 使用过河拆桥，弃置了 ${被弃的牌.name}`
        : `${使用者名} 对 ${目标名} 使用过河拆桥，弃置了一张牌`;
      logger.logPlayerOp(玩家.name, 'discard', {
        source: 使用者名,
        target: 目标名,
        cards: [{ name: 被弃的牌.name, 花色: 被弃的牌.花色, 点数: 被弃的牌.点数 }],
      }, 描述);
    }
  }

  return result;
}

export function 使用顺手牵羊(游戏: GameState, 使用者名: string, 目标名: string, logger?: GameLogger): EffectResult {
  const 使用者 = 游戏.玩家列表.find(p => p.name === 使用者名);
  const 目标 = 游戏.玩家列表.find(p => p.name === 目标名);

  if (!使用者 || !目标) {
    return { 成功: false, 状态: 游戏, 消息: '玩家不存在' };
  }

  if (使用者名 === 目标名) {
    return { 成功: false, 状态: 游戏, 消息: '不能对自己使用顺手牵羊' };
  }

  if (!目标.存活) {
    return { 成功: false, 状态: 游戏, 消息: '目标已死亡' };
  }

  if (目标.手牌.length === 0 && !目标.装备.武器 && !目标.装备.防具 && !目标.装备.马加 && !目标.装备.马减) {
    return { 成功: false, 状态: 游戏, 消息: `${目标名} 没有任何牌` };
  }

  // 优先从手牌中随机获得，简化实现不考虑距离
  if (目标.手牌.length > 0) {
    const 获得索引 = Math.floor(Math.random() * 目标.手牌.length);
    const 获得的牌 = 目标.手牌[获得索引];

    const 新玩家列表 = 游戏.玩家列表.map(p => {
      if (p.name === 目标名) {
        return { ...p, 手牌: p.手牌.filter((_, i) => i !== 获得索引) };
      }
      if (p.name === 使用者名) {
        return { ...p, 手牌: [...p.手牌, 获得的牌] };
      }
      return p;
    });

    const result: EffectResult = {
      成功: true,
      状态: { ...游戏, 玩家列表: 新玩家列表 },
      消息: `${使用者名} 对 ${目标名} 使用顺手牵羊，获得了一张牌`,
    };

    if (logger) {
      logger.logServerOp('play', {
        source: 使用者名,
        target: 目标名,
        cards: [{ name: 获得的牌.name, 花色: 获得的牌.花色, 点数: 获得的牌.点数 }],
      }, `${使用者名} 对 ${目标名} 使用顺手牵羊，获得了 ${获得的牌.name}`);
      for (const 玩家 of 游戏.玩家列表) {
        const 描述 = 玩家.name === 使用者名
          ? `${使用者名} 对 ${目标名} 使用顺手牵羊，获得了 ${获得的牌.name}`
          : `${使用者名} 对 ${目标名} 使用顺手牵羊，获得了一张牌`;
        logger.logPlayerOp(玩家.name, 'play', {
          source: 使用者名,
          target: 目标名,
          cards: [{ name: 获得的牌.name, 花色: 获得的牌.花色, 点数: 获得的牌.点数 }],
        }, 描述);
      }
    }

    return result;
  }

  return { 成功: false, 状态: 游戏, 消息: `${目标名} 没有手牌` };
}

export function 使用无中生有(游戏: GameState, 使用者名: string, logger?: GameLogger): EffectResult {
  const 使用者 = 游戏.玩家列表.find(p => p.name === 使用者名);

  if (!使用者) {
    return { 成功: false, 状态: 游戏, 消息: '玩家不存在' };
  }

  if (游戏.牌堆.length < 2) {
    return { 成功: false, 状态: 游戏, 消息: '牌堆不足' };
  }

  const 摸到的牌 = 游戏.牌堆.slice(0, 2);
  const 新牌堆 = 游戏.牌堆.slice(2);

  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.name === 使用者名) {
      return { ...p, 手牌: [...p.手牌, ...摸到的牌] };
    }
    return p;
  });

  const result: EffectResult = {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表, 牌堆: 新牌堆 },
    消息: `${使用者名} 使用无中生有，摸了2张牌`,
  };

  if (logger) {
    logger.logServerOp('draw', {
      player: 使用者名,
      cards: 摸到的牌.map(c => ({ name: c.name, 花色: c.花色, 点数: c.点数 })),
    }, `${使用者名} 使用无中生有，摸了2张牌`);
    for (const 玩家 of 游戏.玩家列表) {
      logger.logPlayerOp(玩家.name, 'draw', {
        player: 使用者名,
        cards: 摸到的牌.map(c => ({ name: c.name, 花色: c.花色, 点数: c.点数 })),
      }, `${使用者名} 使用无中生有，摸了2张牌`);
    }
  }

  return result;
}

export function 使用决斗(游戏: GameState, 使用者名: string, 目标名: string, logger?: GameLogger): EffectResult {
  const 使用者 = 游戏.玩家列表.find(p => p.name === 使用者名);
  const 目标 = 游戏.玩家列表.find(p => p.name === 目标名);

  if (!使用者 || !目标) {
    return { 成功: false, 状态: 游戏, 消息: '玩家不存在' };
  }

  if (使用者名 === 目标名) {
    return { 成功: false, 状态: 游戏, 消息: '不能对自己使用决斗' };
  }

  if (!目标.存活) {
    return { 成功: false, 状态: 游戏, 消息: '目标已死亡' };
  }

  // 简化实现：直接对目标造成1点伤害（完整实现需要轮流出杀）
  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.name === 目标名) {
      return { ...p, 体力: p.体力 - 1 };
    }
    return p;
  });

  const result: EffectResult = {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表 },
    消息: `${使用者名} 对 ${目标名} 使用决斗，造成1点伤害`,
  };

  if (logger) {
    logger.logServerOp('damage', {
      source: 使用者名,
      target: 目标名,
      amount: 1,
      cardName: '决斗',
    }, `${使用者名} 对 ${目标名} 使用决斗，造成1点伤害`);
    for (const 玩家 of 游戏.玩家列表) {
      logger.logPlayerOp(玩家.name, 'damage', {
        source: 使用者名,
        target: 目标名,
        amount: 1,
      }, `${使用者名} 对 ${目标名} 使用决斗，造成1点伤害`);
    }
  }

  return result;
}

// ============================================================
// 普通锦囊 - 全体
// ============================================================

export function 使用万箭齐发(游戏: GameState, 使用者名: string, logger?: GameLogger): EffectResult {
  const 使用者 = 游戏.玩家列表.find(p => p.name === 使用者名);

  if (!使用者) {
    return { 成功: false, 状态: 游戏, 消息: '玩家不存在' };
  }

  const 其他存活玩家 = 游戏.玩家列表.filter(p => p.存活 && p.name !== 使用者名);

  if (其他存活玩家.length === 0) {
    return { 成功: false, 状态: 游戏, 消息: '没有其他存活的玩家' };
  }

  // 简化实现：所有其他存活玩家各受1点伤害（完整实现需要每名角色响应闪）
  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.存活 && p.name !== 使用者名) {
      return { ...p, 体力: p.体力 - 1 };
    }
    return p;
  });

  const 受伤名单 = 其他存活玩家.map(p => p.name).join('、');

  const result: EffectResult = {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表 },
    消息: `${使用者名} 使用万箭齐发，${受伤名单} 各受到1点伤害`,
  };

  if (logger) {
    logger.logServerOp('damage', {
      source: 使用者名,
      targets: 其他存活玩家.map(p => p.name),
      amount: 1,
      cardName: '万箭齐发',
    }, `${使用者名} 使用万箭齐发，${受伤名单} 各受到1点伤害`);
    for (const 玩家 of 游戏.玩家列表) {
      logger.logPlayerOp(玩家.name, 'damage', {
        source: 使用者名,
        targets: 其他存活玩家.map(p => p.name),
        amount: 1,
      }, `${使用者名} 使用万箭齐发，${受伤名单} 各受到1点伤害`);
    }
  }

  return result;
}

export function 使用南蛮入侵(游戏: GameState, 使用者名: string, logger?: GameLogger): EffectResult {
  const 使用者 = 游戏.玩家列表.find(p => p.name === 使用者名);

  if (!使用者) {
    return { 成功: false, 状态: 游戏, 消息: '玩家不存在' };
  }

  const 其他存活玩家 = 游戏.玩家列表.filter(p => p.存活 && p.name !== 使用者名);

  if (其他存活玩家.length === 0) {
    return { 成功: false, 状态: 游戏, 消息: '没有其他存活的玩家' };
  }

  // 简化实现：所有其他存活玩家各受1点伤害（完整实现需要每名角色响应杀）
  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.存活 && p.name !== 使用者名) {
      return { ...p, 体力: p.体力 - 1 };
    }
    return p;
  });

  const 受伤名单 = 其他存活玩家.map(p => p.name).join('、');

  const result: EffectResult = {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表 },
    消息: `${使用者名} 使用南蛮入侵，${受伤名单} 各受到1点伤害`,
  };

  if (logger) {
    logger.logServerOp('damage', {
      source: 使用者名,
      targets: 其他存活玩家.map(p => p.name),
      amount: 1,
      cardName: '南蛮入侵',
    }, `${使用者名} 使用南蛮入侵，${受伤名单} 各受到1点伤害`);
    for (const 玩家 of 游戏.玩家列表) {
      logger.logPlayerOp(玩家.name, 'damage', {
        source: 使用者名,
        targets: 其他存活玩家.map(p => p.name),
        amount: 1,
      }, `${使用者名} 使用南蛮入侵，${受伤名单} 各受到1点伤害`);
    }
  }

  return result;
}

export function 使用桃园结义(游戏: GameState, 使用者名: string, logger?: GameLogger): EffectResult {
  const 使用者 = 游戏.玩家列表.find(p => p.name === 使用者名);

  if (!使用者) {
    return { 成功: false, 状态: 游戏, 消息: '玩家不存在' };
  }

  const 存活玩家 = 游戏.玩家列表.filter(p => p.存活);
  const 需要治疗 = 存活玩家.filter(p => p.体力 < p.体力上限);

  if (需要治疗.length === 0) {
    return { 成功: false, 状态: 游戏, 消息: '所有存活玩家体力已满' };
  }

  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.存活 && p.体力 < p.体力上限) {
      return { ...p, 体力: Math.min(p.体力 + 1, p.体力上限) };
    }
    return p;
  });

  const 治疗名单 = 需要治疗.map(p => p.name).join('、');

  const result: EffectResult = {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表 },
    消息: `${使用者名} 使用桃园结义，${治疗名单} 各恢复1点体力`,
  };

  if (logger) {
    logger.logServerOp('heal', {
      source: 使用者名,
      targets: 需要治疗.map(p => p.name),
      amount: 1,
    }, `${使用者名} 使用桃园结义，${治疗名单} 各恢复1点体力`);
    for (const 玩家 of 游戏.玩家列表) {
      logger.logPlayerOp(玩家.name, 'heal', {
        source: 使用者名,
        targets: 需要治疗.map(p => p.name),
        amount: 1,
      }, `${使用者名} 使用桃园结义，${治疗名单} 各恢复1点体力`);
    }
  }

  return result;
}

export function 使用五谷丰登(游戏: GameState, 使用者名: string, logger?: GameLogger): EffectResult {
  const 使用者 = 游戏.玩家列表.find(p => p.name === 使用者名);

  if (!使用者) {
    return { 成功: false, 状态: 游戏, 消息: '玩家不存在' };
  }

  const 存活玩家 = 游戏.玩家列表.filter(p => p.存活);

  if (游戏.牌堆.length < 存活玩家.length) {
    return { 成功: false, 状态: 游戏, 消息: '牌堆不足' };
  }

  // 简化实现：每人直接从牌堆摸1张（完整实现需要展示后依次选择）
  const 亮出的牌 = 游戏.牌堆.slice(0, 存活玩家.length);
  const 新牌堆 = 游戏.牌堆.slice(存活玩家.length);

  const 新玩家列表 = 游戏.玩家列表.map(p => {
    if (p.存活) {
      const 索引 = 存活玩家.findIndex(sp => sp.name === p.name);
      return { ...p, 手牌: [...p.手牌, 亮出的牌[索引]] };
    }
    return p;
  });

  const 分配信息 = 存活玩家.map((p, i) => `${p.name} 获得 ${亮出的牌[i].name}`).join('、');

  const result: EffectResult = {
    成功: true,
    状态: { ...游戏, 玩家列表: 新玩家列表, 牌堆: 新牌堆 },
    消息: `${使用者名} 使用五谷丰登，${分配信息}`,
  };

  if (logger) {
    logger.logServerOp('draw', {
      source: 使用者名,
      revealed: 亮出的牌.map(c => ({ name: c.name, 花色: c.花色, 点数: c.点数 })),
      distribution: Object.fromEntries(存活玩家.map((p, i) => [p.name, { name: 亮出的牌[i].name, 花色: 亮出的牌[i].花色, 点数: 亮出的牌[i].点数 }])),
    }, `${使用者名} 使用五谷丰登，亮出了 ${亮出的牌.map(c => c.name).join('、')}`);
    for (const 玩家 of 游戏.玩家列表) {
      if (玩家.存活) {
        const 索引 = 存活玩家.findIndex(sp => sp.name === 玩家.name);
        logger.logPlayerOp(玩家.name, 'draw', {
          player: 玩家.name,
          cards: [{ name: 亮出的牌[索引].name, 花色: 亮出的牌[索引].花色, 点数: 亮出的牌[索引].点数 }],
        }, `五谷丰登: ${玩家.name} 获得 ${亮出的牌[索引].name}`);
      }
    }
  }

  return result;
}

export function 解析效果(游戏: GameState, _效果: Record<string, unknown>): EffectResult {
  // 通用效果解析器，后续扩展
  return { 成功: false, 状态: 游戏, 消息: '未实现的效果类型' };
}
