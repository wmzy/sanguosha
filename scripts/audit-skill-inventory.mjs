import { execSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const researchRoot = path.join(root, 'docs/research/武将技能');
const skillRoot = path.join(root, 'src/engine/skills');
const qaRoot = path.join(root, 'docs/qa');

function collectFiles(dir, ext = '.md') {
  return readdir(dir, { withFileTypes: true }).then(async (entries) => {
    const nested = await Promise.all(entries.map(async (entry) => {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectFiles(target, ext);
      return entry.isFile() && entry.name.endsWith(ext) ? [target] : [];
    }));
    return nested.flat();
  });
}

function extractLiveData() {
  const code = "import { allCharacters } from './src/engine/data/characters/index.ts'; import { buildSkillModuleSpecs } from './src/engine/skills/registry.ts'; console.log(JSON.stringify({characters:allCharacters.map(({name,faction,maxHealth,skills})=>({name,faction,maxHealth,skills})),registeredSkills:[...buildSkillModuleSpecs().entries()]}));";
  const output = execSync(`pnpm exec tsx -e "${code}"`, {
    cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, shell: true, windowsHide: true,
  });
  const jsonStart = output.indexOf('{"characters":');
  if (jsonStart < 0) throw new Error(`tsx roster probe did not return JSON: ${output.slice(0, 500)}`);
  return JSON.parse(output.slice(jsonStart).trim());
}

function tableSkills(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '## 技能列表');
  if (start < 0) return [];
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    section.push(line);
  }
  return section.flatMap((line) => {
    if (!line.trim().startsWith('|')) return [];
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
    if (cells.length < 3 || !cells[0] || cells[0].includes('技能名称') || /^-+$/.test(cells[0])) return [];
    return [{ name: cells[0], type: cells[1], officialRule: cells[2] }];
  });
}

function linkedSkillRefs(markdown) {
  return [...markdown.matchAll(/<font\s+href=['"](\d+)['"]>(.*?)<\/font>/g)].map((match) => ({
    hrefId: match[1],
    name: match[2].replace(/<[^>]+>/g, '').trim(),
  }));
}

function skillDetail(markdown, skillName) {
  const escaped = skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const section = markdown.match(new RegExp(`^###\\s+${escaped}(?:（[^\\n]*?）)?\\s*\\n([\\s\\S]*?)(?=^###\\s+|^##\\s+|$)`, 'm'))?.[1] ?? '';
  const mechanismSummary = section.match(/\*\*机制简述\*\*[：:]\s*(.+)/)?.[1]?.trim() ?? null;
  const detail = section.replace(/^>.*$/gm, '').replace(/\s+/g, ' ').trim() || null;
  return { mechanismSummary, detail };
}

async function getSkillFiles() {
  const files = await collectFiles(skillRoot, '.ts');
  return new Map(files.map((file) => [path.basename(file, '.ts'), path.relative(root, file).replaceAll('\\', '/') ]));
}

function modelRequirements(section, faction, title) {
  const requirements = [];
  if (section === '晋' || section === '神') requirements.push(`势力 ${faction} 不在当前 Faction 联合类型及 allCharacters 可选池中`);
  if (title.startsWith('国战')) requirements.push('当前 GameMode 未实现国战，双将、副将技与国战开局/胜负规则不在现有规则包中');
  return requirements;
}

function skillModelTriage(text, section, title) {
  if (!text.trim()) return '规则待补';
  if (title.startsWith('国战')) return '模式扩展：国战/双将';
  if (section === '晋' || section === '神') return '势力扩展：当前势力类型/选将池不含该势力';
  const hardGaps = [
    /额外.{0,4}武器栏/,
    /武将牌.{0,8}当武器牌/,
    /冰(?:属性|【杀】|杀)/,
    /军争包/,
  ];
  if (hardGaps.some((pattern) => pattern.test(text))) return '明确需要普通机制模型扩展';
  if (/宝物牌/.test(text)) return '需补卡牌定义/机制（宝物装备槽已存在）';
  return '现有机制可复用，需逐项规则审查';
}

const live = extractLiveData();
const skillModules = await getSkillFiles();
const liveByName = new Map(live.characters.map((character) => [character.name, character]));
const registry = new Map(live.registeredSkills);
const details = JSON.parse(await readFile(path.join(researchRoot, '.hero-cache/details.json'), 'utf8'));
const knownSkillRules = new Map();
for (const hero of details) for (const skill of hero.skills ?? []) {
  if (skill.name && skill.desc && !knownSkillRules.has(skill.name)) knownSkillRules.set(skill.name, skill.desc);
}

