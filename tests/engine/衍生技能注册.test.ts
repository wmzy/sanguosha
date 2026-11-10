import { describe, expect, it } from 'vitest';
import { hasSkillModule, isCharacterSkillId } from '../../src/engine/skills/registry';

describe('新补衍生技能注册', () => {
  it.each(['清侧', '怀柔', '思蜀', '缠怨'])('注册 %s 模块', (skillId) => {
    expect(hasSkillModule(skillId)).toBe(true);
  });

  it('仅把静态和衍生武将技识别为角色技能', () => {
    expect(isCharacterSkillId('仁德')).toBe(true);
    expect(isCharacterSkillId('思蜀')).toBe(true);
    expect(isCharacterSkillId('诸葛连弩')).toBe(false);
    expect(isCharacterSkillId('回合管理')).toBe(false);
    expect(isCharacterSkillId('不存在的技能')).toBe(false);
  });
});
