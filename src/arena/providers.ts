import type { ApiPlayerConfig, ArenaDecision, ModelMessage, ModelReply } from './types';

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_COMPATIBLE_BASE_URL = 'https://api.deepseek.com';
const MAX_ERROR_BODY_LENGTH = 500;

function extractDecisionText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return (start >= 0 && end > start ? text.slice(start, end + 1) : text).trim();
}

export function parseModelDecision(text: string): ArenaDecision {
  let value: unknown;
  try {
    value = JSON.parse(extractDecisionText(text));
  } catch {
    throw new Error('Model response must contain a JSON decision.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Model decision must be a JSON object.');
  }
  const actionId = (value as Record<string, unknown>).actionId;
  if (typeof actionId !== 'string' || !actionId.trim()) {
    throw new Error('Model decision actionId must be a non-empty string.');
  }
  const record = value as Record<string, unknown>;
  for (const key of ['memory', 'strategySummary', 'publicSpeech', 'decisionId']) {
    if (record[key] !== undefined && typeof record[key] !== 'string') throw new Error(`Model decision ${key} must be a string.`);
  }
  if (record.params !== undefined && (!record.params || typeof record.params !== 'object' || Array.isArray(record.params)))
    throw new Error('Model decision params must be an object.');
  return value as ArenaDecision;
}

function safeErrorBody(body: string, apiKey: string): string {
  let safe = body.replaceAll(apiKey, '[redacted]');
  // Avoid surfacing credentials echoed by a provider, even if its exact token differs.
  safe = safe.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]');
  return safe.slice(0, MAX_ERROR_BODY_LENGTH);
}

async function postJson(url: string, apiKey: string, body: unknown, signal: AbortSignal | undefined, gemini: boolean) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(gemini ? { 'x-goog-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` }),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const responseBody = safeErrorBody(await response.text().catch(() => ''), apiKey);
    throw new Error(`Model API request failed with HTTP ${response.status}${responseBody ? `: ${responseBody}` : ''}`);
  }
  return response.json() as Promise<{
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  }>;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((part) => part && typeof part.text === 'string' ? part.text : '').join('');
  }
  return '';
}

export async function callModel(config: ApiPlayerConfig, messages: ModelMessage[], signal?: AbortSignal): Promise<ModelReply> {
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey?.trim()) {
    throw new Error(`API key is missing: set environment variable ${config.apiKeyEnv}.`);
  }

  if (config.protocol === 'openai-compatible') {
    const baseUrl = (config.baseUrl ?? DEFAULT_COMPATIBLE_BASE_URL).replace(/\/+$/, '');
    const payload = await postJson(`${baseUrl}/chat/completions`, apiKey, {
      model: config.model,
      messages,
      temperature: config.temperature ?? 0.6,
      max_tokens: config.maxOutputTokens ?? 1500,
      response_format: { type: 'json_object' },
    }, signal, false);
    const content = asText(payload.choices?.[0]?.message?.content);
    if (!content) throw new Error('Model API returned no decision content.');
    const usage = payload.usage;
    return {
      decision: parseModelDecision(content),
      ...(usage ? { usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } } : {}),
    };
  }

  const baseUrl = (config.baseUrl ?? DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, '');
  const systemText = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const isGemma = config.model.toLowerCase().includes('gemma');
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = messages.filter((message) => message.role !== 'system').map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));
  if (isGemma && systemText) {
    const firstUser = contents.find((content) => content.role === 'user');
    if (firstUser) firstUser.parts[0].text = `${systemText}\n\n${firstUser.parts[0].text}`;
    else contents.unshift({ role: 'user', parts: [{ text: systemText }] });
  }
  const payload = await postJson(`${baseUrl}/models/${encodeURIComponent(config.model)}:generateContent`, apiKey, {
    ...(!isGemma && systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    contents,
    generationConfig: {
      temperature: config.temperature ?? 0.6,
      maxOutputTokens: config.maxOutputTokens ?? 1500,
      ...(!isGemma ? { responseMimeType: 'application/json' } : {}),
    },
  }, signal, true);
  const content = asText(payload.candidates?.[0]?.content?.parts);
  if (!content) throw new Error('Model API returned no decision content.');
  const usage = payload.usageMetadata;
  return {
    decision: parseModelDecision(content),
    ...(usage ? { usage: { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount } } : {}),
  };
}
