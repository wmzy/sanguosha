// Reproducible inventory probe; this checks wiring, not full gameplay semantics.
import { writeFileSync, mkdirSync } from 'node:fs';
import { allCharacters } from '../src/engine/data/characters';
import { buildSkillModuleSpecs } from '../src/engine/skills/registry';
import { getSkillModule, instantiateSkill } from '../src/engine/skills/lifecycle';
import { createGameState } from '../src/engine/types';
import type { FrontendAPI, PlayerState } from '../src/engine/types';
import { findActionEntry } from '../src/engine/core/skill';
import '../src/engine/atoms';

const specs = buildSkillModuleSpecs();
const skills = [];
for (const [id, spec] of specs) {
  const players: PlayerState[] = Array.from({ length: 5 }, (_, index) => ({
    index, name: `P${index}`, character: '曹操', faction: index === 1 ? '群' : '魏',
    health: 3, maxHealth: 4, alive: true, hand: [], equipment: {},
    skills: index === 0 ? [id] : [], vars: {}, marks: [], tags: [],
    pendingTricks: [], judgeZone: [],
  }));
  const state = createGameState({ players, cardMap: {}, currentPlayerIndex: 0,
    phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} } });
  const actions: Array<{ skillId: string; actionType: string; prompt: string; backend: boolean; backendOwners: number[] }> = [];
  try {
    const mod = await getSkillModule(id);
    const skill = await instantiateSkill(state, id, 0);
    if (!skill) throw new Error('instantiateSkill returned null');
    const api: FrontendAPI = {
      viewer: 0, onEvent: () => () => {}, playEffect: () => {},
      defineAction(actionType, opts, override) {
        const skillId = override ?? id;
        actions.push({ skillId, actionType, prompt: opts.prompt.type,
          backend: !!findActionEntry(state, skillId, 0, actionType),
          backendOwners: players.filter((p) => !!findActionEntry(state, skillId, p.index, actionType)).map((p) => p.index) });
      },
    };
    mod.onMount?.(skill, api);
    skills.push({ id, spec, description: skill.description, locked: skill.isLocked ?? false, actions });
  } catch (error) {
    skills.push({ id, spec, error: String(error), actions });
  }
}
const output = {
  scope: 'Module import + createSkill + onInit + onMount on a five-player empty-hand fixture; no skill effect acceptance claim.',
  characters: allCharacters.map((c) => ({ name: c.name, faction: c.faction, skills: c.skills.map((s) => s.name) })),
  counts: { characters: allCharacters.length,
    characterSkills: new Set(allCharacters.flatMap((c) => c.skills.map((s) => s.name))).size,
    modules: skills.length, loadErrors: skills.filter((s) => 'error' in s).length,
    declaredActions: skills.reduce((n, s) => n + s.actions.length, 0),
    missingBackendActions: skills.flatMap((s) => s.actions).filter((a) => !a.backend).length,
    missingBackendOnAllSeats: skills.flatMap((s) => s.actions).filter((a) => !a.backendOwners.length).length },
  missingDerivedModules: ['清侧', '怀柔', '思蜀'].filter((id) => !specs.has(id)),
  skills,
};
mkdirSync('docs/qa', { recursive: true });
writeFileSync(process.argv[2] ?? 'docs/qa/2026-11-09-skills-runtime.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ...output.counts, missingDerivedModules: output.missingDerivedModules,
  errors: skills.filter((s) => 'error' in s),
  missingBackendActions: skills.flatMap((s) => s.actions.filter((a) => !a.backend).map((a) => ({ module: s.id, ...a }))) }, null, 2));
