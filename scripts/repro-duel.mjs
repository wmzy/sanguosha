process.chdir('/home/zlt/projects/sanguosha');
const { engine } = await import('../engine/engine.ts');
const { createInitialState, getPlayer } = await import('../engine/state.ts');
const { registerCharacterTriggers } = await import('../engine/skill.ts');
const { allCharacters } = await import('../engine/characters/index.ts');
const fs = await import('fs');

const data = JSON.parse(fs.readFileSync('./data/rooms/NVMHYO.json'));
const characterMap = Object.fromEntries(allCharacters.map(c => [c.name, c]));
const config = {
  players: data.players.map((p) => ({
    name: p.name, characterId: p.characterId, role: p.role,
  })),
  seed: data.seed,
  characterMap,
};
let state = createInitialState(config);
for (const p of data.players) state = registerCharacterTriggers(state, p.name, { characterMap });

console.log('init 小乔 hp =', getPlayer(state, '小乔').health, 'max =', getPlayer(state, '小乔').maxHealth);

const sl = data.serverLog;
for (let i = 0; i < sl.length; i++) {
  const e = sl[i];
  const p = e.payload;
  if (e.type === 'damage' && p.target === '小乔') {
    const prev = getPlayer(state, '小乔').health;
    state = {
      ...state,
      players: {
        ...state.players,
        ['小乔']: { ...getPlayer(state, '小乔'), health: prev - p.amount },
      },
    };
    console.log(`[${e.id}] damage to 小乔: ${p.amount} from ${p.source} card ${p.cardId}, hp ${prev} -> ${getPlayer(state, '小乔').health}`);
  }
  if (e.type === 'heal' && p.target === '小乔') {
    const prev = getPlayer(state, '小乔').health;
    state = {
      ...state,
      players: {
        ...state.players,
        ['小乔']: { ...getPlayer(state, '小乔'), health: Math.min(prev + p.amount, getPlayer(state, '小乔').maxHealth) },
      },
    };
  }
  if (e.type === 'kill' && p.player === '小乔') {
    console.log(`[${e.id}] KILL 小乔 at hp=${getPlayer(state, '小乔').health}`);
  }
  if (e.type === 'pushPending' && p.type === 'dyingWindow' && p.dyingPlayer === '小乔') {
    console.log(`[${e.id}] dyingWindow pushed for 小乔 at hp=${getPlayer(state, '小乔').health}`);
  }
}
