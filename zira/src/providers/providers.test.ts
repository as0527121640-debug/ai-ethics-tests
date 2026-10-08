/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { ProviderError } from '../engine/errors';
import type { DecideRequest } from '../engine/runner';
import { anthropicDecide } from './anthropic';
import { geminiDecide, listGeminiModels } from './gemini';
import { openAICompatDecide } from './openai';

const REQ = {
  system: 'SYS',
  prompt: 'PROMPT',
  schema: { type: 'object', properties: { rationale: { type: 'string' } }, required: ['rationale'], additionalProperties: false },
  temperature: 0.7,
  context: {} as DecideRequest['context'],
} satisfies DecideRequest;

interface Call { url: string; init: RequestInit; body: Record<string, unknown> }

function mockFetch(responses: (Response | (() => Response))[]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), init: init ?? {}, body });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return typeof r === 'function' ? r() : r.clone();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

describe('gemini', () => {
  it('sends the key in a header, the schema in generationConfig, and drops thought parts', async () => {
    const { fn, calls } = mockFetch([json(200, { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: '{"rationale":"ok"}' }] } }] })]);
    const res = await geminiDecide('KEY', 'models/gemini-3.8-flash', REQ, fn);
    expect(res).toEqual({ text: '{"rationale":"ok"}' });
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(calls[0].url).not.toContain('KEY');
    expect(header(calls[0], 'x-goog-api-key')).toBe('KEY');
    expect(calls[0].body).toMatchObject({
      systemInstruction: { parts: [{ text: 'SYS' }] },
      contents: [{ role: 'user', parts: [{ text: 'PROMPT' }] }],
      generationConfig: { temperature: 0.7, responseMimeType: 'application/json', responseJsonSchema: REQ.schema },
    });
  });

  it('retries without the schema when the model rejects it', async () => {
    const { fn, calls } = mockFetch([json(400, { error: { message: 'bad schema' } }), json(200, { candidates: [{ content: { parts: [{ text: '{}' }] } }] })]);
    expect(await geminiDecide('K', 'gemini-3.8-flash', REQ, fn)).toEqual({ text: '{}' });
    expect(calls).toHaveLength(2);
    expect((calls[1].body.generationConfig as Record<string, unknown>).responseJsonSchema).toBeUndefined();
  });

  it('maps a per-minute 429 to a rate error with its retry delay, and a per-day one to quota', async () => {
    const perMinute = json(429, { error: { message: 'slow', details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' },
    ] } });
    const err = await geminiDecide('K', 'm', REQ, mockFetch([perMinute]).fn).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'rate', retryAfterMs: 37000 });

    const perDay = json(429, { error: { message: 'done for today', details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
    ] } });
    await expect(geminiDecide('K', 'm', REQ, mockFetch([perDay]).fn)).rejects.toMatchObject({ kind: 'quota' });
    await expect(geminiDecide('K', 'm', REQ, mockFetch([json(403, { error: { message: 'bad key' } })]).fn)).rejects.toMatchObject({ kind: 'auth' });
    await expect(geminiDecide('K', 'm', REQ, mockFetch([json(503, {})]).fn)).rejects.toMatchObject({ kind: 'server' });
  });

  it('treats an invalid key (HTTP 400 API_KEY_INVALID) as an auth error without retrying', async () => {
    const badKey = json(400, { error: { code: 400, message: 'API key not valid.', status: 'INVALID_ARGUMENT', details: [
      { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' },
    ] } });
    const { fn, calls } = mockFetch([badKey]);
    await expect(geminiDecide('K', 'm', REQ, fn)).rejects.toMatchObject({ kind: 'auth', message: 'API key not valid.' });
    expect(calls).toHaveLength(1);
    const region = json(400, { error: { message: 'User location is not supported for the API use.', status: 'FAILED_PRECONDITION' } });
    await expect(geminiDecide('K', 'm', REQ, mockFetch([region]).fn)).rejects.toMatchObject({ kind: 'auth' });
  });

  it('reports safety blocks as refusals', async () => {
    expect(await geminiDecide('K', 'm', REQ, mockFetch([json(200, { promptFeedback: { blockReason: 'SAFETY' } })]).fn)).toMatchObject({ text: null });
    expect(await geminiDecide('K', 'm', REQ, mockFetch([json(200, { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })]).fn)).toMatchObject({ text: null });
  });

  it('lists generateContent models for the key check', async () => {
    const { fn } = mockFetch([json(200, { models: [
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] },
    ] })]);
    expect(await listGeminiModels('K', fn)).toEqual(['gemini-3.8-flash']);
  });
});

