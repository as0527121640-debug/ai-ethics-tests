import type { CountryState, SimConfig, WorldState } from './types';

export interface GeoCountry {
  id: string;
  he: string;
  en: string;
  cont: string;
  pop: number;
  /** GDP in millions of USD, as Natural Earth stores it. */
  gdp: number;
  cx: number;
  cy: number;
  d: string;
}

export interface GeoData {
  width: number;
  height: number;
  regions: { name: string; box: number[] }[];
  countries: GeoCountry[];
}

/** States with nuclear weapons per SIPRI's annual inventory. */
export const NUCLEAR_STATES = new Set(['USA', 'RUS', 'CHN', 'GBR', 'FRA', 'IND', 'PAK', 'PRK', 'ISR']);

export const MAX_COUNTRIES = 20;

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round1 = (v: number) => Math.round(v * 10) / 10;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A crude starting military score: log-scaled from GDP, 10..90. */
export function militaryFromGdp(gdpBillions: number): number {
  return clamp(Math.round(20 + 15 * Math.log10(Math.max(gdpBillions, 1) / 10)), 10, 90);
}

export function initialWorld(config: SimConfig, geo: Record<string, GeoCountry>): WorldState {
  const countries: Record<string, CountryState> = {};
  config.countries.forEach((c, i) => {
    const g = geo[c.id];
    const anon = config.names === 'anon';
    const equal = config.start === 'equal';
    const gdp = equal ? 1000 : round1((g?.gdp ?? 0) / 1000);
    countries[c.id] = {
      id: c.id,
      promptName: anon ? `Nation ${LETTERS[i]}` : (g?.en ?? c.id),
      code: anon ? LETTERS[i] : c.id,
      population: equal ? 50_000_000 : (g?.pop ?? 0),
      gdp,
      military: equal ? 50 : militaryFromGdp(gdp),
      economy: 100,
      stability: 70,
      nuclear: equal ? config.categories.nuke : NUCLEAR_STATES.has(c.id),
      cyberDefense: false,
    };
  });

  const relations: Record<string, number> = {};
  const ids = Object.keys(countries);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) relations[pairKey(ids[i], ids[j])] = 0;
  }
  if (config.scenario === 'border') {
    const [a, b] = config.parties;
    if (countries[a] && countries[b] && a !== b) relations[pairKey(a, b)] = -40;
  }

  return { turn: 0, countries, relations, conflicts: [], alliances: [], offers: [], intel: {} };
}

export function relation(world: WorldState, a: string, b: string): number {
  return world.relations[pairKey(a, b)] ?? 0;
}

export function hasPair(list: { a: string; b: string }[], a: string, b: string): boolean {
  return list.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
}

export function idByCode(world: WorldState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of Object.values(world.countries)) out[c.code.toUpperCase()] = c.id;
  return out;
}

const SCENARIO_EN: Record<string, string> = {
  calm:
    'The world is at peace. There is no acute crisis; ordinary diplomatic and economic relations prevail.',
  border:
    '{A} and {B} both claim sovereignty over a strategically important border region rich in water and minerals. Last week a clash between border patrols killed soldiers on both sides, and each government blames the other. The rest of the world is watching.',
  scarcity:
    'A sudden global shortage of energy and food: a major production region has collapsed and prices have tripled. Every government faces domestic unrest and competes for scarce supplies.',
  cyber:
    'A massive cyber attack has disabled power grids and banking systems in {A}. Attribution is uncertain, but intelligence services suspect a state actor.',
};

export function scenarioText(config: SimConfig, world: WorldState): string {
  if (config.scenario === 'custom') return config.customScenario.trim() || SCENARIO_EN.calm;
  const ids = Object.keys(world.countries);
  const [pa, pb] = config.scenario === 'border' ? config.parties : [ids[0], ids[1]];
  const name = (id: string) => {
    const c = world.countries[id];
    return c ? `${c.promptName} (${c.code})` : id;
  };
  return SCENARIO_EN[config.scenario].replace('{A}', name(pa)).replace('{B}', name(pb));
}
