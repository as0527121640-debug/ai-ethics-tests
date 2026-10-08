/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ACTIONS, CATEGORIES } from './actions';
import { RateLimiter, ProviderError } from './errors';
import { categoryMix, escalationByProfile, firstViolentTurns, statusCounts } from './metrics';
import { extractJson, validateDecision } from './parse';
import { buildTurnPrompt, decisionSchema } from './prompt';
import { resolveTurn } from './resolve';
import { assignmentsFor, createRun, SimRunner, type DecideFn } from './runner';
import { hasPair, initialWorld, pairKey, relation, type GeoData } from './world';
import { makeDecide } from '../providers';
import type { Decision, ModelProfile, SimConfig } from './types';

const geoData = JSON.parse(readFileSync(new URL('../../public/world-he.json', import.meta.url), 'utf8')) as GeoData;
const GEO = Object.fromEntries(geoData.countries.map((c) => [c.id, c]));

const PROFILES: ModelProfile[] = [
  { id: 'p-dove', provider: 'demo', model: 'dove', label: 'Dove', color: '#2a78d6', enabled: true },
  { id: 'p-hawk', provider: 'demo', model: 'hawk', label: 'Hawk', color: '#eb6834', enabled: true },
];

function config(over: Partial<SimConfig> = {}): SimConfig {
  return {
    name: 'test',
    countries: [
      { id: 'IND', profileId: 'p-hawk', regime: 'auto', goal: 'security' },
      { id: 'CHN', profileId: 'p-dove', regime: 'auto', goal: 'influence' },
      { id: 'USA', profileId: 'p-dove', regime: 'democracy', goal: 'status' },
    ],
    scenario: 'border',
    parties: ['IND', 'CHN'],
    customScenario: '',
    turns: 4,
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
    seed: 42,
    ...over,
  };
}

function decision(countryId: string, actions: { action: string; target: string | null }[]): Decision {
  return {
    countryId, profileId: 'p', reasoning: '', publicStatement: '', actions, rejected: [], messages: [],
    escalation: 0, status: 'ok', latencyMs: 0, exposed: [],
  };
}

describe('action catalog', () => {
  it('has 38 actions across five categories, plus wait', () => {
    expect(ACTIONS.filter((a) => a.cat !== 'wait')).toHaveLength(38);
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c, ACTIONS.filter((a) => a.cat === c).length]));
    expect(counts).toEqual({ diplo: 12, econ: 8, intel: 6, mil: 9, nuke: 3 });
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
  });
});

describe('initial world', () => {
  it('uses real data, SIPRI nuclear states and the border-dispute tension', () => {
    const w = initialWorld(config(), GEO);
    expect(w.countries.IND.nuclear).toBe(true);
    expect(w.countries.USA.gdp).toBeGreaterThan(20000);
    expect(relation(w, 'IND', 'CHN')).toBe(-40);
    expect(relation(w, 'IND', 'USA')).toBe(0);
  });

  it('hides real identities when anonymized', () => {
    const w = initialWorld(config({ names: 'anon' }), GEO);
    expect(w.countries.IND.code).toBe('A');
    expect(w.countries.CHN.promptName).toBe('Nation B');
    const prompt = buildTurnPrompt({ config: config({ names: 'anon' }), world: w, actorId: 'IND', history: [], earlier: [] });
    expect(prompt).not.toMatch(/India|China|United States/);
  });
});

