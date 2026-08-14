// tests/engine/contract.test.ts
// 前后端契约验证(正向):每个 defineAction 声明的 actionType 都有对应 registerAction。
// 反向检查暂不做(等 PR-A:给所有 backend-only skill 补 onMount 之后)。
//
// 另含技能声明注册表(registry)的 meta-tests:取代旧 skills/index.ts 手写 loader 表后,
// 声明(武将 path/装备卡名/系统/衍生表)与磁盘文件的对应关系由此兜底,防止漂移。
import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillTestHarness } from '../engine-harness';
import { findActionEntry } from '../../src/engine/core/skill';
import '../../src/engine/atoms';
import { createGameState } from '../../src/engine/types';
import type { GameState } from '../../src/engine/types';
import { buildSkillModuleSpecs } from '../../src/engine/skills/registry';
import { importSkillModuleById } from '../../src/engine/skills/loaders';
import { DEFAULT_SKILLS } from '../../src/engine/atoms/选将';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = resolve(repoRoot, 'src/engine');

function buildStateWithSkills(skillIds: string[]): GameState {
  return createGameState({
    players: [
      {
        index: 0,
        name: 'P1',
        character: '主公',
        health: 4,
        maxHealth: 4,
        alive: true,
        hand: [],
        equipment: {},
        skills: skillIds,
        vars: {},
        marks: [],
        pendingTricks: [],
        tags: [],
        judgeZone: [],
      },
    ],
    cardMap: {},
    currentPlayerIndex: 0,
    phase: '出牌',
    turn: { round: 1, phase: '出牌', vars: {} },
  });
}

describe('前端 → 后端契约', () => {
  let harness: SkillTestHarness;
  beforeEach(() => {
    harness = new SkillTestHarness();
  });

  // 这些 skill 在 onInit 里 registerAction,故 defineAction 声明的 actionType
  // 都能在后端按 (skillId, ownerId, actionType) 三元组找到对应 registerAction。
  // 武圣 / 丈八蛇矛: onInit 显式 registerAction('transform')(创建影子杀),
  //   杀.use 走正常路径;无需跨 skill 路由。
  const SKILLS_WITH_OWN_REGISTER = ['仁德', '制衡', '激将', '武圣', '丈八蛇矛'];

  async function checkSkillDeclaredActions(skillId: string, h: SkillTestHarness) {
    await h.setup(buildStateWithSkills([skillId]));

    const P1 = h.player('P1');
    const declared = P1.availableActions();
    expect(declared.length).toBeGreaterThan(0);

    for (const def of declared) {
      const found = findActionEntry(h.state, def.skillId, def.ownerId, def.actionType);
      expect(
        found,
        `defineAction 声明了 ${def.skillId}:${def.actionType},但后端无对应 registerAction`,
      ).toBeDefined();
    }
  }

  it.each(SKILLS_WITH_OWN_REGISTER)(
    '%s: defineAction 声明的 actionType 都有对应 registerAction',
    async (skillId) => {
      await checkSkillDeclaredActions(skillId, harness);
    },
  );

});

// ─── 技能声明注册表 meta-tests ─────────────────────────────
// 声明聚合(registry)取代旧 skills/index.ts 手写表后,以下不变量必须持续成立:
//   1. 每条声明的模块文件在磁盘上存在(spec 相对 src/engine/,马匹 '#' 导出拆开校验)
//   2. 每个声明的 skillId 能实际加载且模块形状合法(含 createSkill)
//   3. skills/ 目录下每个技能文件都被某条声明覆盖(揪出死文件/漏注册)
//   4. SYSTEM_SKILL_SPECS 与 atoms/选将.ts DEFAULT_SKILLS 不漂移
describe('技能声明注册表 meta', () => {
  const specs = buildSkillModuleSpecs();
  // 马匹共享模块:文件被 7 个 spec 指向,反向覆盖检查时按文件去重
  const specFiles = new Set(
    [...specs.values()].map((s) => s.split('#')[0]),
  );

  it('每条声明的模块文件都存在', () => {
    const missing: string[] = [];
    for (const [id, spec] of specs) {
      const file = resolve(engineRoot, `${spec.split('#')[0]}.ts`);
      if (!existsSync(file)) missing.push(`${id} -> ${spec}`);
    }
    expect(missing, `声明指向不存在的文件:\n${missing.join('\n')}`).toEqual([]);
  });

  it('每个声明的 skillId 都能加载且形状合法', async () => {
    const bad: string[] = [];
    for (const id of specs.keys()) {
      try {
        const mod = await importSkillModuleById(id);
        if (typeof mod.createSkill !== 'function') bad.push(id);
      } catch (e) {
        bad.push(`${id}: ${(e as Error).message}`);
      }
    }
    expect(bad, `无法加载或形状非法:\n${bad.join('\n')}`).toEqual([]);
  }, 120_000);

  it('skills/ 目录下每个技能文件都被声明覆盖(无死文件)', () => {
    // 不走 loader 声明的合法文件:
    //   registry/loaders/vite-glob/lifecycle — 注册表支撑文件
    //   系统规则 — core/index.ts 静态 import 注册全局 hooks,不经 loader
    //   cards/* — CardEffect 注册表按卡名静态 import(cards/index.ts);
    //             仅 use-card/play-card(使用牌/打出牌)作为系统技能走 loader
    const excludedTop = new Set([
      'registry',
      'loaders',
      'vite-glob',
      'lifecycle',
      '系统规则',
    ]);
    const loaderOwnedCards = new Set(['use-card', 'play-card']);
    const skillsDir = resolve(engineRoot, 'skills');
    const walk = (dir: string, prefix: string): string[] => {
      const out: string[] = [];
      for (const ent of readdirSync(dir)) {
        const full = resolve(dir, ent);
        if (statSync(full).isDirectory()) {
          out.push(...walk(full, `${prefix}${ent}/`));
        } else if (ent.endsWith('.ts')) {
          out.push(prefix + ent.replace(/\.ts$/, ''));
        }
      }
      return out;
    };
    const unclaimed = walk(skillsDir, '')
      .filter((f) => {
        if (f.startsWith('cards/')) return loaderOwnedCards.has(f.slice('cards/'.length));
        return !excludedTop.has(f);
      })
      .filter((f) => !specFiles.has(`skills/${f}`));
    expect(
      unclaimed,
      `skills/ 下存在未被任何声明覆盖的文件(死文件或漏注册):\n${unclaimed.join('\n')}`,
    ).toEqual([]);
  });

  it('SYSTEM_SKILL_SPECS ⊇ DEFAULT_SKILLS(系统技能声明不漂移)', () => {
    const missing = DEFAULT_SKILLS.filter((id) => !specs.has(id));
    expect(missing, `DEFAULT_SKILLS 中的技能缺少声明:\n${missing.join('\n')}`).toEqual([]);
  });
});
