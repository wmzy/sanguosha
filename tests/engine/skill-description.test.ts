// tests/engine/skill-description.test.ts
// getSkillDescription / getSkillDescriptionAsync 单元测试。
// 归属说明:覆盖 skill.ts 的技能描述查询工具函数;无对应现有 skill-test(后者针对单个技能),
// 故归入 tests/engine(引擎杂项)。如未来 skill.ts 增加更多工具函数测试,在此扩展。
import { describe, it, expect } from 'vitest';
import '../../src/engine/atoms';
import '../../src/engine/skills';
import { getSkillDescription, getSkillDescriptionAsync, getSkillModule } from '../../src/engine/skill';

describe('getSkillDescription', () => {
  it('模块加载后同步返回技能描述', async () => {
    await getSkillModule('杀');
    const desc = getSkillDescription('杀');
    expect(typeof desc).toBe('string');
    expect(desc).toContain('角色');
  });

  it('马匹技能(工厂模块)描述可查', async () => {
    await getSkillModule('赤兔');
    expect(getSkillDescription('赤兔')).toContain('进攻马');
  });

  it('未加载且不存在的技能同步返回 undefined', () => {
    expect(getSkillDescription('__无此技能__')).toBeUndefined();
  });

  it('缓存:重复调用返回同一值', async () => {
    await getSkillModule('制衡');
    const a = getSkillDescription('制衡');
    const b = getSkillDescription('制衡');
    expect(a).toBe(b);
    expect(a).toContain('弃');
  });
});

describe('getSkillDescriptionAsync', () => {
  it('自动加载未缓存模块并返回描述', async () => {
    const desc = await getSkillDescriptionAsync('决斗');
    expect(typeof desc).toBe('string');
    expect(desc!.length).toBeGreaterThan(0);
  });

  it('不存在的技能返回 undefined(不抛错)', async () => {
    const desc = await getSkillDescriptionAsync('__不存在__');
    expect(desc).toBeUndefined();
  });
});