const paths = (await collectFiles(researchRoot)).filter((file) => !file.includes(`${path.sep}.hero-cache${path.sep}`)).sort();
const characters = [];
for (const documentPath of paths) {
  const markdown = await readFile(documentPath, 'utf8');
  const title = markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (!title || !markdown.includes('## 技能列表')) continue;
  const relativeDocument = path.relative(root, documentPath).replaceAll('\\', '/');
  const researchSection = path.basename(path.dirname(documentPath));
  const faction = markdown.match(/^\|\s*势力\s*\|\s*(.*?)\s*\|\s*$/m)?.[1]?.trim() ?? null;
  const maxHealth = markdown.match(/^\|\s*体力上限\s*\|\s*(.*?)\s*\|\s*$/m)?.[1]?.trim() ?? null;
  const documentEngineStatus = markdown.match(/引擎状态.*?([✅⚠️❌][^\n|]*)/)?.[1]?.trim() ?? null;
  const currentCharacter = liveByName.get(title) ?? null;
  const skills = tableSkills(markdown).map((skill) => {
    const detail = skillDetail(markdown, skill.name);
    const moduleSpec = registry.get(skill.name) ?? null;
    const implementationFile = moduleSpec
      ? `${path.posix.normalize(`src/engine/${moduleSpec.split('#')[0]}`)}.ts`
      : skillModules.get(skill.name) ?? null;
    return {
      ...skill,
      ...detail,
      ruleStatus: skill.officialRule ? 'hasRuleText' : 'missingPlaceholderRule',
      implementationFile,
      implementationFileExists: implementationFile !== null,
      registeredSkillId: moduleSpec !== null,
      registryModuleSpec: moduleSpec,
      registryNameIsOnlyModuleEvidence: moduleSpec !== null,
      implementedBehaviorVerified: false,
      feasibilityTriage: skillModelTriage(`${skill.officialRule} ${detail.mechanismSummary ?? ''}`, researchSection, title),
    };
  });
  const linkedSkills = linkedSkillRefs(markdown).map((reference) => {
    const localRule = knownSkillRules.get(reference.name) ?? null;
    const moduleSpec = registry.get(reference.name) ?? null;
    return {
      ...reference,
      localRule,
      implementationFile: moduleSpec ? `src/engine/${moduleSpec.split('#')[0]}.ts` : skillModules.get(reference.name) ?? null,
      registeredSkillId: moduleSpec !== null,
      ruleFoundInLocalDetailsCache: localRule !== null,
      unresolvedReferenceRule: localRule === null,
    };
  });
  characters.push({
    name: title,
    document: relativeDocument,
    researchSection,
    faction,
    maxHealth,
    documentEngineStatus,
    playableInCurrentRoster: currentCharacter !== null,
    currentCharacter,
    modelRequirements: modelRequirements(researchSection, faction, title),
    skills,
    linkedSkills,
  });
}

const physicalCharacterFiles = (await readdir(path.join(root, 'src/engine/data/characters')))
  .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
  .map((name) => name.slice(0, -3)).sort();
const names = characters.map((character) => character.name);
const researchSkillRows = characters.flatMap((character) => character.skills);
const uniqueResearchSkillNames = [...new Set(researchSkillRows.filter((skill) => skill.officialRule).map((skill) => skill.name))];
const uniquePlayableSkills = [...new Set(live.characters.flatMap((character) => character.skills.map((skill) => skill.name)))];
const coverage = {};
for (const section of ['魏国', '蜀国', '吴国', '群雄', '神', '晋']) {
  const sectionRows = characters.filter((character) => character.researchSection === section);
  coverage[section] = {
    researchDocuments: sectionRows.length,
    researchSkillReferences: sectionRows.reduce((sum, character) => sum + character.skills.length, 0),
    documentMarkedImplemented: sectionRows.filter((character) => character.documentEngineStatus === '✅已实现').length,
    documentMarkedUnimplemented: sectionRows.filter((character) => character.documentEngineStatus?.startsWith('⚠️')).length,
    currentlyPlayableDocumentHeroes: sectionRows.filter((character) => character.playableInCurrentRoster).length,
    unimplementedResearchHeroesNotPlayable: sectionRows.filter((character) => character.documentEngineStatus?.startsWith('⚠️') && !character.playableInCurrentRoster).length,
  };
}

