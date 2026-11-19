// tests/engine/lord-data-contract.test.ts
// 武将/主公技数据契约(meta-tests,兜底手工名单与文件登记的漂移):
//   1. 主公技覆盖:技能模块 description 以「主公技」开头 ⇒ 必须登记进 LORD_SKILLS;
//      反向 LORD_SKILLS 每个条目都必须有技能模块且描述确实以「主公技」开头。
//      判据用 description 开头而非「包含」:伪帝/化身等引用主公技的非主公技文案
//      不以该 tag 开头,不会误报。
//   2. 武将文件全导入:data/characters/*.ts 每个武将文件都必须被势力聚合文件
//      (wei/shu/wu/qun)import 且其 CharacterConfig 进入 allCharacters
//      —— 漏登记的武将不会出现在选将池,静默不可选。
//   3. 技能 id 已注册:全部武将 skills 数组里的每个 id 都能经 loaders 加载出
//      技能模块(防拼写错/漏文件)。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LORD_SKILLS } from '../../src/engine/data/character-meta';
import { allCharacters } from '../../src/engine/data/characters';
import { buildSkillModuleSpecs } from '../../src/engine/skills/registry';
import { importSkillModuleById } from '../../src/engine/skills/loaders';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const charactersDir = resolve(repoRoot, 'src/engine/data/characters');
const factionFiles = ['wei.ts', 'shu.ts', 'wu.ts', 'qun.ts'] as const;
const factionText = factionFiles
  .map((f) => readFileSync(resolve(charactersDir, f), 'utf8'))
  .join('\n');

// ─── 契约一:主公技名单(LORD_SKILLS)─────────────────────────
describe('主公技名单契约(LORD_SKILLS)', () => {
  const specs = buildSkillModuleSpecs();

  it('description 以「主公技」开头的技能必须登记进 LORD_SKILLS', async () => {
    const errors: string[] = [];
    const undeclared: string[] = [];
    for (const id of specs.keys()) {
      let description: string;
      try {
        const mod = await importSkillModuleById(id);
        description = mod.createSkill(id, 0).description;
      } catch (e) {
        errors.push(`${id}: ${(e as Error).message}`);
        continue;
      }
      if (description.startsWith('主公技') && !LORD_SKILLS.has(id)) undeclared.push(id);
    }
    expect(errors, `以下技能模块无法加载/实例化:\n${errors.join('\n')}`).toEqual([]);
    expect(
      undeclared,
      `以下技能 description 以「主公技」开头但未登记进 LORD_SKILLS\n` +
        `(非主公座次不会隐藏展示、伪帝复制主公技会漏掉):\n${undeclared.join('\n')}`,
    ).toEqual([]);
  }, 120_000);

  it('LORD_SKILLS 每个条目都有技能模块且描述以「主公技」开头', async () => {
    const bad: string[] = [];
    for (const id of LORD_SKILLS) {
      if (!specs.has(id)) {
        bad.push(`${id}: 无技能模块声明(registry 聚合结果中不存在,拼写错?)`);
        continue;
      }
      const mod = await importSkillModuleById(id);
      if (!mod.createSkill(id, 0).description.startsWith('主公技')) {
        bad.push(`${id}: description 未以「主公技」开头(名单腐化或文案改坏)`);
      }
    }
    expect(bad, `LORD_SKILLS 存在腐化条目:\n${bad.join('\n')}`).toEqual([]);
  }, 60_000);
});

// ─── 契约二:武将文件全导入 ────────────────────────────────────
// 排除势力聚合与汇总文件(非单个武将定义)。经 vite glob 懒加载,
// 与 skills/vite-glob.ts 同机制;键为相对本文件的路径字符串。
const characterFileLoaders = import.meta.glob([
  '../../src/engine/data/characters/*.ts',
  '!../../src/engine/data/characters/index.ts',
  '!../../src/engine/data/characters/wei.ts',
  '!../../src/engine/data/characters/shu.ts',
  '!../../src/engine/data/characters/wu.ts',
  '!../../src/engine/data/characters/qun.ts',
]);

/** 在模块命名空间里找 CharacterConfig 形状的导出(name+skills 的非数组对象)。
 *  返回导出符号名(用于静态 import 登记)与武将名(用于 allCharacters 登记)。 */
function findCharacterExport(
  mod: Record<string, unknown>,
): { symbol: string; name: string } | undefined {
  for (const [symbol, value] of Object.entries(mod)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as { name?: unknown }).name === 'string' &&
      Array.isArray((value as { skills?: unknown }).skills)
    ) {
      return { symbol, name: (value as { name: string }).name };
    }
  }
  return undefined;
}

describe('武将文件登记契约', () => {
  it('每个武将文件都被势力聚合 import 且进入 allCharacters(无漏登记)', async () => {
    const gaps: string[] = [];
    const names: string[] = [];
    for (const [path, loader] of Object.entries(characterFileLoaders)) {
      const basename = (path.split('/').pop() ?? path).replace(/\.ts$/, '');
      const mod = (await loader()) as Record<string, unknown>;
      const found = findCharacterExport(mod);
      if (!found) {
        gaps.push(`${basename}: 未找到 CharacterConfig 形状的导出(应为 export const <名> = { name, skills, ... })`);
        continue;
      }
      names.push(found.name);
      // 静态:势力聚合文件必须 import 该导出(漏 import = 编译层就已断裂)
      const importRe = new RegExp(
        `import\\s*\\{[^}]*${found.symbol}[^}]*\\}\\s*from\\s*['"]\\./${basename}['"]`,
      );
      if (!importRe.test(factionText)) {
        gaps.push(`${basename}: 导出 ${found.symbol} 未被 wei/shu/wu/qun 势力聚合文件 import`);
      }
      // 运行时:该武将必须出现在 allCharacters(漏加数组 = 选将池静默丢失)
      if (!allCharacters.some((c) => c.name === found.name)) {
        gaps.push(`${basename}(${found.name}): 未出现在 allCharacters(未加入势力数组?)`);
      }
    }
    expect(gaps, `武将文件登记缺口:\n${gaps.join('\n')}`).toEqual([]);
    // 双射守恒:武将文件数 === allCharacters 条目数,且武将名无重复
    // (防重复登记、防聚合数组出现无文件来源的幽灵条目)。
    expect(new Set(names).size, '存在重名武将文件').toEqual(names.length);
    expect(names.length, '武将文件数与 allCharacters 条目数不一致').toEqual(allCharacters.length);
  }, 30_000);
});

// ─── 契约三:武将技能 id 已注册 ────────────────────────────────
describe('武将技能声明契约', () => {
  it('每个武将 skills 数组中的技能 id 都能加载出技能模块(防拼写错/漏文件)', async () => {
    // 同一技能 id 被多武将共享(如 化身),去重后逐个经 loaders 加载
    const uniqueSkillIds = new Set(allCharacters.flatMap((c) => c.skills));
    const bad: string[] = [];
    for (const skillId of uniqueSkillIds) {
      try {
        const mod = await importSkillModuleById(skillId);
        if (typeof mod.createSkill !== 'function') bad.push(`${skillId}: 模块无 createSkill`);
      } catch (e) {
        const owners = allCharacters
          .filter((c) => c.skills.includes(skillId))
          .map((c) => c.name)
          .join('、');
        bad.push(`${skillId}(武将:${owners}): ${(e as Error).message}`);
      }
    }
    expect(bad, `以下技能 id 无对应可加载的技能模块:\n${bad.join('\n')}`).toEqual([]);
  }, 120_000);
});
