import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
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
  const proxyStr = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(gemini ? { 'x-goog-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` }),
  };
  const bodyStr = JSON.stringify(body);

  if (proxyStr && url.startsWith('https://')) {
    const proxy = new URL(proxyStr);
    const targetUrl = new URL(url);
    const data = await new Promise<string>((resolve, reject) => {
      const connectReq = http.request({
        host: proxy.hostname,
        port: proxy.port,
        method: 'CONNECT',
        path: `${targetUrl.hostname}:443`,
      });
      const onAbort = () => {
        connectReq.destroy();
        reject(new Error('Request aborted'));
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          return reject(new Error(`Proxy CONNECT failed with HTTP ${res.statusCode}`));
        }
        const tlsSocket = tls.connect({ socket, servername: targetUrl.hostname });
        tlsSocket.on('secureConnect', () => {
          const req = https.request(
            {
              host: targetUrl.hostname,
              path: targetUrl.pathname + targetUrl.search,
              method: 'POST',
              headers: { ...headers, Host: targetUrl.hostname },
              createConnection: () => tlsSocket,
            },
            (targetRes) => {
              let resBody = '';
              targetRes.on('data', (chunk) => {
                resBody += chunk;
              });
              targetRes.on('end', () => {
                if (signal) signal.removeEventListener('abort', onAbort);
                if (targetRes.statusCode && (targetRes.statusCode < 200 || targetRes.statusCode >= 300)) {
                  const safeBody = safeErrorBody(resBody, apiKey);
                  return reject(new Error(`Model API request failed with HTTP ${targetRes.statusCode}${safeBody ? `: ${safeBody}` : ''}`));
                }
                resolve(resBody);
              });
            },
          );
          req.on('error', (err) => {
            if (signal) signal.removeEventListener('abort', onAbort);
            reject(err);
          });
          req.write(bodyStr);
          req.end();
        });
        tlsSocket.on('error', (err) => {
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(err);
        });
      });

      connectReq.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(err);
      });
      connectReq.end();
    });

    return JSON.parse(data);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: bodyStr,
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
  if (config.protocol === 'codex-cli') {
    const tmpDir = tmpdir();
    const id = `codex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tmpFile = join(tmpDir, `${id}.json`);
    const prompt = messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');
    const effort = config.reasoningEffort ?? 'high';

    return new Promise<ModelReply>((resolvePromise, rejectPromise) => {
      const child = spawn('codex', [
        'exec',
        '-m', config.model,
        '-c', `model_reasoning_effort="${effort}"`,
        '-c', 'features.plugins=false',
        '-c', 'features.hooks=false',
        '--ephemeral',
        '-o', tmpFile,
        '-',
      ], { shell: true });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout?.on('data', (d) => { stdoutChunks.push(Buffer.from(d)); });
      child.stderr?.on('data', (d) => { stderrChunks.push(Buffer.from(d)); });

      const onAbort = () => {
        child.kill();
        try { if (existsSync(tmpFile)) unlinkSync(tmpFile); } catch {}
        rejectPromise(new Error('Codex CLI execution aborted'));
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      child.stdin.write(prompt);
      child.stdin.end();

      child.on('close', (code) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (code !== 0 && !existsSync(tmpFile)) {
          return rejectPromise(new Error(`Codex CLI failed with exit code ${code}`));
        }
        try {
          if (!existsSync(tmpFile)) {
            return rejectPromise(new Error('Codex CLI produced no output file'));
          }
          const content = readFileSync(tmpFile, 'utf8');
          try { unlinkSync(tmpFile); } catch {}
          const combined = Buffer.concat([...stdoutChunks, ...stderrChunks]).toString('utf8');
          const tokenMatch = combined.match(/tokens used\s*([\d,]+)/i);
          const totalTokens = tokenMatch ? parseInt(tokenMatch[1].replace(/,/g, ''), 10) : undefined;
          const usage = totalTokens !== undefined ? { inputTokens: totalTokens, outputTokens: 0 } : undefined;
          resolvePromise({ decision: parseModelDecision(content), usage });
        } catch (err) {
          rejectPromise(err);
        }
      });

      child.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        rejectPromise(err);
      });
    });
  }

  let apiKey = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;
  if (!apiKey && config.apiKeyEnv) {
    try {
      const credPath = join(homedir(), '.dsh', '.credentials.yaml');
      if (existsSync(credPath)) {
        const match = readFileSync(credPath, 'utf8').match(new RegExp(`${config.apiKeyEnv}:\\s*([^\\s]+)`));
        if (match) {
          apiKey = match[1];
          process.env[config.apiKeyEnv] = apiKey;
        }
      }
    } catch {}
  }
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
      ...(config.reasoningEffort === 'medium' ? { thinkingConfig: { thinkingBudget: 2048 } } : {}),
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
