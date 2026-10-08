import { ProviderError } from '../engine/errors';
import type { DecideRequest, DecideResult } from '../engine/runner';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const BLOCKED_FINISH = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

type Fetch = typeof fetch;

/** Turns "37s" / "1.5s" into milliseconds. */
function durationMs(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^([\d.]+)s$/.exec(v.trim());
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : undefined;
}

type ErrorBody = { error?: { message?: string; status?: string; details?: Record<string, unknown>[] } };

async function errorBody(res: Response): Promise<ErrorBody> {
  try {
    return await res.clone().json();
  } catch {
    return {}; // non-JSON error body
  }
}

/**
 * Google answers a bad key, or a region without API access, with HTTP 400
 * rather than 401/403; those must stop the run instead of being retried.
 */
function isAccessProblem(body: ErrorBody): boolean {
  const reasons = (body.error?.details ?? []).map((d) => String(d.reason ?? ''));
  return reasons.some((r) => r.startsWith('API_KEY')) || body.error?.status === 'FAILED_PRECONDITION';
}

async function toError(res: Response): Promise<ProviderError> {
  const body = await errorBody(res);
  const msg = body.error?.message ?? `HTTP ${res.status}`;
  const details = body.error?.details ?? [];
  if (res.status === 401 || res.status === 403 || (res.status === 400 && isAccessProblem(body))) return new ProviderError('auth', msg);
  if (res.status === 429) {
    const retry = details.find((d) => String(d['@type']).endsWith('RetryInfo'));
    const quota = details.find((d) => String(d['@type']).endsWith('QuotaFailure'));
    const violations = (quota?.violations as { quotaId?: string; quotaValue?: string }[] | undefined) ?? [];
    // Per-day quotas don't come back within a run; per-minute ones do.
    const daily = violations.find((v) => /PerDay/i.test(v.quotaId ?? ''));
    if (daily) {
      const hours = Math.ceil((durationMs(retry?.retryDelay) ?? 0) / 3_600_000);
      const size = daily.quotaValue ? ` (${daily.quotaValue} בקשות ליום)` : '';
      const back = hours ? ` היא תתחדש בעוד כ-${hours} שעות.` : ' היא מתחדשת בחצות שעון פסיפיק, בסביבות 10:00 בבוקר שעון ישראל.';
      return new ProviderError('quota', `נגמרה המכסה היומית של המודל${size}.${back}`, durationMs(retry?.retryDelay));
    }
    return new ProviderError('rate', msg, durationMs(retry?.retryDelay));
  }
  if (res.status === 503) return new ProviderError('server', 'עומס אצל Google (503)');
  if (res.status >= 500) return new ProviderError('server', msg);
  return new ProviderError('bad_request', msg);
}

// Google's overload responses sometimes come without CORS headers, so the
// browser reports a bare network failure instead of the 503.
const NO_RESPONSE = 'אין תשובה מ-Google (בדרך כלל עומס זמני)';

function modelPath(model: string): string {
  return encodeURIComponent(model.replace(/^models\//, ''));
}

export async function geminiDecide(apiKey: string, model: string, req: DecideRequest, fetchImpl: Fetch = fetch): Promise<DecideResult> {
  const post = async (structured: boolean) => {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature,
        responseMimeType: 'application/json',
        ...(structured ? { responseJsonSchema: req.schema } : {}),
      },
    };
    try {
      return await fetchImpl(`${BASE}/models/${modelPath(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ProviderError('server', NO_RESPONSE);
    }
  };

  let res = await post(true);
  // Some models reject parts of the schema; the prompt alone still asks for the same JSON.
  if (res.status === 400 && !isAccessProblem(await errorBody(res))) res = await post(false);
  if (!res.ok) throw await toError(res);

  const data = (await res.json()) as {
    promptFeedback?: { blockReason?: string };
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  if (data.promptFeedback?.blockReason) return { text: null, refusal: `חסימה: ${data.promptFeedback.blockReason}` };
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (!text && cand?.finishReason && BLOCKED_FINISH.has(cand.finishReason)) {
    return { text: null, refusal: `חסימה: ${cand.finishReason}` };
  }
  if (!cand) return { text: null, refusal: 'לא התקבלה תשובה מהמודל' };
  return { text };
}

/** Lists the models this key can call with generateContent (also serves as a key check). */
export async function listGeminiModels(apiKey: string, fetchImpl: Fetch = fetch): Promise<string[]> {
  const res = await fetchImpl(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) throw await toError(res);
  const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => n.startsWith('gemini'));
}

export type ModelHealth = 'ok' | 'busy' | 'missing' | 'limited' | 'error';

/** One tiny request to see whether a model answers this key right now. */
export async function pingGemini(apiKey: string, model: string, fetchImpl: Fetch = fetch): Promise<{ health: ModelHealth; detail: string }> {
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}/models/${modelPath(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the word OK.' }] }] }),
    });
  } catch {
    return { health: 'busy', detail: NO_RESPONSE };
  }
  if (res.ok) return { health: 'ok', detail: 'עונה' };
  if (res.status === 404) return { health: 'missing', detail: 'המודל לא זמין למפתח הזה' };
  const err = await toError(res);
  if (err.kind === 'server') return { health: 'busy', detail: err.message };
  if (err.kind === 'quota') return { health: 'limited', detail: 'המכסה היומית של המודל נגמרה' };
  if (err.kind === 'rate') return { health: 'limited', detail: 'הגעת למגבלת הבקשות לדקה; נסה שוב בעוד רגע' };
  return { health: 'error', detail: err.message };
}
