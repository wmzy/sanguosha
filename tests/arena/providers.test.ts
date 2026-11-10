import { afterEach, describe, expect, it, vi } from 'vitest';
import { callModel, parseModelDecision } from '../../src/arena/providers';
import type { ApiPlayerConfig, ModelMessage } from '../../src/arena/types';

const messages: ModelMessage[] = [
  { role: 'system', content: 'Return a decision as JSON.' },
  { role: 'user', content: 'Choose an action.' },
  { role: 'assistant', content: '{"actionId":"previous"}' },
];

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ARENA_TEST_KEY;
});

describe('parseModelDecision', () => {
  it('parses a fenced JSON decision and requires a nonempty actionId', () => {
    expect(parseModelDecision('```json\n{"actionId":"play:slash"}\n```')).toEqual({ actionId: 'play:slash' });
    expect(() => parseModelDecision('{"actionId":"  "}')).toThrow(/actionId/);
  });

  it('accepts prose around JSON but rejects malformed memory and params', () => {
    expect(parseModelDecision('选择如下： {"actionId":"a0"} 完毕。').actionId).toBe('a0');
    expect(() => parseModelDecision('{"actionId":"a0","memory":{}}')).toThrow(/memory/);
    expect(() => parseModelDecision('{"actionId":"a0","params":[]}')).toThrow(/params/);
  });
});

describe('callModel', () => {
  it('sends OpenAI-compatible chat messages with JSON output and maps usage', async () => {
    process.env.ARENA_TEST_KEY = 'test-secret';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"actionId":"pass"}' } }],
      usage: { prompt_tokens: 21, completion_tokens: 5 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const config: ApiPlayerConfig = { protocol: 'openai-compatible', model: 'test-model', baseUrl: 'https://example.test/v1/', apiKeyEnv: 'ARENA_TEST_KEY' };

    const reply = await callModel(config, messages);
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }),
      body: expect.any(String),
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages).toEqual(messages);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(reply).toEqual({ decision: { actionId: 'pass' }, usage: { inputTokens: 21, outputTokens: 5 } });
  });

  it('converts system and conversation history to Gemini generateContent', async () => {
    process.env.ARENA_TEST_KEY = 'test-secret';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '```json\n{"actionId":"pass"}\n```' }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const reply = await callModel({ protocol: 'gemini', model: 'gemini-test', apiKeyEnv: 'ARENA_TEST_KEY' }, messages);
    expect(fetchMock).toHaveBeenCalledWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent', expect.objectContaining({
      headers: expect.objectContaining({ 'x-goog-api-key': 'test-secret' }),
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.systemInstruction.parts[0].text).toBe('Return a decision as JSON.');
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Choose an action.' }] },
      { role: 'model', parts: [{ text: '{"actionId":"previous"}' }] },
    ]);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(reply.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
  });

  it('folds system instructions into user text for Gemma and omits unsupported JSON mode', async () => {
    process.env.ARENA_TEST_KEY = 'test-secret';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"actionId":"pass"}' }] } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await callModel({ protocol: 'gemini', model: 'gemma-4-26b-a4b-it', apiKeyEnv: 'ARENA_TEST_KEY' }, messages);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.systemInstruction).toBeUndefined();
    expect(body.generationConfig.responseMimeType).toBeUndefined();
    expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'Return a decision as JSON.\n\nChoose an action.' }] });
    expect(body.contents[1]).toEqual({ role: 'model', parts: [{ text: '{"actionId":"previous"}' }] });
  });

  it('requires a configured environment key and redacts it from HTTP errors', async () => {
    await expect(callModel({ protocol: 'gemini', model: 'm', apiKeyEnv: 'ARENA_TEST_KEY' }, messages)).rejects.toThrow(/ARENA_TEST_KEY/);
    process.env.ARENA_TEST_KEY = 'secret-in-body';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`failure secret-in-body ${  'x'.repeat(600)}`, { status: 401 })));
    await expect(callModel({ protocol: 'gemini', model: 'm', apiKeyEnv: 'ARENA_TEST_KEY' }, messages)).rejects.toThrow(/401/);
    try {
      await callModel({ protocol: 'gemini', model: 'm', apiKeyEnv: 'ARENA_TEST_KEY' }, messages);
    } catch (error) {
      expect(String(error)).not.toContain('secret-in-body');
      expect(String(error).length).toBeLessThan(600);
    }
  });
});
