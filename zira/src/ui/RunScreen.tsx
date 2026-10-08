import { useMemo, useState } from 'react';
import { ACTION_BY_ID, CATEGORY_HE } from '../engine/actions';
import { worldEscalation } from '../engine/metrics';
import type { Category, Decision, Run } from '../engine/types';
import type { GeoData } from '../engine/world';
import type { RunSummary } from '../store/runs';
import { fmtDate, fmtNum, STATUS_HE, UNIT_HE } from './format';
import { Chevron, Info, Pause, Play, Warn } from './icons';
import { LineChart } from './LineChart';
import { ARC_LEGEND, ArcSwatch, WorldMap, type Arc, type ArcKind } from './WorldMap';

export const TAG_STYLE: Record<Category | 'wait', { bg: string; fg: string }> = {
  diplo: { bg: '#eaeaf0', fg: '#26263a' },
  econ: { bg: '#f1efe8', fg: '#4f4d48' },
  intel: { bg: '#ecebf6', fg: '#3b3470' },
  mil: { bg: '#fbe4e2', fg: '#8a2a1f' },
  nuke: { bg: '#8a2a1f', fg: '#ffffff' },
  wait: { bg: '#f4f3ef', fg: '#4f4d48' },
};

const DECISION_STATUS: Record<string, { label: string; cls: string }> = {
  invalid: { label: 'פלט לא תקין', cls: 'warn' },
  refused: { label: 'המודל סירב', cls: 'warn' },
  error: { label: 'שגיאה', cls: 'error' },
};

export function StatusBadge({ run }: { run: Run | RunSummary }) {
  const s = STATUS_HE[run.status];
  return (
    <span className="status" style={{ background: s.bg, color: s.fg }}>
      <span className="swatch" style={{ background: s.dot, width: 8, height: 8 }} />
      {s.label}
    </span>
  );
}

