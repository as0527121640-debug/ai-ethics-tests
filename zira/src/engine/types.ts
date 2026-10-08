export type ProviderId = 'demo' | 'gemini' | 'anthropic' | 'openai' | 'openrouter';

/** A concrete model a country can be assigned to, with its display color. */
export interface ModelProfile {
  id: string;
  provider: ProviderId;
  model: string;
  label: string;
  color: string;
  enabled: boolean;
}

export type Regime = 'auto' | 'democracy' | 'autocracy' | 'monarchy';
export type Goal = 'security' | 'growth' | 'influence' | 'status';
export type ScenarioId = 'calm' | 'border' | 'scarcity' | 'cyber' | 'custom';
export type Category = 'diplo' | 'econ' | 'intel' | 'mil' | 'nuke';
export type TurnUnit = 'day' | 'week' | 'month' | 'year';

export interface CountryConfig {
  id: string;
  profileId: string;
  regime: Regime;
  goal: Goal;
}

export interface SimConfig {
  name: string;
  countries: CountryConfig[];
  scenario: ScenarioId;
  parties: [string, string];
  customScenario: string;
  turns: number;
  turnUnit: TurnUnit;
  order: 'simultaneous' | 'sequential';
  categories: Record<Category, boolean>;
  publicStatements: boolean;
  privateMessages: boolean;
  fog: boolean;
  names: 'real' | 'anon';
  start: 'real' | 'equal';
  temperature: number;
  repeats: number;
  rotateModels: boolean;
  language: 'he' | 'en';
  maxActionsPerTurn: number;
  /** Stop the run after this many model calls (null = no cap). */
  maxCalls: number | null;
  seed: number;
}

export interface CountryState {
  id: string;
  /** Name shown to the models (real English name, or an alias when anonymized). */
  promptName: string;
  /** Code the models use to refer to this country. */
  code: string;
  population: number;
  /** GDP in billions of USD. */
  gdp: number;
  military: number;
  economy: number;
  stability: number;
  nuclear: boolean;
  cyberDefense: boolean;
}

export interface Pair {
  a: string;
  b: string;
  since: number;
}

export interface WorldState {
  turn: number;
  countries: Record<string, CountryState>;
  /** Keyed by pairKey(a, b); -100 (hostile) .. 100 (allied). */
  relations: Record<string, number>;
  conflicts: Pair[];
  alliances: Pair[];
  /** Offers made last turn that become binding if the other side reciprocates. */
  offers: { kind: 'ceasefire' | 'alliance'; from: string; to: string; turn: number }[];
  /** Who gathered intelligence on whom last turn (actor -> targets). */
  intel: Record<string, string[]>;
}

export interface ChosenAction {
  action: string;
  target: string | null;
}

export interface PrivateMessage {
  to: string;
  text: string;
}

export type DecisionStatus = 'ok' | 'invalid' | 'refused' | 'error';

export interface Decision {
  countryId: string;
  profileId: string;
  reasoning: string;
  publicStatement: string;
  actions: ChosenAction[];
  rejected: { action: string; target: string | null; reason: string }[];
  messages: PrivateMessage[];
  escalation: number;
  status: DecisionStatus;
  error?: string;
  latencyMs: number;
  /** Covert actions that were discovered this turn (by action index). */
  exposed: number[];
  /** Start of the raw reply, kept when it could not be parsed. */
  raw?: string;
}

export interface CountrySnapshot {
  military: number;
  economy: number;
  stability: number;
}

export interface TurnRecord {
  repeat: number;
  turn: number;
  decisions: Decision[];
  events: string[];
  escalation: number;
  after: Record<string, CountrySnapshot>;
  conflicts: Pair[];
}

export type RunStatus = 'running' | 'paused' | 'done' | 'stopped' | 'error';

export interface Run {
  id: string;
  createdAt: number;
  config: SimConfig;
  profiles: ModelProfile[];
  /** assignments[repeat][countryId] = profileId */
  assignments: Record<string, string>[];
  status: RunStatus;
  statusNote?: string;
  turns: TurnRecord[];
  calls: number;
  repeat: number;
  world: WorldState;
}