const linkIndex = new Map();
for (const character of characters) for (const link of character.linkedSkills) {
  const key = `${link.hrefId}\t${link.name}`;
  const existing = linkIndex.get(key) ?? { ...link, sourceDocuments: [] };
  existing.sourceDocuments.push(character.document);
  linkIndex.set(key, existing);
}
const linkedSkillReferences = [...linkIndex.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
const nameCounts = new Map();
for (const name of names) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
const registryOnlyResearchSkills = [...new Set(characters.flatMap((character) => character.skills
  .filter((skill) => skill.registeredSkillId && !character.playableInCurrentRoster)
  .map((skill) => skill.name)))].sort();

const inventory = {
  schemaVersion: '1.1.0',
  generatedAt: new Date().toISOString(),
  scope: 'Research rule transcription, current roster and skill registry declaration inventory. File/registry presence does not prove that a particular researched character or skill behavior is implemented.',
  sources: {
    characterDataDirectory: 'src/engine/data/characters/*.ts',
    playableRoster: 'src/engine/data/characters/index.ts allCharacters',
    skillRegistration: 'src/engine/skills/registry.ts buildSkillModuleSpecs()',
    researchDirectory: 'docs/research/武将技能/**/*.md',
    linkedSkillRuleCache: 'docs/research/武将技能/.hero-cache/details.json',
  },
  counts: {
    characterSourceFiles: physicalCharacterFiles.length,
    currentlyPlayableCharacters: live.characters.length,
    currentlyPlayableUniqueCharacterNames: new Set(live.characters.map((character) => character.name)).size,
    researchCharacterDocuments: characters.length,
    uniqueResearchCharacterNames: new Set(names).size,
    researchSkillTableEntries: researchSkillRows.length,
    researchSkillEntriesWithRule: researchSkillRows.filter((skill) => skill.officialRule).length,
    researchSkillPlaceholderRows: researchSkillRows.filter((skill) => !skill.officialRule).length,
    researchSkillReferences: researchSkillRows.filter((skill) => skill.officialRule).length,
    uniqueResearchSkillNames: uniqueResearchSkillNames.length,
    uniquePlayableSkillNames: uniquePlayableSkills.length,
    uniqueRegisteredSkillIds: registry.size,
    exactNamesInRosterAndResearch: new Set(names.filter((name) => liveByName.has(name))).size,
    researchNamesNotInRoster: new Set(names.filter((name) => !liveByName.has(name))).size,
    rosterNamesWithoutResearchDocs: new Set(live.characters.map((character) => character.name).filter((name) => !nameCounts.has(name))).size,
    uniqueLinkedSkillReferences: linkedSkillReferences.length,
    linkedSkillsWithLocalRule: linkedSkillReferences.filter((skill) => skill.ruleFoundInLocalDetailsCache).length,
    linkedSkillsWithoutLocalRule: linkedSkillReferences.filter((skill) => skill.unresolvedReferenceRule).length,
    nonPlayableResearchSkillsWithRegisteredSameName: registryOnlyResearchSkills.length,
  },
  factionCoverage: coverage,
  differences: {
    sourceFilesNotPlayableRoster: physicalCharacterFiles.filter((name) => !liveByName.has(name)),
    playableRosterWithoutDedicatedSourceFile: live.characters.map((character) => character.name).filter((name) => !physicalCharacterFiles.includes(name)).sort(),
    researchNamesNotInPlayableRoster: [...new Set(names.filter((name) => !liveByName.has(name)))].sort(),
    playableRosterWithoutResearchDocument: live.characters.map((character) => character.name).filter((name) => !nameCounts.has(name)).sort(),
    repeatedResearchNames: [...nameCounts.entries()].filter(([, count]) => count > 1).map(([name]) => ({ name, documents: characters.filter((character) => character.name === name).map((character) => character.document) })),
    registrySameNameDoesNotProveResearchHeroImplemented: registryOnlyResearchSkills,
  },
  linkedSkillReferences,
  characters,
  currentlyPlayableCharacters: live.characters,
  skillRegistryIds: [...registry.keys()].sort(),
  limitations: [
    'Official rules and mechanism summaries are transcribed from research Markdown; records also preserve linked skill references separately.',
    'A module file or registered skill ID can belong to a different playable character. It is not proof that this research hero or linked skill is complete.',
    'implementedBehaviorVerified is false throughout; behavior-level completeness requires code and scenario review.',
    'Factions and selection status use the current allCharacters roster. Character names are compared exactly; aliases are not normalized.',
    'Only linked skill rules present in the local details cache are marked resolved; unresolved linked references remain explicitly listed.',
  ],
};

await writeFile(path.join(qaRoot, '2026-11-09-skills-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');

const lines = [
  '# 2026-11-09 武将技能名册与神将覆盖核查',
  '',
  '> 完整机器可核对清单：[`2026-11-09-skills-inventory.json`](./2026-11-09-skills-inventory.json)。重跑：`node scripts/audit-skill-inventory.mjs`。',
  '',
  '## 核查口径',
  '',
  '- 当前可选按 `allCharacters` 判定；源码文件或技能模块存在不等于角色/技能已经可选或规则完整。',
  '- 技能表规则、机制摘要、实现文件、registry 声明、可选状态、研究文档中引用的衍生技能均分开记录。',
  '- JSON 中 `implementedBehaviorVerified` 均为 `false`；可实现性只标明确势力/模式/模型依赖，其他条目须逐项规则审查。',
  '',
  '## 全量规模',
  '',
  `- 角色源码 ${physicalCharacterFiles.length} 个；` + `allCharacters` + ` 当前 ${live.characters.length} 名；可选名册去重技能 ${uniquePlayableSkills.length} 个；registry 技能 ID ${registry.size} 个。`,
  `- 研究文档 ${characters.length} 份，技能表条目 ${researchSkillRows.length} 条（有效规则 ${researchSkillRows.filter((skill) => skill.officialRule).length} 条，占位/空规则 ${researchSkillRows.filter((skill) => !skill.officialRule).length} 条），去重有效技能名 ${uniqueResearchSkillNames.length} 个；研究标题与当前名册精确同名 ${new Set(names.filter((name) => liveByName.has(name))).size} 名。`,
  `- 文档中有 ${linkedSkillReferences.length} 个独立 href 技能引用；本地缓存能按技能名找到规则 ${linkedSkillReferences.filter((skill) => skill.ruleFoundInLocalDetailsCache).length} 个，未找到 ${linkedSkillReferences.filter((skill) => skill.unresolvedReferenceRule).length} 个。详见 JSON ` + '`linkedSkillReferences`。',
  '',
  '## 势力目录统计',
  '',
  '| 研究目录 | 文档 | 技能引用 | 文档标已实现 | 当前可选 | 未实现且不可选 |',
  '|---|---:|---:|---:|---:|---:|',
  ...Object.entries(coverage).map(([section, value]) => `| ${section} | ${value.researchDocuments} | ${value.researchSkillReferences} | ${value.documentMarkedImplemented} | ${value.currentlyPlayableDocumentHeroes} | ${value.unimplementedResearchHeroesNotPlayable} |`),
  '',
  '## 神将逐将覆盖',
  '',
  '神势力全部 15 篇档案均标为未实现、未进入当前名册。每位武将逐技能规则、机制摘要、实现文件候选、注册状态和链接技能均在 JSON `characters` 中。',
  '',
  ...characters.filter((character) => character.researchSection === '神').map((character) => `- **${character.name}**（${character.maxHealth}血）：${character.skills.map((skill) => `${skill.name}：${skill.mechanismSummary ?? skill.officialRule}`).join('；')}`),
  '',
  '## 晋与其他未实现研究武将',
  '',
  '晋势力文档，以及魏蜀吴群中未实装/未列入可选名册者，均按角色和技能逐条收录在 JSON。研究文档状态、模块注册和当前名册分别记录。',
  '',
  '## 名册差异与链接技能',
  '',
  '- `differences` 列出源码文件、可选名册、研究标题的精确差异；同名注册技能与研究武将完整实现不是同一结论。',
  '- `linkedSkillReferences` 列出从 `<font href=...>` 指向但没有单独出现在该武将技能表中的技能。缓存没收录规则时显式标为未解析，不推定其已实现。',
  '- 神与晋当前不在 `Faction` 类型和 `allCharacters` 选将池；国战档案的双将规则也不能按普通身份局角色直接处理。',
  '',
];
await writeFile(path.join(qaRoot, '2026-11-09-skills-shen-coverage.md'), lines.join('\n'), 'utf8');

console.log(JSON.stringify(inventory.counts, null, 2));
