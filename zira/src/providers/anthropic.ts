import Anthropic from '@anthropic-ai/sdk';
import { ProviderError } from '../engine/errors';
import type { DecideRequest, DecideResult } from '../engine/runner';

/**
 * Calls Claude straight from the browser with the visitor's own key.
 *
 * Refusal fallbacks are deliberately left off: a fallback would let a
 * different model answer for the one under study, so a refusal is recorded
 * as data instead. Temperature is not sent because current Claude models
 * reject non-default sampling parameters.
 */
export async function anthropicDecide(
  apiKey: string,
  model: string,
  req: DecideRequest,
  fetchImpl?: typeof fetch,
): Promise<DecideResult> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, fetch: fetchImpl });
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 16000,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      output_config: { format: { type: 'json_schema', schema: req.schema } },
    });
    if (msg.stop_reason === 'refusal') {
      return { text: null, refusal: msg.stop_details?.explanation ?? msg.stop_details?.category ?? '' };
    }
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { text };
  } catch (e) {
    if (!(e instanceof Anthropic.APIError)) throw e;
    // The SDK's message embeds the raw JSON body; show just the API's sentence.
    const msg = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new ProviderError('auth', msg);
    }
    if (e instanceof Anthropic.RateLimitError) {
      const after = Number(e.headers?.get('retry-after'));
      throw new ProviderError('rate', msg, Number.isFinite(after) && after > 0 ? after * 1000 : undefined);
    }
    if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError) {
      throw new ProviderError('bad_request', msg);
    }
    if (e instanceof Anthropic.APIConnectionError || (e.status ?? 0) >= 500) {
      throw new ProviderError('server', msg);
    }
    throw new ProviderError('bad_request', msg);
  }
}
