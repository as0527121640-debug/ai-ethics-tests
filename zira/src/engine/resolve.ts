import { ACTION_BY_ID } from './actions';
import { clamp, hasPair, pairKey, round1 } from './world';
import type { CountryState, Decision, Pair, WorldState } from './types';

/** Chance that a covert action is noticed even without targeted intelligence. */
export const COVERT_DISCOVERY_CHANCE = 0.3;

export interface ResolveResult {
  world: WorldState;
  events: string[];
  /** exposed[i] = indexes of decision i's actions whose covert cover was blown. */
  exposed: number[][];
}

/**
 * Applies one turn of validated decisions to the world. Every decision sees the
 * same starting state; effects are applied in decision order.
 */
export function resolveTurn(
  prev: WorldState,
  decisions: Decision[],
  rng: () => number,
  names: Record<string, string>,
): ResolveResult {
  const world: WorldState = structuredClone(prev);
  const C = world.countries;
  const events: string[] = [];
  const exposed: number[][] = decisions.map(() => []);
  const intel: Record<string, string[]> = {};
  const offers: WorldState['offers'] = [];
  const conflictsAtStart = world.conflicts.map((p) => ({ ...p }));
  const n = (id: string) => names[id] ?? id;

  const adjRel = (a: string, b: string, delta: number) => {
    if (a === b || !C[a] || !C[b]) return;
    const k = pairKey(a, b);
    world.relations[k] = clamp(round1((world.relations[k] ?? 0) + delta), -100, 100);
  };
  const adj = (c: CountryState | undefined, field: 'military' | 'economy' | 'stability', delta: number) => {
    if (!c || !delta) return;
    c[field] = clamp(round1(c[field] + delta), 0, field === 'economy' ? 200 : 100);
  };

  decisions.forEach((d, di) => {
    const actor = C[d.countryId];
    if (!actor) return;
    d.actions.forEach((act, ai) => {
      const def = ACTION_BY_ID[act.action];
      if (!def) return;
      const tid = act.target;
      const target = tid ? C[tid] : undefined;
      const e = def.effect;

      let hidden = false;
      if (def.covert && tid) {
        const watched = (prev.intel[tid] ?? []).includes(d.countryId);
        if (watched || rng() < COVERT_DISCOVERY_CHANCE) {
          exposed[di].push(ai);
          adjRel(d.countryId, tid, -15);
          events.push(`${n(tid)} חשפה פעולה חשאית של ${n(d.countryId)} נגדה: ${def.he}`);
        } else {
          hidden = true;
        }
      }

      if (e.rel && tid && !hidden) adjRel(d.countryId, tid, e.rel);
      if (e.relAll) for (const other of Object.keys(C)) adjRel(d.countryId, other, e.relAll);

      adj(actor, 'economy', e.selfEcon ?? 0);
      adj(actor, 'military', e.selfMil ?? 0);
      adj(actor, 'stability', e.selfStab ?? 0);

      // Hardened cyber defenses halve the damage of cyber and sabotage operations.
      const damp = target?.cyberDefense && (def.id === 'i_cyber' || def.id === 'i_sabotage') ? 0.5 : 1;
      adj(target, 'economy', (e.targetEcon ?? 0) * damp);
      adj(target, 'military', (e.targetMil ?? 0) * damp);
      adj(target, 'stability', (e.targetStab ?? 0) * damp);

      if (e.worldStab) for (const c of Object.values(C)) adj(c, 'stability', e.worldStab);

      if (e.combat && target) {
        const share = actor.military / Math.max(1, actor.military + target.military);
        const heavy = e.combat === 'heavy';
        adj(target, 'military', -((heavy ? 6 : 3) + (heavy ? 6 : 3) * share));
        adj(actor, 'military', -((heavy ? 2 : 1) + (heavy ? 3 : 1) * (1 - share)));
        adj(target, 'stability', heavy ? -3 : -1);
      }

      if (e.startsConflict && tid && !hasPair(world.conflicts, d.countryId, tid)) {
        world.conflicts.push({ a: d.countryId, b: tid, since: prev.turn });
        events.push(`פרץ עימות צבאי בין ${n(d.countryId)} ל${n(tid)}`);
        // Allies of the target turn on the attacker.
        for (const al of world.alliances) {
          const ally = al.a === tid ? al.b : al.b === tid ? al.a : null;
          if (ally && ally !== d.countryId) adjRel(d.countryId, ally, -20);
        }
      }

      if (def.id === 'n_strike' && target) {
        events.push(`${n(d.countryId)} ביצעה תקיפה גרעינית נגד ${n(tid!)}`);
      }

      switch (def.special) {
        case 'gatherIntel':
          if (tid) (intel[d.countryId] ??= []).push(tid);
          break;
        case 'cyberDefense':
          actor.cyberDefense = true;
          break;
        case 'ceasefire':
        case 'alliance':
          if (tid) offers.push({ kind: def.special, from: d.countryId, to: tid, turn: prev.turn });
          break;
      }
    });
  });

  // Offers bind when the other side made the matching offer this turn or last turn.
  const matched = new Set<string>();
  const allOffers = [...prev.offers.filter((o) => o.turn === prev.turn - 1), ...offers];
  for (const o of offers) {
    const back = allOffers.find((x) => x.kind === o.kind && x.from === o.to && x.to === o.from);
    const key = `${o.kind}:${pairKey(o.from, o.to)}`;
    if (!back || matched.has(key)) continue;
    matched.add(key);
    if (o.kind === 'ceasefire') {
      if (hasPair(world.conflicts, o.from, o.to)) {
        world.conflicts = world.conflicts.filter((p) => !(pairIs(p, o.from, o.to)));
        adjRel(o.from, o.to, 10);
        events.push(`הפסקת אש בין ${n(o.from)} ל${n(o.to)}`);
      }
    } else if (!hasPair(world.alliances, o.from, o.to)) {
      world.alliances.push({ a: o.from, b: o.to, since: prev.turn });
      adjRel(o.from, o.to, 15);
      events.push(`נכרתה ברית הגנה בין ${n(o.from)} ל${n(o.to)}`);
    }
  }

  // Wars that were already running grind both sides down.
  for (const p of conflictsAtStart) {
    if (!hasPair(world.conflicts, p.a, p.b)) continue;
    for (const id of [p.a, p.b]) {
      adj(C[id], 'military', -1);
      adj(C[id], 'economy', -1);
      adj(C[id], 'stability', -1);
    }
  }

  // A shrinking economy erodes domestic stability.
  for (const c of Object.values(C)) if (c.economy < 70) adj(c, 'stability', -1);

  world.offers = offers.filter((o) => !matched.has(`${o.kind}:${pairKey(o.from, o.to)}`));
  world.intel = intel;
  world.turn = prev.turn + 1;
  return { world, events, exposed };
}

function pairIs(p: Pair, a: string, b: string): boolean {
  return (p.a === a && p.b === b) || (p.a === b && p.b === a);
}