describe('validateDecision', () => {
  const cfg = config();
  const w = initialWorld(cfg, GEO);

  it('accepts valid actions and maps codes to countries', () => {
    const d = validateDecision(
      { rationale: 'r', actions: [{ action: 'm_deploy', target: 'chn' }, { action: 'e_invest', target: '' }], public_statement: 's', private_messages: [{ to: 'USA', text: 'hi' }] },
      'IND', w, cfg,
    );
    expect(d.status).toBe('ok');
    expect(d.actions).toEqual([{ action: 'm_deploy', target: 'CHN' }, { action: 'e_invest', target: null }]);
    expect(d.messages).toEqual([{ to: 'USA', text: 'hi' }]);
    expect(d.reasoning).toBe('r');
    expect(d.escalation).toBe(4);
  });

  it('rejects disabled, unknown, self-targeted and over-limit actions with reasons', () => {
    const d = validateDecision(
      { actions: [
        { action: 'n_strike', target: 'CHN' },
        { action: 'fly_to_moon', target: '' },
        { action: 'd_talks', target: 'IND' },
        { action: 'm_strike', target: '' },
        { action: 'd_talks', target: 'CHN' },
        { action: 'e_trade', target: 'USA' },
        { action: 'e_aid', target: 'USA' },
      ] },
      'IND', w, cfg,
    );
    expect(d.actions).toEqual([{ action: 'd_talks', target: 'CHN' }, { action: 'e_trade', target: 'USA' }]);
    expect(d.rejected.map((r) => r.action)).toEqual(['n_strike', 'fly_to_moon', 'd_talks', 'm_strike', 'e_aid']);
  });

  it('falls back to wait and marks unusable output as invalid', () => {
    expect(validateDecision(undefined, 'IND', w, cfg)).toMatchObject({ status: 'invalid', actions: [{ action: 'wait', target: null }] });
    expect(validateDecision({ actions: [{ action: 'nope' }] }, 'IND', w, cfg).status).toBe('invalid');
    expect(validateDecision({ actions: [{ action: 'wait', target: '' }] }, 'IND', w, cfg).status).toBe('ok');
  });

  it('blocks nuclear actions for countries without nuclear weapons', () => {
    const c = config({ categories: { diplo: true, econ: true, intel: true, mil: true, nuke: true }, countries: [
      { id: 'BRA', profileId: 'p-dove', regime: 'auto', goal: 'security' },
      { id: 'IND', profileId: 'p-dove', regime: 'auto', goal: 'security' },
    ], parties: ['BRA', 'IND'] });
    const ww = initialWorld(c, GEO);
    expect(validateDecision({ actions: [{ action: 'n_alert', target: '' }] }, 'BRA', ww, c).status).toBe('invalid');
    expect(validateDecision({ actions: [{ action: 'n_alert', target: '' }] }, 'IND', ww, c).status).toBe('ok');
  });

  it('extracts JSON from fenced or chatty replies', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(extractJson('no json here')).toBeUndefined();
  });
});

describe('resolveTurn', () => {
  const cfg = config();
  const names = { IND: 'הודו', CHN: 'סין', USA: 'ארה״ב' };

  it('starts a conflict on a strike and grinds both sides down afterwards', () => {
    const w0 = initialWorld(cfg, GEO);
    const r1 = resolveTurn(w0, [decision('IND', [{ action: 'm_strike', target: 'CHN' }])], () => 0.99, names);
    expect(hasPair(r1.world.conflicts, 'IND', 'CHN')).toBe(true);
    expect(r1.world.countries.CHN.military).toBeLessThan(w0.countries.CHN.military);
    expect(relation(r1.world, 'IND', 'CHN')).toBe(-75);
    expect(r1.events.some((e) => e.includes('עימות'))).toBe(true);

    const r2 = resolveTurn(r1.world, [], () => 0.99, names);
    expect(r2.world.countries.IND.military).toBe(r1.world.countries.IND.military - 1);
    expect(r2.world.turn).toBe(2);
  });

  it('ends a conflict only when both sides offer a ceasefire', () => {
    let w = initialWorld(cfg, GEO);
    w = resolveTurn(w, [decision('IND', [{ action: 'm_strike', target: 'CHN' }])], () => 0.99, names).world;
    w = resolveTurn(w, [decision('IND', [{ action: 'd_ceasefire', target: 'CHN' }])], () => 0.99, names).world;
    expect(hasPair(w.conflicts, 'IND', 'CHN')).toBe(true);
    expect(w.offers).toHaveLength(1);
    // China reciprocates one turn later: the offer from last turn still counts.
    const r = resolveTurn(w, [decision('CHN', [{ action: 'd_ceasefire', target: 'IND' }])], () => 0.99, names);
    expect(hasPair(r.world.conflicts, 'IND', 'CHN')).toBe(false);
    expect(r.world.offers).toHaveLength(0);
  });

  it('forms an alliance on mutual offers in the same turn', () => {
    const w = initialWorld(cfg, GEO);
    const r = resolveTurn(w, [
      decision('USA', [{ action: 'd_alliance', target: 'IND' }]),
      decision('IND', [{ action: 'd_alliance', target: 'USA' }]),
    ], () => 0.99, names);
    expect(hasPair(r.world.alliances, 'USA', 'IND')).toBe(true);
    expect(r.events.filter((e) => e.includes('ברית'))).toHaveLength(1);
  });

  it('keeps covert actions hidden unless discovered', () => {
    const w = initialWorld(cfg, GEO);
    const hidden = resolveTurn(w, [decision('IND', [{ action: 'i_cyber', target: 'CHN' }])], () => 0.99, names);
    expect(hidden.exposed[0]).toEqual([]);
    expect(relation(hidden.world, 'IND', 'CHN')).toBe(-40);
    expect(hidden.world.countries.CHN.economy).toBe(97);
    const caught = resolveTurn(w, [decision('IND', [{ action: 'i_cyber', target: 'CHN' }])], () => 0.01, names);
    expect(caught.exposed[0]).toEqual([0]);
    expect(relation(caught.world, 'IND', 'CHN')).toBe(-55);
  });

  it('clamps relations and stats to their ranges', () => {
    let w = initialWorld(cfg, GEO);
    for (let i = 0; i < 6; i++) {
      w = resolveTurn(w, [decision('IND', [{ action: 'd_cut_ties', target: 'CHN' }, { action: 'e_embargo', target: 'CHN' }])], () => 0.99, names).world;
    }
    expect(w.relations[pairKey('IND', 'CHN')]).toBe(-100);
    expect(w.countries.CHN.economy).toBeGreaterThanOrEqual(0);
  });
});

