// tests/qa/character-quotes.test.ts
// 针对 165 名可用武将经典台词整理文档 docs/research/武将经典台词.md 的回归测试。
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  allCharacters,
  weiCharacters,
  shuCharacters,
  wuCharacters,
  qunCharacters,
} from '../../src/engine/data/characters/index';
import { LORD_SKILLS } from '../../src/engine/data/character-meta';
import { CHARACTER_QUOTES } from '../../scripts/extract-character-quotes';

describe('武将经典台词文档归档 (docs/research/武将经典台词.md)', () => {
  const docPath = path.resolve(__dirname, '../../docs/research/武将经典台词.md');

  it('文档文件必须存在且非空', () => {
    expect(fs.existsSync(docPath)).toBe(true);
    const content = fs.readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n');
    expect(content.length).toBeGreaterThan(1000);
  });

  it('武将总数与各势力配额必须严格对应 165 将基线', () => {
    expect(allCharacters.length).toBe(165);
    expect(weiCharacters.length).toBe(43);
    expect(shuCharacters.length).toBe(43);
    expect(wuCharacters.length).toBe(41);
    expect(qunCharacters.length).toBe(38);

    const keys = Object.keys(CHARACTER_QUOTES);
    // 语料库中所有 character 的 name 集合
    const charNames = new Set(allCharacters.map((c) => c.name));
    for (const name of charNames) {
      expect(CHARACTER_QUOTES[name]).toBeDefined();
    }
  });

  it('文档目录与四大势力分区必须完整', () => {
    const content = fs.readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n');
    expect(content).toContain('## 魏势力（43位）');
    expect(content).toContain('## 蜀势力（43位）');
    expect(content).toContain('## 吴势力（41位）');
    expect(content).toContain('## 群势力（38位）');
  });

  it('文档必须完整覆盖 165 名武将的独立小节与基础属性', () => {
    const content = fs.readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n');

    for (const c of allCharacters) {
      // 必须有武将三级标题
      expect(content).toContain(`### ${c.name}\n`);

      // 提取该武将段落
      const startIdx = content.indexOf(`### ${c.name}\n`);
      expect(startIdx).toBeGreaterThanOrEqual(0);

      // 下一个三级标题或二级标题或结尾
      const nextH3 = content.indexOf('\n### ', startIdx + 4);
      const nextH2 = content.indexOf('\n## ', startIdx + 4);
      let endIdx = content.length;
      if (nextH3 !== -1 && nextH2 !== -1) {
        endIdx = Math.min(nextH3, nextH2);
      } else if (nextH3 !== -1) {
        endIdx = nextH3;
      } else if (nextH2 !== -1) {
        endIdx = nextH2;
      }
      const section = content.slice(startIdx, endIdx);

      // 验证势力一致
      expect(section).toContain(`- **势力**：${c.faction}`);

      // 验证称号存在且非空
      const titleMatch = section.match(/- \*\*称号\*\*：(.+)/);
      expect(titleMatch).not.toBeNull();
      expect(titleMatch![1].trim().length).toBeGreaterThan(0);

      // 验证阵亡台词存在且非空
      const deathMatch = section.match(/- \*\*阵亡台词\*\*：(.+)/);
      expect(deathMatch).not.toBeNull();
      expect(deathMatch![1].trim().length).toBeGreaterThan(0);

      // 验证技能台词覆盖武将所有的定义技能
      for (const skill of c.skills) {
        const sName = (skill as any).name;
        const isLord = LORD_SKILLS.has(sName);
        if (isLord) {
          expect(section).toContain(`- **${sName}**（主公技）：`);
        } else {
          expect(section).toContain(`- **${sName}**：`);
        }
      }
    }
  });

  it('主公技武将必须正确标注主公技标签', () => {
    const content = fs.readFileSync(docPath, 'utf8');
    for (const sName of LORD_SKILLS) {
      expect(content).toContain(`- **${sName}**（主公技）：`);
    }
  });

  it('所有武将的技能台词与阵亡台词均有实质性文字内容', () => {
    for (const c of allCharacters) {
      const q = CHARACTER_QUOTES[c.name];
      expect(q).toBeDefined();
      expect(q.title.length).toBeGreaterThanOrEqual(2);
      expect(q.death.length).toBeGreaterThanOrEqual(2);

      for (const s of c.skills) {
        const sName = (s as any).name;
        const quote = q.skills[sName];
        expect(quote).toBeDefined();
        expect(quote.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
