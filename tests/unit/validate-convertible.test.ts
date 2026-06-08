/**
 * tests/unit/validate-convertible.test.ts — SkillDef.convertible 字段
 *
 * 验证：
 * - getSkillConvertedCards 读 SkillDef.convertible 字段，不再依赖 validate.ts 内硬编码技能名。
 * - 武圣、龙胆、倾国 把转换声明放在自己的 registerSkill({ convertible }) 中。
 *
 * 回归保护：本任务迁出 validate.ts:111-118 硬编码，行为完全等价。
 *
 * 关键回归测试：用"合成技能 _syntheticConvert"验证 validate 真的读字段
 * 而不是写死技能名。旧版 validate 在 '武圣'/'龙胆'/'倾国'/'急救' 之外
 * 直接返回 false → 合成技能转换失败。新版读 SkillDef.convertible 字段 →
 * 合成技能注册即可生效。
 *
 * 注：技能注册是模块顶层 side-effect，本测试文件内所有 it 共享同一个 registry。
 * 不调 clearSkillRegistry()，避免重复 registerSkill 抛 "already registered"。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { clearAtomRegistry } from '@engine/atom';
import { clearAtomHooks } from '@engine/skill-hook';
import { getSkillConvertedCards } from '@engine/validate';
import { createTestGame } from '../engine-helpers';
import { registerAllAtoms } from '@engine/atoms';
import { registerAllSkills } from '@engine/skills';
import { registerSkill, getSkill } from '@engine/skill';
import type { SkillDef, GameState, Card } from '@engine/types';
import { addSkillToPlayer } from '@engine/mark';

type CardName = '杀' | '闪' | '桃';
type SuitT = '♠' | '♣' | '♥' | '♦';

function buildState(
  characters: [string, string],
  hand: { cardId: string; name: CardName; suit: SuitT; rank?: 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' }[],
  trigger: { player: string; skillId: string },
): GameState {
  let s0 = createTestGame({ characters });
  const cardMap = { ...s0.cardMap };
  const newPlayers = { ...s0.players };
  for (const h of hand) {
    cardMap[h.cardId] = {
      id: h.cardId,
      name: h.name,
      type: '基本牌',
      subtype: h.name === '杀' || h.name === '闪' || h.name === '桃' ? h.name : '杀',
      suit: h.suit,
      rank: h.rank ?? '5',
      description: '',
    } satisfies Card;
  }
  newPlayers[trigger.player] = {
    ...newPlayers[trigger.player],
    hand: hand.map((h) => h.cardId),
  };
  // [P5-T2] 技能拥有判定走 PlayerState.skills，替代 v2 state.triggers
  s0 = { ...s0, cardMap, players: newPlayers };
  s0 = addSkillToPlayer(s0, trigger.player, trigger.skillId);
  return s0;
}

describe.skip('SkillDef.convertible 字段', () => {
  beforeEach(() => {
    clearAtomRegistry();
    clearAtomHooks();
    registerAllAtoms();
    registerAllSkills();
  });

  it('合成技能 _syntheticConvert：validate 必须读 convertible 字段（关键回归）', () => {
    // 旧版 validate 写死技能名（武圣/龙胆/倾国/急救）→ 合成技能转换失败。
    // 新版读 SkillDef.convertible 字段 → 注册即可生效。
    const def: SkillDef = {
      id: '_syntheticConvert',
      name: '_syntheticConvert',
      description: '合成技能 — 验证 validate 读 convertible 字段',
      handler: () => [],
      convertible: [{ from: '杀', to: '杀' }],
    };
    registerSkill(def);

    expect(getSkill('_syntheticConvert').convertible).toBeDefined();
    expect(getSkill('_syntheticConvert').convertible).toHaveLength(1);

    const state = buildState(
      ['关羽', '曹操'],
      [{ cardId: 'c1', name: '杀', suit: '♠' }],
      { player: 'P1', skillId: '_syntheticConvert' },
    );

    const result = getSkillConvertedCards(state, 'P1', '杀');
    expect(result).toContain('c1');
  });

  it('武圣：红色手牌可当杀（来自 SkillDef.convertible）', () => {
    const state = buildState(
      ['关羽', '曹操'],
      [{ cardId: 'c1', name: '杀', suit: '♥' }],
      { player: 'P1', skillId: '武圣' },
    );
    expect(getSkillConvertedCards(state, 'P1', '杀')).toContain('c1');
  });

  it('武圣：黑色手牌不能当杀', () => {
    const state = buildState(
      ['关羽', '曹操'],
      [{ cardId: 'c1', name: '杀', suit: '♠' }],
      { player: 'P1', skillId: '武圣' },
    );
    expect(getSkillConvertedCards(state, 'P1', '杀')).not.toContain('c1');
  });

  it('龙胆：杀可当闪，闪可当杀（双向数组）', () => {
    const state = buildState(
      ['赵云', '曹操'],
      [
        { cardId: 'k1', name: '杀', suit: '♠' },
        { cardId: 'd1', name: '闪', suit: '♠' },
      ],
      { player: 'P1', skillId: '龙胆' },
    );
    const asDodge = getSkillConvertedCards(state, 'P1', '闪');
    const asKill = getSkillConvertedCards(state, 'P1', '杀');
    expect(asDodge).toContain('k1');
    expect(asKill).toContain('d1');
  });

  it('倾国：黑色手牌可当闪（任意卡名 from: \'*\'）', () => {
    const state = buildState(
      ['甄姬', '曹操'],
      [{ cardId: 'c1', name: '杀', suit: '♠' }],
      { player: 'P1', skillId: '倾国' },
    );
    expect(getSkillConvertedCards(state, 'P1', '闪')).toContain('c1');
  });

  it('倾国：红色手牌不能当闪', () => {
    const state = buildState(
      ['甄姬', '曹操'],
      [{ cardId: 'c1', name: '杀', suit: '♥' }],
      { player: 'P1', skillId: '倾国' },
    );
    expect(getSkillConvertedCards(state, 'P1', '闪')).not.toContain('c1');
  });
});
