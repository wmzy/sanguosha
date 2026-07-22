// 闪 CardEffect — 基本牌·闪的使用结算。
//
// 使用时机：以你为目标的【杀】生效前。
// 使用目标：以你为目标的【杀】。
// 作用效果：抵消此【杀】。
//
// 闪的使用入口：在杀的"生效前"时机,由 use-card.ts 的 handleSlashDodge 询问目标
// 是否使用闪。目标通过闪.respond action 把闪牌移入处理区后,handleSlashDodge 发出
// 闪的"生效前" atom——无双/肉林在此 before-hook 中拦截第一次闪。
//
// 闪的 resolve 不在此文件实现——抵消逻辑由 handleSlashDodge 直接处理
// （applyAtom(被抵消) + 武器技 + drain闪）。
// 此文件仅注册闪的牌面元数据（timing/target/prompt）。

import type { Card } from '../types';
import type { ActionPrompt } from '../types';
import { registerCardEffect, type CardEffect } from '../card-effect/registry';

const dodgeEffect: CardEffect = {
  timing: '杀生效前',
  target: { kind: 'none' },
  resolve: async () => {
    // 闪的抵消效果由 handleSlashDodge 直接处理（检查处理区+被抵消atom+武器技）。
    // 闪不走 runUseFlow——它的"使用"是杀的"生效前"时机的响应交互,
    // 由 handleSlashDodge 编排（询问闪 → 闪.respond移牌 → 闪的生效前atom → 被抵消）。
  },
  prompt: {
    type: 'useCard',
    title: '出闪',
    cardFilter: { filter: (c: Card) => c.name === '闪', min: 1, max: 1 },
  } as ActionPrompt,
  label: '闪',
  style: 'default',
};

registerCardEffect('闪', dodgeEffect);
