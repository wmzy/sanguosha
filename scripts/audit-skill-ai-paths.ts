// Ordinary-path reproductions for the skill audit; does not modify game rules.
import { writeFileSync } from 'node:fs';
import { createGameState } from '../src/engine/types';
import type { Card, PlayerState } from '../src/engine/types';
import { buildView, registerSkillsFromState } from '../src/engine';
import { findActionEntry } from '../src/engine/core/skill';
import { clearRegistry, registerSkillActions } from '../src/client/skillActionRegistry';
import { HeadlessGameClient } from '../src/client/headless/HeadlessGameClient';
import '../src/engine/atoms';

const dodge: Card = { id: 'dodge', name: '闪', suit: '♥', color: '红', rank: '2', type: '基本牌' };
function player(index: number, skills: string[]): PlayerState {
  return { index, name: `P${index}`, character: index === 0 ? '张角' : '于吉', faction: '群',
    health: 3, maxHealth: 3, alive: true, hand: index === 1 ? [dodge.id] : [],
    equipment: {}, skills, vars: {}, marks: [], tags: [], pendingTricks: [], judgeZone: [] };
}
const findings = [];
for (const skill of ['黄天', '界黄天', '反间']) {
  const state = createGameState({ players: [player(0, [skill]), player(1, [])],
    cardMap: { [dodge.id]: dodge }, currentPlayerIndex: 1,
    phase: '出牌', turn: { round: 1, phase: '出牌', vars: {} } });
  await registerSkillsFromState(state);
  clearRegistry();
  for (const p of state.players) await registerSkillActions(p.index, p.skills);
  const view = buildView(state, 1);
  if (skill === '反间') {
    view.pending = {
      target: 1, isBlocking: true, deadline: 0,
      atom: { type: '请求回应', requestType: '反间/选花色', target: 1 },
      prompt: { type: 'chooseSuit', title: '反间：请选择一种花色', suits: ['♠', '♥', '♣', '♦'] },
    } as unknown as NonNullable<typeof view.pending>;
  }
  const client = new HeadlessGameClient('http://unused');
  Object.assign(client, { _view: view, _seatIndex: 1 });
  const actions = client.getAvailableActions();
  const relevant = actions.filter((a) => a.message.skillId === skill);
  findings.push({ skill, scenario: skill === '反间' ? '目标收到选花色询问' : '群势力盟友持闪、自己的出牌阶段',
    backendActionExists: !!findActionEntry(state, skill, 1, skill === '反间' ? 'respond' : 'use'),
    skillActions: relevant.map((a) => a.message), allDescriptions: actions.map((a) => a.description),
    executableSuitChoices: relevant.filter((a) => typeof a.message.params.suit === 'string').length });
}
writeFileSync('docs/qa/2026-11-09-skills-ai-paths.json', `${JSON.stringify(findings, null, 2)}\n`);
console.log(JSON.stringify(findings, null, 2));
