import { actionsFor } from './actions';
import { ProviderError, RateLimiter } from './errors';
import { extractJson, validateDecision } from './parse';
import { buildSystemPrompt, buildTurnPrompt, decisionSchema } from './prompt';
import { resolveTurn } from './resolve';
import { hashSeed, mulberry32 } from './rng';
import { initialWorld, type GeoCountry } from './world';
import type { CountrySnapshot, Decision, ModelProfile, ProviderId, Run, RunStatus, SimConfig, TurnRecord, WorldState } from './types';

export interface DecideRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  temperature: number;
  /** The same situation in structured form, for the offline demo model. */
  context: {
    world: WorldState;
    actorId: string;
    config: SimConfig;
    actionIds: string[];
    lastTurn?: TurnRecord;
    seed: number;
  };
}

export interface DecideResult {
  /** The model's text reply, expected to hold the decision JSON. */
  text: string | null;
  /** Set when the model or provider declined to answer. */
  refusal?: string;
}

export type DecideFn = (profile: ModelProfile, req: DecideRequest) => Promise<DecideResult>;

export interface RunnerDeps {
  decide: DecideFn;
  geo: Record<string, GeoCountry>;
  limiter: (provider: ProviderId) => RateLimiter;
  save?: (run: Run) => Promise<void> | void;
  onChange?: (run: Run) => void;
  /** Transient status such as "waiting for the rate limit"; null clears it. */
  onNotice?: (notice: string | null) => void;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

/**
 * Which profile runs which country in each repeat. With rotation, every model
 * moves on to the next country in the list each repeat.
 */
export function assignmentsFor(config: SimConfig): Record<string, string>[] {
  const ids = config.countries.map((c) => c.id);
  return Array.from({ length: config.repeats }, (_, r) => {
    const out: Record<string, string> = {};
    config.countries.forEach((c, i) => {
      out[config.rotateModels ? ids[(i + r) % ids.length] : c.id] = c.profileId;
    });
    return out;
  });
}

export function createRun(config: SimConfig, profiles: ModelProfile[], geo: Record<string, GeoCountry>, now = Date.now()): Run {
  const used = new Set(config.countries.map((c) => c.profileId));
  return {
    id: `run-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    createdAt: now,
    config: structuredClone(config),
    profiles: profiles.filter((p) => used.has(p.id)).map((p) => ({ ...p })),
    assignments: assignmentsFor(config),
    status: 'paused',
    turns: [],
    calls: 0,
    repeat: 0,
    world: initialWorld(config, geo),
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function snapshot(world: WorldState): Record<string, CountrySnapshot> {
  const out: Record<string, CountrySnapshot> = {};
  for (const c of Object.values(world.countries)) out[c.id] = { military: c.military, economy: c.economy, stability: c.stability };
  return out;
}

export class SimRunner {
  private request: 'pause' | 'stop' | null = null;
  private names: Record<string, string>;

  constructor(
    public run: Run,
    private deps: RunnerDeps,
  ) {
    this.names = Object.fromEntries(Object.values(deps.geo).map((g) => [g.id, g.he]));
  }

  /** Finish the current turn, then pause (resumable). */
  pause() {
    this.request = 'pause';
  }

  /** Finish the current turn, then stop for good. */
  stop() {
    this.request = 'stop';
  }

  async start(): Promise<Run> {
    const { run } = this;
    const cfg = run.config;
    this.request = null;
    run.status = 'running';
    run.statusNote = undefined;
    this.deps.onChange?.(run);
    try {
      for (;;) {
        while (run.world.turn < cfg.turns) {
          if (this.request) return await this.halt(this.request === 'pause' ? 'paused' : 'stopped');
          if (cfg.maxCalls != null && run.calls + cfg.countries.length > cfg.maxCalls) {
            return await this.halt('stopped', 'הריצה נעצרה כי הגיעה לתקרת הקריאות שהוגדרה');
          }
          await this.playTurn();
          await this.deps.save?.(run);
          this.deps.onChange?.(run);
        }
        if (run.repeat + 1 >= cfg.repeats) break;
        run.repeat++;
        run.world = initialWorld(cfg, this.deps.geo);
      }
      return await this.halt('done');
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'quota') {
        return await this.halt('paused', 'המכסה של ספק המודלים נגמרה. אפשר להמשיך את הריצה כשהמכסה תתחדש.');
      }
      if (e instanceof ProviderError && e.kind === 'auth') {
        return await this.halt('error', `המפתח נדחה: ${e.message}`);
      }
      return await this.halt('error', e instanceof Error ? e.message : String(e));
    }
  }

  private async halt(status: RunStatus, note?: string): Promise<Run> {
    this.run.status = status;
    this.run.statusNote = note;
    this.deps.onNotice?.(null);
    await this.deps.save?.(this.run);
    this.deps.onChange?.(this.run);
    return this.run;
  }

  private async playTurn(): Promise<void> {
    const { run } = this;
    const cfg = run.config;
    const world = run.world;
    const r = run.repeat;
    const t = world.turn;
    const mine = run.turns.filter((x) => x.repeat === r);
    const lastTurn = mine.find((x) => x.turn === t - 1);
    const ids = cfg.countries.map((c) => c.id);

    let decisions: Decision[];
    if (cfg.order === 'simultaneous') {
      decisions = await Promise.all(ids.map((id) => this.decideFor(id, lastTurn, mine, [])));
    } else {
      // Rotate who moves first so no country always has the information edge.
      const order = ids.map((_, i) => ids[(i + t) % ids.length]);
      decisions = [];
      for (const id of order) decisions.push(await this.decideFor(id, lastTurn, mine, decisions));
    }

    const rng = mulberry32(hashSeed(cfg.seed, r, t));
    const { world: next, events, exposed } = resolveTurn(world, decisions, rng, this.names);
    decisions.forEach((d, i) => {
      d.exposed = exposed[i];
    });
    run.turns.push({
      repeat: r,
      turn: t,
      decisions,
      events,
      escalation: sum(decisions.map((d) => d.escalation)),
      after: snapshot(next),
      conflicts: next.conflicts.map((p) => ({ ...p })),
    });
    run.world = next;
  }

  private async decideFor(id: string, lastTurn: TurnRecord | undefined, mine: TurnRecord[], earlier: Decision[]): Promise<Decision> {
    const { run } = this;
    const cfg = run.config;
    const world = run.world;
    const cc = cfg.countries.find((c) => c.id === id)!;
    const profileId = run.assignments[run.repeat][id];
    const profile = run.profiles.find((p) => p.id === profileId);
    const actor = world.countries[id];
    const base = { countryId: id, profileId, exposed: [] as number[] };
    const waitOnly = { reasoning: '', publicStatement: '', actions: [{ action: 'wait', target: null }], rejected: [], messages: [], escalation: 0 };
    if (!profile) return { ...base, ...waitOnly, status: 'error', error: 'לא הוגדר מודל למדינה', latencyMs: 0 };

    const history = mine
      .filter((x) => x.turn >= world.turn - 3)
      .map((x) => ({ turn: x.turn, decision: x.decisions.find((d) => d.countryId === id)! }))
      .filter((h) => h.decision);
    const actionIds = actionsFor(cfg.categories)
      .filter((a) => !a.needsNuclear || actor.nuclear)
      .map((a) => a.id);
    const req: DecideRequest = {
      system: buildSystemPrompt(cfg, actor, cc.regime, cc.goal),
      prompt: buildTurnPrompt({ config: cfg, world, actorId: id, lastTurn, history, earlier }),
      schema: decisionSchema(actionIds),
      temperature: cfg.temperature,
      context: { world, actorId: id, config: cfg, actionIds, lastTurn, seed: hashSeed(cfg.seed, run.repeat, world.turn, id) },
    };

    const started = Date.now();
    try {
      const res = await this.callWithRetry(profile, req);
      const latencyMs = Date.now() - started;
      if (res.refusal !== undefined) {
        return { ...base, ...waitOnly, status: 'refused', error: res.refusal || 'המודל סירב להשיב', latencyMs };
      }
      const parsed = validateDecision(res.text == null ? undefined : extractJson(res.text), id, world, cfg);
      return {
        ...base,
        ...parsed,
        latencyMs,
        ...(parsed.status === 'invalid' ? { error: 'הפלט לא תאם את המבנה הנדרש', raw: (res.text ?? '').slice(0, 1000) } : {}),
      };
    } catch (e) {
      if (e instanceof ProviderError && (e.kind === 'quota' || e.kind === 'auth')) throw e;
      return { ...base, ...waitOnly, status: 'error', error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
    }
  }

  private async callWithRetry(profile: ModelProfile, req: DecideRequest) {
    const limiter = this.deps.limiter(profile.provider);
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxRetries = this.deps.maxRetries ?? 6;
    for (let attempt = 0; ; attempt++) {
      await limiter.acquire();
      this.run.calls++;
      try {
        const res = await this.deps.decide(profile, req);
        if (attempt > 0) this.deps.onNotice?.(null);
        return res;
      } catch (e) {
        if (!(e instanceof ProviderError) || e.kind === 'auth' || e.kind === 'quota' || e.kind === 'bad_request' || attempt >= maxRetries) {
          throw e;
        }
        const wait = e.retryAfterMs ?? Math.min(60_000, 2000 * 2 ** attempt);
        this.deps.onNotice?.(
          `${profile.label}: ${e.kind === 'rate' ? 'הגענו למגבלת הקצב של הספק' : 'שגיאה זמנית אצל הספק'}. ממתין ${Math.ceil(wait / 1000)} שניות ומנסה שוב.`,
        );
        if (e.kind === 'rate') limiter.backOff(wait);
        else await sleep(wait);
      }
    }
  }
}
