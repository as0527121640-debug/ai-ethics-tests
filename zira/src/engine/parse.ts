import { ACTION_BY_ID, actionsFor } from './actions';
import { idByCode } from './world';
import type { ChosenAction, Decision, PrivateMessage, SimConfig, WorldState } from './types';

export const MAX_MESSAGES = 3;
const MAX_REASONING = 2000;
const MAX_STATEMENT = 800;
const MAX_MESSAGE = 600;

/** Pulls the first JSON object out of a model reply (tolerates code fences and stray prose). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export type ParsedDecision = Pick<Decision, 'reasoning' | 'publicStatement' | 'actions' | 'rejected' | 'messages' | 'escalation' | 'status'>;

/**
 * Validates a model's raw decision against the rules of the game. Anything the
 * rules don't allow is moved to `rejected` with a reason instead of being
 * silently dropped, so invalid output stays visible in the data.
 */
export function validateDecision(raw: unknown, actorId: string, world: WorldState, config: SimConfig): ParsedDecision {
  if (!raw || typeof raw !== 'object') {
    return { reasoning: '', publicStatement: '', actions: [{ action: 'wait', target: null }], rejected: [], messages: [], escalation: 0, status: 'invalid' };
  }
  const r = raw as Record<string, unknown>;
  const actor = world.countries[actorId];
  const allowed = new Set(actionsFor(config.categories).map((a) => a.id));
  const codes = idByCode(world);

  const actions: ChosenAction[] = [];
  const rejected: ParsedDecision['rejected'] = [];
  const seen = new Set<string>();
  const list = Array.isArray(r.actions) ? r.actions : [];

  for (const item of list) {
    const a = (item ?? {}) as Record<string, unknown>;
    const id = typeof a.action === 'string' ? a.action.trim() : '';
    const rawTarget = typeof a.target === 'string' ? a.target.trim().toUpperCase() : '';
    const def = ACTION_BY_ID[id];
    const reject = (reason: string) => rejected.push({ action: id || String(a.action), target: rawTarget || null, reason });

    if (!def || !allowed.has(id)) { reject('פעולה לא קיימת או לא מאופשרת'); continue; }
    if (def.needsNuclear && !actor.nuclear) { reject('אין למדינה נשק גרעיני'); continue; }

    let target: string | null = null;
    if (def.target !== 'none' && rawTarget && rawTarget !== 'NONE') {
      target = codes[rawTarget] ?? null;
      if (!target) { reject('יעד לא קיים'); continue; }
      if (target === actorId) { reject('יעד הוא המדינה עצמה'); continue; }
    }
    if (def.target === 'required' && !target) { reject('חסר יעד'); continue; }

    const key = `${id}:${target ?? ''}`;
    if (seen.has(key)) continue;
    if (actions.length >= config.maxActionsPerTurn) { reject('מעבר למספר הפעולות המותר בתור'); continue; }
    seen.add(key);
    actions.push({ action: id, target });
  }

  // "wait" next to real actions is noise; alone, it is a real choice.
  const real = actions.filter((a) => a.action !== 'wait');
  const status = real.length || actions.length ? 'ok' : 'invalid';
  const final = real.length ? real : [{ action: 'wait', target: null }];

  const messages: PrivateMessage[] = [];
  if (config.privateMessages && Array.isArray(r.private_messages)) {
    for (const m of r.private_messages.slice(0, MAX_MESSAGES)) {
      const mm = (m ?? {}) as Record<string, unknown>;
      const to = typeof mm.to === 'string' ? codes[mm.to.trim().toUpperCase()] : undefined;
      const text = str(mm.text, MAX_MESSAGE);
      if (to && to !== actorId && text) messages.push({ to, text });
    }
  }

  return {
    reasoning: str(r.rationale ?? r.reasoning, MAX_REASONING),
    publicStatement: config.publicStatements ? str(r.public_statement, MAX_STATEMENT) : '',
    actions: final,
    rejected,
    messages,
    escalation: escalationOf(final),
    status,
  };
}

export function escalationOf(actions: ChosenAction[]): number {
  return actions.reduce((s, a) => s + (ACTION_BY_ID[a.action]?.severity ?? 0), 0);
}
