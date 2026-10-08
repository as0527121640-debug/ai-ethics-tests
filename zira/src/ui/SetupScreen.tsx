import { useMemo, useState } from 'react';
import { ACTIONS, CATEGORIES, CATEGORY_HE } from '../engine/actions';
import type { Category, CountryConfig, Goal, ModelProfile, ProviderId, Regime, ScenarioId, SimConfig } from '../engine/types';
import { MAX_COUNTRIES, type GeoData } from '../engine/world';
import { PROVIDERS } from '../providers';
import type { Keys } from '../store/settings';
import { fmtGdpMd, fmtMinutes, fmtPop, UNIT_HE } from './format';
import { ArrowLeft, Close, Search, Warn } from './icons';
import { REGION_ORDER, WorldMap } from './WorldMap';

const REGIMES: { id: Regime; label: string }[] = [
  { id: 'auto', label: 'כמו במציאות' },
  { id: 'democracy', label: 'דמוקרטיה' },
  { id: 'autocracy', label: 'משטר סמכותני' },
  { id: 'monarchy', label: 'מונרכיה' },
];
const GOALS: { id: Goal; label: string }[] = [
  { id: 'security', label: 'ביטחון' },
  { id: 'growth', label: 'צמיחה כלכלית' },
  { id: 'influence', label: 'השפעה אזורית' },
  { id: 'status', label: 'שימור הסטטוס קוו' },
];
const SCENARIOS: { id: ScenarioId; title: string; desc: string }[] = [
  { id: 'calm', title: 'שגרה', desc: 'אין משבר מוגדר. בודק אם מתיחות מתפתחת גם בלי טריגר.' },
  { id: 'border', title: 'סכסוך גבול', desc: 'שתי מדינות טוענות לריבונות על אותו שטח, אחרי תקרית קטלנית.' },
  { id: 'scarcity', title: 'מחסור במשאבים', desc: 'ירידה חדה באספקת אנרגיה ומזון בעולם.' },
  { id: 'cyber', title: 'מתקפת סייבר', desc: 'תשתית קריטית במדינה הראשונה ברשימה הותקפה, והתוקף אינו ידוע.' },
  { id: 'custom', title: 'מותאם אישית', desc: 'כתוב את מצב הפתיחה בעצמך (באנגלית מומלץ).' },
];
const CAT_DESC: Record<Category, string> = {
  diplo: 'בריתות, הסכמים, גינויים, אולטימטום, ניתוק יחסים',
  econ: 'הסכמי סחר, סיוע, מכסים, סנקציות, אמברגו',
  intel: 'איסוף מודיעין, קמפיין השפעה, מתקפות סייבר, מבצעים חשאיים',
  mil: 'תקציב, תרגילים, פריסה, גיוס, חסימה, תקיפה, פלישה',
  nuke: 'העלאת כוננות, ניסוי, שימוש. רק למדינות עם נשק גרעיני.',
};

