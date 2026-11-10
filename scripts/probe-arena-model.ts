// Minimal real-model check. No credentials are written or printed.
import { callModel } from '../src/arena/providers';
import { PLAYER_INSTRUCTIONS } from '../src/arena/player';

const model = process.argv[2] ?? 'gemini-3.8-flash';
const reply = await callModel({ protocol: 'gemini', model, apiKeyEnv: 'GEMINI_API_KEY', maxOutputTokens: 1000 }, [
  { role: 'system', content: PLAYER_INSTRUCTIONS },
  { role: 'user', content: JSON.stringify({
    memory: '', observation: {
      decisionId: '0:1', state: { viewer: 0, players: [{ index: 0, identity: '主公', health: 1, maxHealth: 4, hand: [{ id: 'peach', name: '桃' }] }] },
      actions: [{ actionId: 'a0', description: '使用桃回复自己的体力', message: { params: { cardId: 'peach', targets: [0] } } }, { actionId: 'a1', description: '结束回合' }],
    },
  }) },
], AbortSignal.timeout(60000));
process.stdout.write(`${JSON.stringify({ model, ...reply })}\n`);