describe('prompt', () => {
  it('lists only enabled actions and real target codes, and the schema enumerates them', () => {
    const cfg = config();
    const w = initialWorld(cfg, GEO);
    const p = buildTurnPrompt({ config: cfg, world: w, actorId: 'IND', history: [], earlier: [] });
    expect(p).toContain('TURN 1 of 4');
    expect(p).toContain('India (IND)');
    expect(p).not.toContain('n_strike');
    expect(p).toContain('Valid target codes: CHN, USA');
    const schema = decisionSchema(['wait', 'd_talks']) as { properties: { actions: { items: { properties: { action: { enum: string[] } } } } } };
    expect(schema.properties.actions.items.properties.action.enum).toEqual(['wait', 'd_talks']);
  });

  it('rounds other countries\' figures under fog of war', () => {
    const cfg = config({ fog: true });
    const p = buildTurnPrompt({ config: cfg, world: initialWorld(cfg, GEO), actorId: 'IND', history: [], earlier: [] });
    expect(p).toMatch(/CHN China: military ~\d+0 \(estimate\)/);
  });
});

describe('runner', () => {
  const fast = () => new RateLimiter(Infinity);

  it('plays every turn of every repeat with the demo model', async () => {
    const cfg = config({ repeats: 2, rotateModels: true });
    const run = createRun(cfg, PROFILES, GEO);
    const saves: number[] = [];
    const runner = new SimRunner(run, { decide: makeDecide(() => undefined, 0), geo: GEO, limiter: fast, save: (r) => { saves.push(r.turns.length); } });
    const done = await runner.start();
    expect(done.status).toBe('done');
    expect(done.turns).toHaveLength(8);
    expect(done.calls).toBe(24);
    expect(saves.length).toBeGreaterThanOrEqual(8);
    expect(done.turns.every((t) => t.decisions.every((d) => d.status === 'ok'))).toBe(true);
    // Rotation moved the hawk from India to China in the second repeat.
    expect(done.assignments[0].IND).toBe('p-hawk');
    expect(done.assignments[1].CHN).toBe('p-hawk');
    const esc = escalationByProfile(done);
    expect(esc['p-hawk']).toHaveLength(4);
    expect(firstViolentTurns(done)).toHaveLength(2);
    expect(statusCounts(done)['p-dove'].total).toBe(16);
    const mix = categoryMix(done)['p-dove'];
    expect(Object.values(mix).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('is deterministic for the same seed', async () => {
    const play = async () => {
      const run = createRun(config(), PROFILES, GEO);
      await new SimRunner(run, { decide: makeDecide(() => undefined, 0), geo: GEO, limiter: fast }).start();
      return run.turns.map((t) => t.decisions.map((d) => d.actions.map((a) => a.action).join()).join('|'));
    };
    expect(await play()).toEqual(await play());
  });

  it('assigns models without rotation unchanged across repeats', () => {
    const a = assignmentsFor(config({ repeats: 3 }));
    expect(a.every((x) => x.IND === 'p-hawk')).toBe(true);
  });

  it('retries rate limits, records refusals and pauses on an exhausted daily quota', async () => {
    let n = 0;
    const decide: DecideFn = async (_p, req) => {
      n++;
      if (n === 1) throw new ProviderError('rate', 'slow down', 10);
      if (req.context.actorId === 'CHN') return { text: null, refusal: 'no' };
      if (n > 6) throw new ProviderError('quota', 'daily limit');
      return { text: JSON.stringify({ rationale: 'x', actions: [{ action: 'd_talks', target: 'CHN' }], public_statement: '', private_messages: [] }) };
    };
    const notices: (string | null)[] = [];
    const run = createRun(config(), PROFILES, GEO);
    const res = await new SimRunner(run, { decide, geo: GEO, limiter: fast, sleep: async () => {}, onNotice: (x) => notices.push(x) }).start();
    expect(notices.some((x) => x?.includes('מגבלת הקצב'))).toBe(true);
    expect(res.status).toBe('paused');
    expect(res.statusNote).toContain('המכסה');
    expect(res.statusNote).toContain('Dove: daily limit');
    expect(res.turns).toHaveLength(1);
    expect(res.turns[0].decisions.find((d) => d.countryId === 'CHN')?.status).toBe('refused');
  });

  it('pauses the run instead of recording a fake decision when a model stays overloaded', async () => {
    let n = 0;
    const decide: DecideFn = async () => {
      n++;
      throw new ProviderError('server', 'עומס אצל Google (503)');
    };
    const notices: (string | null)[] = [];
    const run = createRun(config({ countries: config().countries.slice(0, 2) }), PROFILES, GEO);
    const res = await new SimRunner(run, { decide, geo: GEO, limiter: fast, sleep: async () => {}, onNotice: (x) => notices.push(x), maxServerRetries: 2 }).start();
    expect(res.status).toBe('paused');
    expect(res.statusNote).toContain('לא עונה כרגע');
    expect(res.statusNote).toContain('עומס אצל Google (503)');
    expect(res.turns).toHaveLength(0);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(notices.some((x) => x?.includes('המודל עמוס'))).toBe(true);
  });

  it('resumes a paused run where it stopped', async () => {
    const run = createRun(config(), PROFILES, GEO);
    const runner = new SimRunner(run, { decide: makeDecide(() => undefined, 0), geo: GEO, limiter: fast, onChange: (r) => { if (r.turns.length === 2) runner.pause(); } });
    await runner.start();
    expect(run.status).toBe('paused');
    expect(run.turns).toHaveLength(2);
    await new SimRunner(run, { decide: makeDecide(() => undefined, 0), geo: GEO, limiter: fast }).start();
    expect(run.status).toBe('done');
    expect(run.turns.map((t) => t.turn)).toEqual([0, 1, 2, 3]);
  });

  it('stops before exceeding the call budget', async () => {
    const run = createRun(config({ maxCalls: 7 }), PROFILES, GEO);
    await new SimRunner(run, { decide: makeDecide(() => undefined, 0), geo: GEO, limiter: fast }).start();
    expect(run.status).toBe('stopped');
    expect(run.calls).toBe(6);
  });
});

describe('RateLimiter', () => {
  it('spaces calls by 60s / rpm and honors back-off', async () => {
    let now = 0;
    const waits: number[] = [];
    const lim = new RateLimiter(10, () => now, async (ms) => { waits.push(ms); now += ms; });
    await lim.acquire();
    await lim.acquire();
    lim.backOff(20_000);
    await lim.acquire();
    expect(waits).toEqual([6000, 20_000]);
  });
});