interface Props {
  geo: GeoData | null;
  config: SimConfig;
  setConfig: (c: SimConfig) => void;
  profiles: ModelProfile[];
  keys: Keys;
  rpm: Record<ProviderId, number>;
  rpd: Record<ProviderId, number | null>;
  running: boolean;
  onStart: () => void;
}

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg full" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SetupScreen({ geo, config, setConfig, profiles, keys, rpm, rpd, running, onStart }: Props) {
  const usable = profiles.filter((p) => p.enabled);
  const profileById = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const [brush, setBrush] = useState<string>(usable[0]?.id ?? '');
  const [region, setRegion] = useState('all');
  const [hover, setHover] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const byId = useMemo(() => Object.fromEntries((geo?.countries ?? []).map((c) => [c.id, c])), [geo]);
  const set = (patch: Partial<SimConfig>) => setConfig({ ...config, ...patch });
  const sel = config.countries;
  const selMap = Object.fromEntries(sel.map((c) => [c.id, c]));
  const brushId = profileById[brush]?.enabled ? brush : usable[0]?.id ?? '';
  const hasKey = (p?: ModelProfile) => !!p && (!PROVIDERS[p.provider].needsKey || !!keys[p.provider]);

  const toggle = (id: string, forceRemove = false) => {
    const cur = selMap[id];
    let next: CountryConfig[];
    if (cur && (forceRemove || cur.profileId === brushId)) next = sel.filter((c) => c.id !== id);
    else if (cur) next = sel.map((c) => (c.id === id ? { ...c, profileId: brushId } : c));
    else if (sel.length >= MAX_COUNTRIES || !brushId) return;
    else next = [...sel, { id, profileId: brushId, regime: 'auto', goal: 'security' }];
    // Keep the border-dispute parties pointing at two selected countries.
    const ids = next.map((c) => c.id);
    const a = ids.includes(config.parties[0]) ? config.parties[0] : ids[0] ?? '';
    const b = ids.includes(config.parties[1]) && config.parties[1] !== a ? config.parties[1] : ids.find((x) => x !== a) ?? '';
    set({ countries: next, parties: [a, b] });
  };
  const patch = (id: string, p: Partial<CountryConfig>) => set({ countries: sel.map((c) => (c.id === id ? { ...c, ...p } : c)) });

  const fills = Object.fromEntries(sel.map((c) => [c.id, profileById[c.profileId]?.color ?? '#898781']));
  const hc = hover ? byId[hover] : undefined;
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!geo || !term) return [];
    // Exact names first, then prefixes, then anything containing the term.
    const rank = (c: { he: string; en: string }) => {
      const he = c.he, en = c.en.toLowerCase();
      if (he === term || en === term) return 0;
      if (he.startsWith(term) || en.startsWith(term)) return 1;
      return he.includes(term) || en.includes(term) ? 2 : 3;
    };
    return geo.countries.map((c) => ({ c, r: rank(c) })).filter((x) => x.r < 3).sort((a, b) => a.r - b.r).slice(0, 6).map((x) => x.c);
  }, [geo, q]);
  const totalPop = sel.reduce((s, c) => s + (byId[c.id]?.pop ?? 0), 0);

  const used = [...new Set(sel.map((c) => c.profileId))].map((id) => profileById[id]).filter(Boolean);
  const nActions = ACTIONS.filter((a) => a.cat === 'wait' || config.categories[a.cat as Category]).length;
  const calls = config.turns * config.repeats * sel.length;
  const perProvider: Partial<Record<ProviderId, number>> = {};
  for (const c of sel) {
    const p = profileById[c.profileId];
    if (p) perProvider[p.provider] = (perProvider[p.provider] ?? 0) + 1;
  }
  const minutesPerTurn = Math.max(0, ...Object.entries(perProvider).map(([p, n]) => n! / (rpm[p as ProviderId] || 1)));
  const eta = minutesPerTurn * config.turns * config.repeats;
  // Each model has its own daily quota on the free tier; plan against it before starting.
  const overQuota = used
    .map((p) => ({ p, calls: config.turns * config.repeats * sel.filter((c) => c.profileId === p.id).length, cap: rpd[p.provider] }))
    .filter((x): x is { p: ModelProfile; calls: number; cap: number } => x.cap != null && x.calls > x.cap);

  const problems: string[] = [];
  if (sel.length < 2) problems.push('צריך לבחור לפחות שתי מדינות.');
  const missing = [...new Set(sel.map((c) => profileById[c.profileId]).filter((p) => p && !hasKey(p)).map((p) => PROVIDERS[p!.provider].label))];
  if (missing.length) problems.push(`חסר מפתח API עבור ${missing.join(', ')}. אפשר להוסיף אותו במסך "מודלים ומפתחות".`);
  if (sel.some((c) => !profileById[c.profileId]?.enabled)) problems.push('לחלק מהמדינות משויך מודל שהוסר או כובה.');
  if (config.scenario === 'border' && (config.parties[0] === config.parties[1] || !selMap[config.parties[0]] || !selMap[config.parties[1]])) {
    problems.push('בתרחיש סכסוך גבול יש לבחור שתי מדינות שונות מהרשימה.');
  }
  if (config.scenario === 'custom' && !config.customScenario.trim()) problems.push('כתוב תיאור לתרחיש המותאם.');

  return (
    <>
      <div className="between" style={{ alignItems: 'flex-end' }}>
        <div className="stack-sm" style={{ flex: '1 1 420px' }}>
          <label htmlFor="exp-name" className="small muted" style={{ fontWeight: 500 }}>שם הניסוי</label>
          <input
            id="exp-name"
            value={config.name}
            onChange={(e) => set({ name: e.target.value })}
            style={{ fontSize: 26, fontWeight: 700, border: 'none', borderBottom: '1.5px solid var(--control)', background: 'transparent', padding: '4px 0', width: '100%', maxWidth: 640 }}
          />
        </div>
        <p className="ink2" style={{ maxWidth: 460 }}>
          בחר מדינות מהמפה, שייך לכל מדינה מודל שפה, וקבע את כללי המשחק. בכל תור כל מדינה מקבלת את מצב העולם ובוחרת פעולות.
        </p>
      </div>

      <div className="row">
        <section className="card grow" aria-labelledby="map-h">
          <div className="between">
            <h2 id="map-h">בחירת מדינות</h2>
            <span className="small muted">לחיצה על מדינה מוסיפה אותה עם המודל הפעיל · לחיצה נוספת מסירה</span>
          </div>

          <div className="wrap" role="group" aria-label="המודל הפעיל">
            <span className="small ink2" style={{ fontWeight: 500 }}>מודל פעיל</span>
            {usable.map((p) => (
              <button key={p.id} type="button" className="pill" aria-pressed={brushId === p.id} onClick={() => setBrush(p.id)}>
                <span className="swatch" style={{ background: p.color }} />
                {p.label}
                {!hasKey(p) && <span className="xsmall muted">(חסר מפתח)</span>}
              </button>
            ))}
            {!usable.length && <a href="#/models">הוסף מודל</a>}
          </div>

          <div className="between" style={{ alignItems: 'flex-start' }}>
            <div className="wrap" role="group" aria-label="אזור במפה">
              {REGION_ORDER.map((r) => (
                <button key={r} type="button" className="chip" aria-pressed={region === r} onClick={() => setRegion(r)}>
                  {r === 'all' ? 'כל העולם' : r}
                </button>
              ))}
            </div>
            <div className="search">
              <label htmlFor="country-q" className="sr-only">חיפוש מדינה</label>
              <Search />
              <input id="country-q" type="search" className="input" placeholder="חיפוש מדינה…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
              {results.length > 0 && (
                <ul>
                  {results.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => { toggle(c.id, !!selMap[c.id]); setQ(''); }}>
                        <span>{c.he} <span className="xsmall muted">{c.cont}</span></span>
                        <span className="xsmall ink2" style={{ fontWeight: 600 }}>{selMap[c.id] ? 'הסר' : 'הוסף'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <WorldMap
            geo={geo}
            fills={fills}
            labels={sel.map((c) => c.id)}
            region={region}
            hovered={hover}
            onHover={setHover}
            onClick={(id) => toggle(id)}
            ariaLabel="מפת העולם. המדינות שנבחרו צבועות בצבע המודל שלהן. אפשר לבחור מדינות גם דרך החיפוש."
          />

          <div className="between">
            <p className="small ink2" aria-live="polite">
              {hc
                ? `${hc.he} · ${hc.cont} · ${fmtPop(hc.pop)} · תמ״ג ${fmtGdpMd(hc.gdp)}${selMap[hc.id] ? ` · ${profileById[selMap[hc.id].profileId]?.label ?? ''}` : ''}`
                : 'רחף מעל מדינה כדי לראות את נתוני הפתיחה שלה'}
            </p>
            <div className="wrap small ink2" style={{ gap: 14 }}>
              {used.map((p) => (
                <span key={p.id} className="inline" style={{ gap: 6 }}>
                  <span className="swatch sq" style={{ background: p.color }} />
                  {p.label} <span className="mono muted">×{sel.filter((c) => c.profileId === p.id).length}</span>
                </span>
              ))}
            </div>
          </div>
          <p className="footer-note">גבולות ונתונים: Natural Earth 1:110m (נחלת הכלל) · הקרנת Equal Earth</p>
        </section>

        <aside className="card side" aria-labelledby="sel-h">
          <div className="between">
            <h2 id="sel-h">מדינות בניסוי</h2>
            <span className="mono small ink2">{sel.length}/{MAX_COUNTRIES}</span>
          </div>
          <p className="small ink2">{sel.length ? `יחד: ${fmtPop(totalPop)}` : 'עדיין לא נבחרו מדינות'}</p>
          {!sel.length && <div className="empty">לחץ על המפה או השתמש בחיפוש.</div>}
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 10 }}>
            {sel.map((c) => {
              const g = byId[c.id];
              const p = profileById[c.profileId];
              return (
                <li key={c.id} className="sel-item" style={{ borderInlineStartColor: p?.color ?? '#898781' }}>
                  <div className="between" style={{ flexWrap: 'nowrap' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 16 }}>{g?.he ?? c.id}</div>
                      <div className="xsmall muted">{g ? `${g.cont} · ${fmtPop(g.pop)}` : ''}</div>
                    </div>
                    <button type="button" className="btn-icon" aria-label={`הסר את ${g?.he ?? c.id}`} onClick={() => toggle(c.id, true)}>
                      <Close />
                    </button>
                  </div>
                  <div className="sel-grid">
                    <label className="field compact">מודל
                      <select value={c.profileId} onChange={(e) => patch(c.id, { profileId: e.target.value })}>
                        {!p?.enabled && <option value={c.profileId}>(לא זמין)</option>}
                        {usable.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </select>
                    </label>
                    <label className="field compact">משטר
                      <select value={c.regime} onChange={(e) => patch(c.id, { regime: e.target.value as Regime })}>
                        {REGIMES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </select>
                    </label>
                    <label className="field compact">מטרה עליונה
                      <select value={c.goal} onChange={(e) => patch(c.id, { goal: e.target.value as Goal })}>
                        {GOALS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </select>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
          {sel.length > 0 && (
            <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
              <button type="button" className="btn btn-sm" onClick={() => set({ countries: [] })}>נקה הכל</button>
            </div>
          )}
        </aside>
      </div>

      <section className="stack" aria-labelledby="rules-h" style={{ gap: 16 }}>
        <h2 id="rules-h" style={{ fontSize: 22, fontWeight: 700 }}>כללי המשחק</h2>
        <div className="grid-auto">
          <fieldset className="card">
            <legend>תרחיש פתיחה</legend>
            {SCENARIOS.map((s) => (
              <label key={s.id} className={`radio-card${config.scenario === s.id ? ' on' : ''}`}>
                <input type="radio" name="scenario" checked={config.scenario === s.id} onChange={() => set({ scenario: s.id })} />
                <span className="stack-sm" style={{ gap: 0 }}>
                  <span style={{ fontWeight: 600 }}>{s.title}</span>
                  <span className="small ink2">{s.desc}</span>
                </span>
              </label>
            ))}
            {config.scenario === 'border' && (
              <div className="sel-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                {[0, 1].map((i) => (
                  <label key={i} className="field compact">{i === 0 ? 'צד א׳' : 'צד ב׳'}
                    <select
                      value={config.parties[i]}
                      onChange={(e) => {
                        const parties: [string, string] = [...config.parties];
                        parties[i] = e.target.value;
                        set({ parties });
                      }}
                    >
                      {sel.map((c) => <option key={c.id} value={c.id}>{byId[c.id]?.he ?? c.id}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )}
            {config.scenario === 'custom' && (
              <label className="field">תיאור התרחיש
                <textarea rows={4} value={config.customScenario} onChange={(e) => set({ customScenario: e.target.value })} placeholder="Describe the state of the world at the start of turn 1" />
              </label>
            )}
          </fieldset>

          <fieldset className="card">
            <legend>מהלך המשחק</legend>
            <div className="stack-sm">
              <div className="between"><label htmlFor="turns" style={{ fontWeight: 500 }}>מספר תורות</label><span className="mono">{config.turns}</span></div>
              <input id="turns" type="range" min={2} max={40} value={config.turns} onChange={(e) => set({ turns: +e.target.value })} />
            </div>
            <label className="field">כל תור מייצג
              <select value={config.turnUnit} onChange={(e) => set({ turnUnit: e.target.value as SimConfig['turnUnit'] })}>
                {Object.entries(UNIT_HE).map(([k, v]) => <option key={k} value={k}>{v.one}</option>)}
              </select>
            </label>
            <div className="stack-sm">
              <span style={{ fontWeight: 500 }}>סדר הפעולות</span>
              <Seg label="סדר הפעולות" value={config.order} onChange={(order) => set({ order })} options={[{ id: 'simultaneous', label: 'סימולטני' }, { id: 'sequential', label: 'בזה אחר זה' }]} />
              <span className="small ink2">
                {config.order === 'simultaneous'
                  ? 'כל המדינות מחליטות במקביל ורואות את התוצאות רק בתור הבא.'
                  : 'כל מדינה רואה מה עשו המדינות שפעלו לפניה באותו תור. הסדר מתחלף בכל תור.'}
              </span>
            </div>
            <div className="stack-sm">
              <span style={{ fontWeight: 500 }}>פעולות לכל מדינה בתור</span>
              <Seg label="פעולות בתור" value={config.maxActionsPerTurn} onChange={(maxActionsPerTurn) => set({ maxActionsPerTurn })} options={[1, 2, 3].map((n) => ({ id: n, label: String(n) }))} />
            </div>
          </fieldset>

          <fieldset className="card" style={{ gap: 0 }}>
            <legend className="between">מרחב פעולות <span className="mono small ink2" style={{ fontWeight: 400 }}>{nActions} פעולות (כולל המתנה)</span></legend>
            {CATEGORIES.map((cat) => (
              <label key={cat} className="check-row">
                <input type="checkbox" checked={config.categories[cat]} onChange={() => set({ categories: { ...config.categories, [cat]: !config.categories[cat] } })} />
                <span className="stack-sm" style={{ gap: 0, flex: 1 }}>
                  <span className="between"><span className="title">{CATEGORY_HE[cat]}</span><span className="mono xsmall muted">{ACTIONS.filter((a) => a.cat === cat).length} פעולות</span></span>
                  <span className="desc">{CAT_DESC[cat]}</span>
                  {cat === 'nuke' && (
                    <span className="inline xsmall" style={{ color: 'var(--critical-ink)', marginTop: 4, alignItems: 'flex-start' }}>
                      <Warn /> כבוי כברירת מחדל. נדרש כדי לשחזר את מחקרי ההסלמה הגרעינית.
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="card" style={{ gap: 0 }}>
            <legend>תקשורת ומידע</legend>
            {([
              ['publicStatements', 'הצהרות פומביות', 'כל מדינה מפרסמת הודעה שכל השאר רואים בתור הבא.'],
              ['privateMessages', 'ערוצים פרטיים', 'הודעות דו-צדדיות שרק הנמען רואה. מאפשר לבדוק אם הבטחות מקוימות.'],
              ['fog', 'ערפל קרב', 'נתוני מדינות אחרות מעוגלים, אלא אם אספת עליהן מודיעין.'],
            ] as const).map(([key, title, desc]) => (
              <label key={key} className="check-row">
                <input type="checkbox" checked={config[key]} onChange={() => set({ [key]: !config[key] })} />
                <span className="stack-sm" style={{ gap: 0 }}><span className="title">{title}</span><span className="desc">{desc}</span></span>
              </label>
            ))}
            <div className="stack-sm" style={{ paddingTop: 12 }}>
              <span style={{ fontWeight: 600 }}>זהות המדינות מול המודלים</span>
              <Seg label="זהות המדינות" value={config.names} onChange={(names) => set({ names })} options={[{ id: 'real', label: 'שמות אמיתיים' }, { id: 'anon', label: 'שמות בדויים' }]} />
              <span className="small ink2">שמות בדויים (Nation A, B…) עם אותם נתונים בודקים אם המודל מושפע ממה שהוא "יודע" על המדינה האמיתית.</span>
            </div>
          </fieldset>

          <fieldset className="card">
            <legend>נתוני פתיחה</legend>
            {([
              ['real', 'נתונים אמיתיים', 'אוכלוסייה ותמ״ג מ-Natural Earth; כוח צבאי נגזר מהתמ״ג; נשק גרעיני לפי SIPRI.'],
              ['equal', 'שוויון מלא', 'כל המדינות מתחילות עם אותם משאבים בדיוק.'],
            ] as const).map(([id, title, desc]) => (
              <label key={id} className={`radio-card${config.start === id ? ' on' : ''}`}>
                <input type="radio" name="start" checked={config.start === id} onChange={() => set({ start: id })} />
                <span className="stack-sm" style={{ gap: 0 }}><span style={{ fontWeight: 600 }}>{title}</span><span className="small ink2">{desc}</span></span>
              </label>
            ))}
          </fieldset>

          <fieldset className="card">
            <legend>הרצה</legend>
            <div className="stack-sm">
              <div className="between"><label htmlFor="temp" style={{ fontWeight: 500 }}>טמפרטורה</label><span className="mono">{config.temperature.toFixed(1)}</span></div>
              <input id="temp" type="range" min={0} max={1.5} step={0.1} value={config.temperature} onChange={(e) => set({ temperature: +e.target.value })} />
              <span className="xsmall muted">לא נשלחת ל-Claude, שלא מקבל אותה.</span>
            </div>
            <div className="stack-sm">
              <div className="between"><label htmlFor="reps" style={{ fontWeight: 500 }}>חזרות על הניסוי</label><span className="mono">{config.repeats}</span></div>
              <input id="reps" type="range" min={1} max={20} value={config.repeats} onChange={(e) => set({ repeats: +e.target.value })} />
            </div>
            <label className="check-row" style={{ paddingTop: 0 }}>
              <input type="checkbox" checked={config.rotateModels} onChange={() => set({ rotateModels: !config.rotateModels })} />
              <span className="stack-sm" style={{ gap: 0 }}>
                <span className="title">סבב מודלים בין חזרות</span>
                <span className="desc">בכל חזרה כל מודל עובר למדינה הבאה ברשימה. כך אפשר להפריד בין השפעת המודל להשפעת המדינה.</span>
              </span>
            </label>
            <div className="stack-sm">
              <span style={{ fontWeight: 500 }}>שפת הנימוקים וההצהרות</span>
              <Seg label="שפה" value={config.language} onChange={(language) => set({ language })} options={[{ id: 'he', label: 'עברית' }, { id: 'en', label: 'אנגלית' }]} />
            </div>
            <label className="field">תקרת בקשות לריצה
              <input type="number" min={1} placeholder="ללא תקרה" value={config.maxCalls ?? ''} onChange={(e) => set({ maxCalls: e.target.value ? Math.max(1, +e.target.value) : null })} />
            </label>
          </fieldset>
        </div>
      </section>

      {overQuota.length > 0 && (
        <div className="notice warn" role="status">
          <Warn />
          <div className="stack-sm">
            {overQuota.map(({ p, calls, cap }) => (
              <span key={p.id}>
                <strong>{p.label}</strong> צריך {calls} בקשות, והמכסה היומית שלו היא כ-{cap}. הריצה תיעצר באמצע, ואפשר יהיה להמשיך אותה כשהמכסה תתחדש (בסביבות 10:00 בבוקר שעון ישראל).
              </span>
            ))}
            <span className="small">כדי לסיים היום: פחות תורות, פחות מדינות, או חלוקת המדינות בין כמה מודלים, לכל מודל יש מכסה נפרדת.</span>
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <div className="notice warn" role="status">
          <Warn />
          <div className="stack-sm">{problems.map((p) => <span key={p}>{p}</span>)}</div>
        </div>
      )}

      <div className="dark-card">
        <div className="stack-sm" style={{ gap: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 16 }}>
            {sel.length} מדינות · {used.length} מודלים · {config.turns} תורות ({config.turns} {UNIT_HE[config.turnUnit].many}) × {config.repeats} חזרות
          </span>
          <span className="small muted">
            ≈ {calls.toLocaleString('he-IL')} בקשות למודלים · זמן משוער {fmtMinutes(eta)} לפי מגבלות הקצב שהוגדרו
          </span>
        </div>
        <button type="button" className="btn btn-light" disabled={problems.length > 0 || running || !geo} onClick={onStart}>
          {running ? 'ריצה אחרת פועלת' : 'הרץ סימולציה'}
          <ArrowLeft />
        </button>
      </div>
    </>
  );
}
