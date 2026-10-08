import { ProviderError } from '../engine/errors';
import type { DecideRequest, DecideResult } from '../engine/runner';

export type OpenAICompatible = 'openai' | 'openrouter';

const URLS: Record<OpenAICompatible, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

async function toError(res: Response): Promise<ProviderError> {
  let body: { error?: { message?: string; code?: string | number; type?: string } } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const msg = body.error?.message ?? `HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) return new ProviderError('auth', msg);
  // 402: out of OpenRouter credits; insufficient_quota: out of OpenAI credit.
  if (res.status === 402 || body.error?.code === 'insufficient_quota' || body.error?.type === 'insufficient_quota') {
    return new ProviderError('quota', msg);
  }
  if (res.status === 429) {
    const after = Number(res.headers.get('retry-after'));
    return new ProviderError('rate', msg, Number.isFinite(after) && after > 0 ? after * 1000 : undefined);
  }
  if (res.status >= 500) return new ProviderError('server', msg);
  return new ProviderError('bad_request', msg);
}

/**
 * OpenAI Chat Completions, and OpenRouter's compatible endpoint (Llama,
 * DeepSeek and other open models). Models differ in what they accept, so a
 * 400 steps down: strict JSON schema with temperature, then without
 * temperature (reasoning models only take the default), then plain JSON mode.
 */
export async function openAICompatDecide(
  provider: OpenAICompatible,
  apiKey: string,
  model: string,
  req: DecideRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<DecideResult> {
  const schemaFormat = { type: 'json_schema', json_schema: { name: 'decision', strict: true, schema: req.schema } };
  const attempts = [
    { response_format: schemaFormat, temperature: req.temperature },
    { response_format: schemaFormat },
    { response_format: { type: 'json_object' } },
  ];
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  if (provider === 'openrouter' && typeof location !== 'undefined') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'Zira';
  }

  let res: Response | undefined;
  for (const extra of attempts) {
    try {
      res = await fetchImpl(URLS[provider], {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt },
          ],
          ...extra,
        }),
      });
    } catch (e) {
      throw new ProviderError('server', e instanceof Error ? e.message : 'network error');
    }
    if (res.status !== 400) break;
  }
  if (!res!.ok) throw await toError(res!);

  const data = (await res!.json()) as {
    choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  };
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) return { text: null, refusal: choice.message.refusal };
  if (!choice?.message?.content && choice?.finish_reason === 'content_filter') return { text: null, refusal: 'content_filter' };
  return { text: choice?.message?.content ?? null };
}
