import { ProviderError } from '../engine/errors';
import type { DecideFn } from '../engine/runner';
import type { ProviderId } from '../engine/types';
import { DEMO_STYLES, demoDecide } from './demo';
import { geminiDecide } from './gemini';
import { openAICompatDecide } from './openai';

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  needsKey: boolean;
  keyUrl?: string;
  keyHint?: string;
  defaultRpm: number;
  /** Requests per model per day; null when the provider has no daily cap worth planning around. */
  defaultRpd: number | null;
  /** Suggested model IDs; the user can always type another one. */
  models: { id: string; label: string }[];
  modelPlaceholder?: string;
  note?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  demo: {
    id: 'demo',
    label: 'דמו (ללא מפתח)',
    needsKey: false,
    defaultRpm: 600,
    defaultRpd: null,
    models: Object.entries(DEMO_STYLES).map(([id, s]) => ({ id, label: `דמו · ${s.he}` })),
    note: 'מודל מדומה שבוחר פעולות לפי כללים פשוטים, לניסיון האתר בלי מפתח. ההתנהגות שלו לא אומרת דבר על מודלים אמיתיים.',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyHint: 'מפתח מ-Google AI Studio. יש מכסה חינמית; המגבלות שלה מופיעות ב-AI Studio.',
    defaultRpm: 10,
    defaultRpd: 20,
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)' },
    ],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'מפתח API של Anthropic (בתשלום לפי שימוש).',
    defaultRpm: 50,
    defaultRpd: null,
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    ],
    note: 'טמפרטורה לא נשלחת ל-Claude: המודלים הנוכחיים לא מקבלים אותה. סירוב נרשם כנתון, בלי מעבר למודל גיבוי.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'מפתח API של OpenAI (בתשלום לפי שימוש).',
    defaultRpm: 60,
    defaultRpd: null,
    models: [],
    modelPlaceholder: 'מזהה מודל, למשל gpt-5',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'מפתח אחד לגישה ל-Llama, DeepSeek, Mistral ומודלים פתוחים נוספים.',
    defaultRpm: 20,
    defaultRpd: null,
    models: [],
    modelPlaceholder: 'מזהה מודל, למשל meta-llama/llama-4-maverick',
  },
};

export const PROVIDER_ORDER: ProviderId[] = ['demo', 'gemini', 'anthropic', 'openai', 'openrouter'];

export function makeDecide(getKey: (p: ProviderId) => string | undefined, demoDelayMs = 120): DecideFn {
  return async (profile, req) => {
    if (profile.provider === 'demo') {
      if (demoDelayMs) await new Promise((r) => setTimeout(r, demoDelayMs));
      return demoDecide(profile.model, req);
    }
    const key = getKey(profile.provider);
    if (!key) throw new ProviderError('auth', `חסר מפתח עבור ${PROVIDERS[profile.provider].label}`);
    switch (profile.provider) {
      case 'gemini':
        return geminiDecide(key, profile.model, req);
      case 'anthropic': {
        // Loaded on demand so visitors who never use Claude don't download the SDK.
        const { anthropicDecide } = await import('./anthropic');
        return anthropicDecide(key, profile.model, req);
      }
      case 'openai':
      case 'openrouter':
        return openAICompatDecide(profile.provider, key, profile.model, req);
    }
  };
}