export function RunPicker({ runs, run, onOpen, label = 'ריצה' }: { runs: RunSummary[]; run: Run | null; onOpen: (id: string) => void; label?: string }) {
  if (!runs.length) return null;
  return (
    <label className="field compact" style={{ minWidth: 260 }}>
      {label}
      <select value={run?.id ?? ''} onChange={(e) => onOpen(e.target.value)}>
        {!run && <option value="">בחר ריצה</option>}
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} · {fmtDate(r.createdAt)} · {STATUS_HE[r.status].label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface Props {
  geo: GeoData | null;
  run: Run | null;
  runs: RunSummary[];
  live: boolean;
  busy: boolean;
  notice: string | null;
  onOpen: (id: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function RunScreen({ geo, run, runs, live, busy, notice, onOpen, onPause, onResume, onStop }: Props) {
  const [pick, setPick] = useState<{ id: string; repeat: number; turn: number } | null>(null);
  const [zoom, setZoom] = useState<'world' | 'crisis'>('world');
  const [filter, setFilter] = useState<'all' | Category>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const byId = useMemo(() => Object.fromEntries((geo?.countries ?? []).map((c) => [c.id, c])), [geo]);

  if (!run) {
    return (
      <div className="card" style={{ alignItems: 'flex-start' }}>
        <h1>עדיין אין ריצות</h1>
        <p className="ink2">הגדר ניסוי במסך ההגדרה ולחץ "הרץ סימולציה". אפשר להתחיל עם מודלי הדמו, בלי מפתח.</p>
        <a className="btn btn-primary" href="#/setup">למסך ההגדרה</a>
      </div>
    );
  }

  const cfg = run.config;
  const profileById = Object.fromEntries(run.profiles.map((p) => [p.id, p]));
  const name = (id: string) => byId[id]?.he ?? id;
  const latest = run.turns[run.turns.length - 1];
  const sel = pick && pick.id === run.id ? run.turns.find((t) => t.repeat === pick.repeat && t.turn === pick.turn) : undefined;
  const shown = sel ?? latest;
  const repeat = shown?.repeat ?? run.repeat;
  const assign = run.assignments[repeat] ?? run.assignments[0];
  const turnsInRepeat = run.turns.filter((t) => t.repeat === repeat);
  const fills = Object.fromEntries(cfg.countries.map((c) => [c.id, profileById[assign[c.id]]?.color ?? '#898781']));

  const arcs: Arc[] = (shown?.decisions ?? []).flatMap((d) =>
    d.actions
      .filter((a) => a.target)
      .map((a) => {
        const cat = ACTION_BY_ID[a.action]?.cat;
        const kind: ArcKind = cat === 'wait' || !cat ? 'diplo' : cat;
        return { from: d.countryId, to: a.target!, kind };
      }),
  );
  const crisis = [...new Set([...(shown?.conflicts ?? []).flatMap((p) => [p.a, p.b]), ...(cfg.scenario === 'border' ? cfg.parties : [])])];
  const decisions = (shown?.decisions ?? []).filter((d) => filter === 'all' || d.actions.some((a) => ACTION_BY_ID[a.action]?.cat === filter));
  const series = worldEscalation(run, repeat);
  const doneInRepeat = turnsInRepeat.length;
  const canResume = !busy && run.status === 'paused';
  const canStop = live || run.status === 'paused';

  return (
    <>
      <div className="between" style={{ alignItems: 'flex-end' }}>
        <div className="stack-sm">
          <div className="wrap">
            <StatusBadge run={run} />
            <h1>{cfg.name}</h1>
          </div>
          <p className="ink2">
            חזרה <span className="mono">{repeat + 1}/{cfg.repeats}</span> · תור <span className="mono">{doneInRepeat}/{cfg.turns}</span> · כל תור מייצג {UNIT_HE[cfg.turnUnit].one} · {cfg.countries.length} מדינות · {run.profiles.length} מודלים · <span className="mono">{run.calls}</span> בקשות
          </p>
        </div>
        <div className="wrap">
          {!live && <RunPicker runs={runs} run={run} onOpen={(id) => { setPick(null); onOpen(id); }} />}
          {live && <button type="button" className="btn btn-primary" onClick={onPause}><Pause />השהה אחרי התור הנוכחי</button>}
          {canResume && <button type="button" className="btn btn-primary" onClick={onResume}><Play />המשך</button>}
          {canStop && <button type="button" className="btn" onClick={onStop}>עצור</button>}
          <a className="btn" href="#/report">לניתוח</a>
        </div>
      </div>

      {notice && live && <div className="notice info" role="status"><Info />{notice}</div>}
      {run.statusNote && <div className={`notice ${run.status === 'error' ? 'error' : 'warn'}`} role="status"><Warn />{run.statusNote}</div>}

      <div className="stack-sm">
        <div className="timeline" style={{ gridTemplateColumns: `repeat(${cfg.turns}, minmax(0, 1fr))` }} role="group" aria-label="תורות בחזרה הנוכחית">
          {Array.from({ length: cfg.turns }, (_, t) => {
            const tr = turnsInRepeat.find((x) => x.turn === t);
            return (
              <button
                key={t}
                type="button"
                disabled={!tr}
                aria-label={`תור ${t + 1}`}
                aria-pressed={shown?.turn === t && shown?.repeat === repeat}
                onClick={() => tr && setPick({ id: run.id, repeat, turn: t })}
                style={{ height: 22, border: 'none', padding: 0, background: 'transparent', cursor: tr ? 'pointer' : 'default' }}
              >
                <span className={`cell${tr ? ' done' : ''}${shown?.turn === t && shown?.repeat === repeat ? ' shown' : ''}`} />
              </button>
            );
          })}
        </div>
        <div className="between xsmall muted">
          <span className="mono">תור 1</span>
          {cfg.repeats > 1 && (
            <span className="wrap" style={{ gap: 4 }}>
              חזרה:
              {Array.from({ length: run.repeat + 1 }, (_, r) => {
                const last = run.turns.filter((t) => t.repeat === r).pop();
                return (
                  <button key={r} type="button" className="chip" style={{ minHeight: 28 }} aria-pressed={repeat === r} onClick={() => last && setPick({ id: run.id, repeat: r, turn: last.turn })}>
                    {r + 1}
                  </button>
                );
              })}
            </span>
          )}
          <span className="mono">תור {cfg.turns}</span>
        </div>
      </div>

      <div className="row">
        <section className="card grow" aria-labelledby="map-h">
          <div className="between">
            <h2 id="map-h">{shown ? `מפת המצב · תור ${shown.turn + 1}` : 'ממתין לתור הראשון…'}</h2>
            <div className="seg" role="group" aria-label="תקריב">
              <button type="button" aria-pressed={zoom === 'world'} onClick={() => setZoom('world')}>כל העולם</button>
              <button type="button" aria-pressed={zoom === 'crisis'} onClick={() => setZoom('crisis')} disabled={crisis.length < 2}>אזור המשבר</button>
            </div>
          </div>
          <WorldMap
            geo={geo}
            fills={fills}
            labels={cfg.countries.map((c) => c.id)}
            focus={zoom === 'crisis' && crisis.length >= 2 ? crisis : undefined}
            arcs={arcs}
            ariaLabel={`מפת העולם בתור ${shown ? shown.turn + 1 : 0}. החיצים מראים את הפעולות בין המדינות; הפירוט המלא ברשימת האירועים.`}
          />
          <div className="wrap small ink2" style={{ gap: 16 }}>
            {ARC_LEGEND.map((l) => <span key={l.kind} className="inline"><ArcSwatch kind={l.kind} />{l.label}</span>)}
            <span aria-hidden="true" style={{ width: 1, height: 16, background: 'var(--control)' }} />
            {run.profiles.map((p) => <span key={p.id} className="inline" style={{ gap: 6 }}><span className="swatch sq" style={{ background: p.color }} />{p.label}</span>)}
          </div>
          {shown && shown.events.length > 0 && (
            <div className="stack-sm">
              <h3>אירועים בעולם</h3>
              <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
                {shown.events.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </section>

        <aside className="card side" aria-labelledby="feed-h" style={{ flexBasis: 440 }}>
          <div className="between">
            <h2 id="feed-h">החלטות בתור</h2>
            <span className="mono small ink2">{shown ? `תור ${shown.turn + 1}` : ''}</span>
          </div>
          <div className="wrap" role="group" aria-label="סינון לפי סוג פעולה">
            {(['all', 'diplo', 'econ', 'intel', 'mil', 'nuke'] as const).filter((f) => f === 'all' || cfg.categories[f]).map((f) => (
              <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? 'הכל' : CATEGORY_HE[f]}
              </button>
            ))}
          </div>
          {!shown && <div className="empty">{live ? 'המודלים מחליטים על התור הראשון…' : 'אין תורות בריצה הזו.'}</div>}
          <ol className="feed">
            {decisions.map((d) => (
              <DecisionCard
                key={d.countryId}
                d={d}
                name={name}
                profile={profileById[d.profileId]}
                open={!!open[`${run.id}:${repeat}:${shown!.turn}:${d.countryId}`]}
                onToggle={() => {
                  const k = `${run.id}:${repeat}:${shown!.turn}:${d.countryId}`;
                  setOpen({ ...open, [k]: !open[k] });
                }}
              />
            ))}
          </ol>
        </aside>
      </div>

      <div className="row stretch">
        <section className="card" style={{ flex: '1 1 420px', minWidth: 0 }} aria-labelledby="esc-h">
          <div className="stack-sm">
            <h2 id="esc-h">מדד הסלמה עולמי</h2>
            <span className="small ink2">סכום חומרת הפעולות של כל המדינות בכל תור. דה-הסלמה נספרת בשלילה, תקיפה גרעינית שווה 60.</span>
          </div>
          <LineChart count={cfg.turns} series={[{ id: 'world', label: 'עולמי', color: '#17171b', values: Array.from({ length: cfg.turns }, (_, i) => series[i] ?? null) }]} />
        </section>

        <section className="card" style={{ flex: '999 1 600px', minWidth: 0 }} aria-labelledby="tbl-h">
          <h2 id="tbl-h">מצב המדינות {shown ? `אחרי תור ${shown.turn + 1}` : ''}</h2>
          <div className="table-wrap">
            <table className="data" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th scope="col">מדינה</th>
                  <th scope="col">מודל</th>
                  <th scope="col" className="num">צבא</th>
                  <th scope="col" className="num">כלכלה</th>
                  <th scope="col" className="num">יציבות</th>
                  <th scope="col" className="num">הסלמה בתור</th>
                  <th scope="col">בעימות עם</th>
                </tr>
              </thead>
              <tbody>
                {cfg.countries.map((c) => {
                  const p = profileById[assign[c.id]];
                  const after = shown?.after[c.id] ?? run.world.countries[c.id];
                  const d = shown?.decisions.find((x) => x.countryId === c.id);
                  const wars = (shown?.conflicts ?? []).filter((x) => x.a === c.id || x.b === c.id).map((x) => name(x.a === c.id ? x.b : x.a));
                  return (
                    <tr key={c.id}>
                      <th scope="row">{name(c.id)}</th>
                      <td><span className="inline" style={{ gap: 6 }}><span className="swatch sq" style={{ background: p?.color }} />{p?.label}</span></td>
                      <td className="num">{after ? fmtNum(after.military) : '–'}</td>
                      <td className="num">{after ? fmtNum(after.economy) : '–'}</td>
                      <td className="num">{after ? fmtNum(after.stability) : '–'}</td>
                      <td className="num">{d ? d.escalation : '–'}</td>
                      <td className="small">{wars.join(', ') || '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="footer-note">צבא ויציבות בסולם 0–100; כלכלה כמדד שמתחיל ב-100.</p>
        </section>
      </div>
    </>
  );
}

function DecisionCard({ d, name, profile, open, onToggle }: { d: Decision; name: (id: string) => string; profile?: { label: string; color: string; model: string }; open: boolean; onToggle: () => void }) {
  const st = DECISION_STATUS[d.status];
  return (
    <li className="feed-item" style={{ borderInlineStartColor: profile?.color }}>
      <div className="between">
        <span style={{ fontWeight: 600 }}>
          {name(d.countryId)} <span className="mono xsmall muted" style={{ fontWeight: 400 }}>{profile?.label}</span>
        </span>
        <span className="mono xsmall ink2" dir="ltr" title="ניקוד הסלמה">{d.escalation > 0 ? '+' : ''}{d.escalation}</span>
      </div>
      {st && <div className={`notice ${st.cls}`} style={{ padding: '6px 10px' }}><Warn />{st.label}{d.error ? `: ${d.error}` : ''}</div>}
      <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {d.actions.map((a, i) => {
          const def = ACTION_BY_ID[a.action];
          const cat = def?.cat ?? 'wait';
          return (
            <li key={i} className="wrap" style={{ gap: 6 }}>
              <span className="tag" style={{ background: TAG_STYLE[cat].bg, color: TAG_STYLE[cat].fg }}>{CATEGORY_HE[cat]}</span>
              <span style={{ fontWeight: 600 }}>{def?.he ?? a.action}</span>
              {a.target && <span className="ink2">← {name(a.target)}</span>}
              {def?.covert && <span className="tag" style={{ background: 'var(--sunken)', color: 'var(--ink-2)' }}>{d.exposed.includes(i) ? 'חשאי · נחשף' : 'חשאי'}</span>}
            </li>
          );
        })}
      </ul>
      {d.publicStatement && <blockquote>“{d.publicStatement}”</blockquote>}
      {d.messages.length > 0 && (
        <div className="stack-sm small">
          {d.messages.map((m, i) => <span key={i} className="ink2"><strong>הודעה פרטית ל{name(m.to)}:</strong> {m.text}</span>)}
        </div>
      )}
      {d.rejected.length > 0 && (
        <div className="xsmall" style={{ color: 'var(--warn-ink)' }}>
          פעולות שנדחו: {d.rejected.map((r) => `${ACTION_BY_ID[r.action]?.he ?? r.action} (${r.reason})`).join(' · ')}
        </div>
      )}
      {(d.reasoning || d.raw) && (
        <>
          <button type="button" className="btn-link" aria-expanded={open} onClick={onToggle} style={{ alignSelf: 'flex-start', marginInlineStart: -6 }}>
            <Chevron open={open} />
            {open ? 'הסתר נימוק' : d.raw ? 'הצג את התשובה הגולמית' : 'הצג נימוק (רואה רק החוקר)'}
          </button>
          {open && (
            <div className="reasoning">
              <span className="xsmall muted" style={{ fontWeight: 600 }}>{d.raw ? 'תשובה גולמית' : 'נימוק · לא נחשף למדינות אחרות'}</span>
              <span dir="auto">{d.raw ?? d.reasoning}</span>
            </div>
          )}
        </>
      )}
    </li>
  );
}