describe('openai-compatible', () => {
  it('steps down from strict schema + temperature to plain JSON mode on 400s', async () => {
    const ok = json(200, { choices: [{ message: { content: '{"rationale":"x"}' } }] });
    const { fn, calls } = mockFetch([json(400, { error: { message: 'temperature' } }), json(400, { error: { message: 'schema' } }), ok]);
    expect(await openAICompatDecide('openai', 'K', 'gpt-x', REQ, fn)).toEqual({ text: '{"rationale":"x"}' });
    expect(calls.map((c) => c.body.temperature)).toEqual([0.7, undefined, undefined]);
    expect(calls.map((c) => (c.body.response_format as { type: string }).type)).toEqual(['json_schema', 'json_schema', 'json_object']);
    expect(header(calls[0], 'authorization')).toBe('Bearer K');
  });

  it('maps quota, rate and refusal responses', async () => {
    await expect(openAICompatDecide('openai', 'K', 'm', REQ, mockFetch([json(429, { error: { code: 'insufficient_quota', message: 'no credit' } })]).fn)).rejects.toMatchObject({ kind: 'quota' });
    await expect(openAICompatDecide('openrouter', 'K', 'm', REQ, mockFetch([json(429, { error: { message: 'slow' } }, { 'retry-after': '5' })]).fn)).rejects.toMatchObject({ kind: 'rate', retryAfterMs: 5000 });
    await expect(openAICompatDecide('openrouter', 'K', 'm', REQ, mockFetch([json(402, { error: { message: 'credits' } })]).fn)).rejects.toMatchObject({ kind: 'quota' });
    expect(await openAICompatDecide('openai', 'K', 'm', REQ, mockFetch([json(200, { choices: [{ message: { content: null, refusal: 'I can’t' } }] })]).fn)).toEqual({ text: null, refusal: 'I can’t' });
  });
});

describe('anthropic', () => {
  const message = (over: Record<string, unknown> = {}) => ({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text: '{"rationale":"r"}' }],
    stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...over,
  });

  it('sends structured-output config without sampling parameters', async () => {
    const { fn, calls } = mockFetch([json(200, message())]);
    expect(await anthropicDecide('KEY', 'claude-opus-5-5', REQ, fn)).toEqual({ text: '{"rationale":"r"}' });
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(header(calls[0], 'x-api-key')).toBe('KEY');
    expect(header(calls[0], 'anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(calls[0].body).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'SYS',
      messages: [{ role: 'user', content: 'PROMPT' }],
      output_config: { format: { type: 'json_schema', schema: REQ.schema } },
    });
    expect(calls[0].body.temperature).toBeUndefined();
  });

  it('returns refusals as data and maps HTTP errors', async () => {
    const refused = message({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms', explanation: 'declined' } });
    expect(await anthropicDecide('K', 'claude-opus-5-5', REQ, mockFetch([json(200, refused)]).fn)).toEqual({ text: null, refusal: 'declined' });
    const err = (status: number, extra: Record<string, string> = {}) =>
      json(status, { type: 'error', error: { type: 'x', message: 'm' } }, extra);
    await expect(anthropicDecide('K', 'm', REQ, mockFetch([err(401)]).fn)).rejects.toMatchObject({ kind: 'auth', message: 'm' });
    await expect(anthropicDecide('K', 'm', REQ, mockFetch([err(429, { 'retry-after': '3' })]).fn)).rejects.toMatchObject({ kind: 'rate', retryAfterMs: 3000 });
    await expect(anthropicDecide('K', 'm', REQ, mockFetch([err(400)]).fn)).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(anthropicDecide('K', 'm', REQ, mockFetch([err(529)]).fn)).rejects.toMatchObject({ kind: 'server' });
  });
});
