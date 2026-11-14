// tests/engine/view-distance-sync.test.ts
// 契约测试:view 侧距离/攻击范围豁免登记表(rules/viewDistance.ts 的
// VIEW_DISTANCE_EXEMPTIONS)与引擎侧豁免器注册(rules/distance.ts 的
// registerDistanceExemptor / registerAttackRangeExemptor 调用点)必须同步。
//
// 纯静态源码扫描(不 import 任何引擎模块,可在并发改动期间安全运行):
//   - view 侧:提取 VIEW_DISTANCE_EXEMPTIONS 各条目的 source 技能名;
//   - 引擎侧:扫描 src/engine/skills/*.ts 源文件文本的 register* 调用点;调用点第 4 参
//     为字符串字面量时按该技能名归因(工厂宿主文件替别的技能注册的场景),否则按
//     文件名(= 技能名)计入集合;
//   - 两侧集合相等才 pass,不等时输出双向差异。
//
// 漏登记的后果:引擎 validate 放行但前端按钮/目标置灰(viewCanAttack/
// viewEffectiveDistance 不感知该豁免)——这正是本测试要防的漂移。
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const engineRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/engine',
);

/** 去掉注释的字符串(单趟状态机:代码/行注释/块注释/字符串四态)。
 *  不能用两条独立正则:注释文本里出现 `/*`(如 雄乱.ts 的 turnUsage['杀/unlimited/*'])
 *  会被块注释正则误当开启符,吞掉后面的真实代码造成漏报。已知局限:不追踪正则字面量
 *  与模板内嵌表达式,误剥离只可能发生在同一行内,不影响对 register* 调用点的判定。 */
function stripComments(source: string): string {
  let out = '';
  let mode: 'code' | 'line' | 'block' = 'code';
  let quote: '' | "'" | '"' | '`' = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; }
    } else if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; i++; }
    } else if (quote) {
      out += c;
      if (c === '\\') { out += next ?? ''; i++; }
      else if (c === quote) quote = '';
    } else if (c === '/' && next === '/') { mode = 'line'; i++; }
    else if (c === '/' && next === '*') { mode = 'block'; i++; }
    else {
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
    }
  }
  return out;
}

/** view 侧:VIEW_DISTANCE_EXEMPTIONS 表中登记的技能名(source 字段值)集合 */
function readRegistrySkills(): Set<string> {
  const source = readFileSync(path.join(engineRoot, 'rules/viewDistance.ts'), 'utf8');
  const tableStart = source.indexOf('VIEW_DISTANCE_EXEMPTIONS');
  expect(tableStart, 'viewDistance.ts 中找不到 VIEW_DISTANCE_EXEMPTIONS 登记表').toBeGreaterThanOrEqual(0);
  const tableEnd = source.indexOf('\n];', tableStart);
  const table = source.slice(tableStart, tableEnd);
  return new Set([...table.matchAll(/^\s*source:\s*'([^']+)'/gm)].map((m) => m[1]));
}

/** 引擎侧:skills/ 目录下含豁免器注册调用点的技能名集合。
 *  归因规则:调用点第 4 参为字符串字面量(豁免归属技能名,工厂宿主替别的技能注册时传)
 *  时优先采用;否则按文件名(= 技能名)归因。 */
function readExemptorCallSites(): Set<string> {
  const skillsDir = path.join(engineRoot, 'skills');
  const skills = new Set<string>();
  const callRe = /register(?:Distance|AttackRange)Exemptor\s*\(/g;
  for (const file of readdirSync(skillsDir)) {
    if (!file.endsWith('.ts')) continue;
    const src = stripComments(
      readFileSync(path.join(skillsDir, file), 'utf8'),
    );
    callRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(src)) !== null) {
      // 走到配对的右括号,收集深度 0 的顶层参数。
      const open = m.index + m[0].length - 1;
      let depth = 0;
      let quote: '' | "'" | '"' | '`' = '';
      let args = '';
      for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (quote) {
          if (c === '\\') { i++; continue; }
          if (c === quote) quote = '';
          args += c;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') { quote = c; args += c; continue; }
        if (c === '(') { depth++; if (i === open) continue; args += c; continue; }
        if (c === ')') {
          depth--;
          if (depth === 0) break;
          args += c;
          continue;
        }
        args += c;
      }
      const topArgs: string[] = [''];
      let argDepth = 0;
      let argQuote: '' | "'" | '"' | '`' = '';
      for (const c of args) {
        if (argQuote) { topArgs[topArgs.length - 1] += c; if (c === argQuote) argQuote = ''; continue; }
        if (c === "'" || c === '"' || c === '`') { argQuote = c; topArgs[topArgs.length - 1] += c; continue; }
        if (c === '(' || c === '[' || c === '{') argDepth++;
        if (c === ')' || c === ']' || c === '}') argDepth--;
        if (c === ',' && argDepth === 0) topArgs.push('');
        else topArgs[topArgs.length - 1] += c;
      }
      const literal = topArgs[3]?.trim().match(/^'([^']+)'$/);
      skills.add(literal ? literal[1] : file.replace(/\.ts$/, ''));
    }
  }
  return skills;
}

describe('viewDistance 豁免登记表与引擎侧注册同步', () => {
  it('VIEW_DISTANCE_EXEMPTIONS 与 register* 调用点技能名集合相等', () => {
    const registry = readRegistrySkills();
    const engine = readExemptorCallSites();

    // 两侧非空 sanity:解析逻辑失效(如源文件改格式)时不许静默通过。
    expect(registry.size, '登记表解析结果为空,检查 source: 解析是否失效').toBeGreaterThan(0);
    expect(engine.size, '调用点扫描结果为空,检查 skills/ 扫描是否失效').toBeGreaterThan(0);

    const missingInRegistry = [...engine].filter((s) => !registry.has(s)).sort();
    const staleInRegistry = [...registry].filter((s) => !engine.has(s)).sort();

    expect(
      { missingInRegistry, staleInRegistry },
      [
        'view 侧豁免登记表与引擎侧 register* 调用点漂移:',
        `  引擎侧已注册但登记表缺失(前端会目标置灰): ${missingInRegistry.join('、') || '(无)'}`,
        `  登记表有但引擎侧无调用点(死条目): ${staleInRegistry.join('、') || '(无)'}`,
        '修复:在 rules/viewDistance.ts 的 VIEW_DISTANCE_EXEMPTIONS 与技能文件的',
        'registerDistanceExemptor/registerAttackRangeExemptor 调用点之间补齐缺失一侧。',
      ].join('\n'),
    ).toEqual({ missingInRegistry: [], staleInRegistry: [] });
  });
});
