import type { SkillPhase, PhaseDefinition, GameState, SkillContext, EngineResult, AtomLogEntry } from './types';

const registry = new Map<string, PhaseDefinition>();

export function registerPhase<P>(def: PhaseDefinition<P>): void {
  if (registry.has(def.type)) {
    throw new Error(`Phase type "${def.type}" already registered`);
  }
  registry.set(def.type, def);
}

export function getPhaseDef(type: string): PhaseDefinition {
  const def = registry.get(type);
  if (!def) throw new Error(`Unknown phase type: "${type}"`);
  return def;
}

export function executePlan(
  state: GameState,
  phases: SkillPhase[],
  ctx: SkillContext,
  resumeFrom?: number,
): EngineResult {
  let s = state;
  const logEntries: AtomLogEntry[] = [];
  const hadPendingOnEntry = s.pending !== null;

  for (let i = resumeFrom ?? 0; i < phases.length; i++) {
    const phase = phases[i];
    const def = getPhaseDef(phase.type);
    const result = def.execute(s, phase, ctx, phases, i);
    s = result.state;
    logEntries.push(...result.logEntries);
    if (result.error) {
      return { state: s, logEntries, error: result.error };
    }
    // Only break if a NEW pending was created during execution
    if (!hadPendingOnEntry && s.pending !== null) {
      return { state: s, logEntries };
    }
  }

  return { state: s, logEntries };
}
