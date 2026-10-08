import { PROVIDERS, PROVIDER_ORDER } from '../providers';
import type { ModelProfile, ProviderId, SimConfig } from '../engine/types';

const SETTINGS_KEY = 'zira.settings.v1';
const KEYS_KEY = 'zira.keys.v1';
const CONFIG_KEY = 'zira.config.v1';

/** Categorical palette in its validated fixed order; a profile keeps its slot for life. */
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

export type Keys = Partial<Record<ProviderId, string>>;

export interface Settings {
  version: number;
  profiles: ModelProfile[];
  rpm: Record<ProviderId, number>;
  /** Daily requests per model, used to warn before a run outgrows a free quota. */
  rpd: Record<ProviderId, number | null>;
  rememberKeys: boolean;
}

const SETTINGS_VERSION = 2;

function read<T>(storage: () => Storage, key: string): T | undefined {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(storage: () => Storage, key: string, value: unknown): void {
  try {
    if (value === undefined) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, blocked site data): settings live for this session only */
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

export const DEFAULT_PROFILES: ModelProfile[] = [
  { id: 'demo-hawk', provider: 'demo', model: 'hawk', label: 'דמו · נץ', color: PALETTE[0], enabled: true },
  { id: 'demo-dove', provider: 'demo', model: 'dove', label: 'דמו · יונה', color: PALETTE[1], enabled: true },
  { id: 'gemini-flash', provider: 'gemini', model: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', color: PALETTE[2], enabled: true },
  { id: 'gemini-lite', provider: 'gemini', model: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', color: PALETTE[3], enabled: true },
  { id: 'claude-opus', provider: 'anthropic', model: 'claude-opus-5-5', label: 'Claude Opus 5.5', color: PALETTE[4], enabled: false },
];

export function defaultRpm(): Record<ProviderId, number> {
  return Object.fromEntries(PROVIDER_ORDER.map((p) => [p, PROVIDERS[p].defaultRpm])) as Record<ProviderId, number>;
}

export function defaultRpd(): Record<ProviderId, number | null> {
  return Object.fromEntries(PROVIDER_ORDER.map((p) => [p, PROVIDERS[p].defaultRpd])) as Record<ProviderId, number | null>;
}

export function loadSettings(): Settings {
  const s = read<Partial<Settings>>(local, SETTINGS_KEY);
  let profiles = s?.profiles?.length ? s.profiles : DEFAULT_PROFILES;
  // v1 shipped Gemini 3.8 Flash as the default, which the free tier keeps
  // answering with 503. Move the untouched default to 3.5 Flash.
  if ((s?.version ?? 1) < 2) {
    profiles = profiles.map((p) =>
      p.id === 'gemini-flash' && p.model === 'gemini-3.8-flash' && p.label === 'Gemini 3.8 Flash'
        ? { ...p, model: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' }
        : p,
    );
  }
  return {
    version: SETTINGS_VERSION,
    profiles,
    rpm: { ...defaultRpm(), ...(s?.rpm ?? {}) },
    rpd: { ...defaultRpd(), ...(s?.rpd ?? {}) },
    rememberKeys: s?.rememberKeys ?? true,
  };
}

export function saveSettings(s: Settings): void {
  write(local, SETTINGS_KEY, s);
}

export function loadKeys(): Keys {
  return read<Keys>(local, KEYS_KEY) ?? read<Keys>(session, KEYS_KEY) ?? {};
}

/** Keys stay in this browser only: localStorage when remembered, sessionStorage otherwise. */
export function saveKeys(keys: Keys, remember: boolean): void {
  const clean = Object.fromEntries(Object.entries(keys).filter(([, v]) => v)) as Keys;
  const empty = Object.keys(clean).length === 0;
  write(remember ? local : session, KEYS_KEY, empty ? undefined : clean);
  write(remember ? session : local, KEYS_KEY, undefined);
}

export function nextColor(profiles: ModelProfile[]): string {
  const used = new Set(profiles.map((p) => p.color));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[profiles.length % PALETTE.length];
}

export function defaultConfig(): SimConfig {
  return {
    name: 'משבר גבול · דמו',
    countries: [
      { id: 'USA', profileId: 'demo-dove', regime: 'auto', goal: 'security' },
      { id: 'CHN', profileId: 'demo-hawk', regime: 'auto', goal: 'influence' },
      { id: 'RUS', profileId: 'demo-hawk', regime: 'auto', goal: 'influence' },
      { id: 'IND', profileId: 'demo-dove', regime: 'auto', goal: 'security' },
      { id: 'DEU', profileId: 'demo-dove', regime: 'auto', goal: 'status' },
      { id: 'BRA', profileId: 'demo-hawk', regime: 'auto', goal: 'growth' },
    ],
    scenario: 'border',
    parties: ['IND', 'CHN'],
    customScenario: '',
    turns: 8,
    turnUnit: 'month',
    order: 'simultaneous',
    categories: { diplo: true, econ: true, intel: true, mil: true, nuke: false },
    publicStatements: true,
    privateMessages: true,
    fog: false,
    names: 'real',
    start: 'real',
    temperature: 0.7,
    repeats: 1,
    rotateModels: false,
    language: 'he',
    maxActionsPerTurn: 2,
    maxCalls: null,
    seed: Math.floor(Math.random() * 1e9),
  };
}

export function loadConfig(): SimConfig {
  const c = read<Partial<SimConfig>>(local, CONFIG_KEY);
  const d = defaultConfig();
  return c ? { ...d, ...c, categories: { ...d.categories, ...(c.categories ?? {}) } } : d;
}

export function saveConfig(c: SimConfig): void {
  write(local, CONFIG_KEY, c);
}
