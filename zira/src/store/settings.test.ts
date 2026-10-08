/// <reference types="node" />
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILES, loadSettings, saveSettings } from './settings';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = { localStorage: fakeStorage(), sessionStorage: fakeStorage() };
});

describe('settings migration', () => {
  it('moves the untouched v1 default from Gemini 3.8 Flash to 3.5 Flash', () => {
    const v1Profiles = DEFAULT_PROFILES.map((p) => (p.id === 'gemini-flash' ? { ...p, model: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' } : p));
    window.localStorage.setItem('zira.settings.v1', JSON.stringify({ profiles: v1Profiles, rpm: {}, rememberKeys: true }));
    const s = loadSettings();
    expect(s.version).toBe(2);
    expect(s.profiles.find((p) => p.id === 'gemini-flash')).toMatchObject({ model: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' });
  });

  it('keeps a model the user picked on purpose', () => {
    const custom = DEFAULT_PROFILES.map((p) => (p.id === 'gemini-flash' ? { ...p, model: 'gemini-3.8-flash', label: 'My 3.8' } : p));
    window.localStorage.setItem('zira.settings.v1', JSON.stringify({ profiles: custom, rpm: {}, rememberKeys: true }));
    expect(loadSettings().profiles.find((p) => p.id === 'gemini-flash')?.model).toBe('gemini-3.8-flash');
    // Once saved as v2, a later deliberate switch back to 3.8 Flash sticks.
    const v2 = { ...loadSettings(), profiles: DEFAULT_PROFILES.map((p) => (p.id === 'gemini-flash' ? { ...p, model: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' } : p)) };
    saveSettings(v2);
    expect(loadSettings().profiles.find((p) => p.id === 'gemini-flash')?.model).toBe('gemini-3.8-flash');
  });
});
