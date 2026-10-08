import { useState } from 'react';
import type { ModelProfile, ProviderId } from '../engine/types';
import { PROVIDER_ORDER, PROVIDERS } from '../providers';
import { listGeminiModels, pingGemini, type ModelHealth } from '../providers/gemini';
import { nextColor, type Keys, type Settings } from '../store/settings';
import { Info, Trash, Warn } from './icons';

interface Props {
  settings: Settings;
  setSettings: (s: Settings) => void;
  keys: Keys;
  setKeys: (k: Keys) => void;
}

const KEYED: ProviderId[] = PROVIDER_ORDER.filter((p) => PROVIDERS[p].needsKey);

export function ModelsScreen({ settings, setSettings, keys, setKeys }: Props) {
  const [shown, setShown] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [check, setCheck] = useState<{ state: 'idle' | 'busy' | 'ok' | 'fail'; msg?: string; models?: string[] }>({ state: 'idle' });
  const [health, setHealth] = useState<Record<string, { health: ModelHealth; detail: string } | 'checking'>>({});
  const { profiles } = settings;
  const setProfiles = (p: ModelProfile[]) => setSettings({ ...settings, profiles: p });
  const patch = (id: string, p: Partial<ModelProfile>) => setProfiles(profiles.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const geminiProfiles = profiles.filter((p) => p.provider === 'gemini' && p.enabled && p.model);

  const verifyGemini = async () => {
    const key = keys.gemini;
    if (!key) return;
    setCheck({ state: 'busy' });
    setHealth({});
    let models: string[];
    try {
      models = await listGeminiModels(key);
    } catch (e) {
      setCheck({ state: 'fail', msg: e instanceof Error ? e.message : String(e) });
      return;
    }
    setCheck({ state: 'ok', models, msg: `המפתח תקין. ${models.length} מודלים של Gemini זמינים לו. בודק אילו מהם עונים עכשיו…` });
    // A model can be listed and still refuse every call (503 under load), so try each one once.
    const out: typeof health = {};
    for (const p of geminiProfiles) {
      setHealth({ ...out, [p.id]: 'checking' });
      out[p.id] = models.includes(p.model) ? await pingGemini(key, p.model) : { health: 'missing', detail: 'המודל לא זמין למפתח הזה' };
      setHealth({ ...out });
    }
    const bad = geminiProfiles.filter((p) => out[p.id] !== 'checking' && (out[p.id] as { health: ModelHealth }).health !== 'ok').length;
    setCheck({
      state: 'ok',
      models,
      msg: bad ? `המפתח תקין, אבל ${bad} מהמודלים ברשימה לא עונים כרגע. כדאי להחליף אותם או לכבות אותם לפני הרצה.` : 'המפתח תקין, וכל מודלי Gemini ברשימה עונים.',
    });
  };

  const addProfile = () => {
    const provider: ProviderId = keys.gemini ? 'gemini' : 'demo';
    const model = PROVIDERS[provider].models[0]?.id ?? '';
    setProfiles([
      ...profiles,
      {
        id: `p-${Date.now().toString(36)}`,
        provider,
        model,
        label: PROVIDERS[provider].models[0]?.label ?? 'מודל חדש',
        color: nextColor(profiles),
        enabled: true,
      },
    ]);
  };

  const suggestions = (p: ModelProfile) => {
    const base = PROVIDERS[p.provider].models.map((m) => m.id);
    return p.provider === 'gemini' && check.models ? [...new Set([...base, ...check.models])] : base;
  };

  return (
    <>
      <div className="stack-sm">
        <h1>מודלים ומפתחות</h1>
        <p className="ink2" style={{ maxWidth: 760 }}>
          האתר רץ כולו בדפדפן שלך. המפתחות נשמרים רק במכשיר הזה ונשלחים ישירות לספק המודלים, בלי שרת באמצע. בלי מפתח אפשר להשתמש במודלי הדמו.
        </p>
      </div>

      <section className="card" aria-labelledby="keys-h">
        <h2 id="keys-h">מפתחות API</h2>
        <div className="grid-auto">
          {KEYED.map((p) => {
            const meta = PROVIDERS[p];
            return (
              <div key={p} className="stack-sm" style={{ border: '1px solid var(--hairline)', borderRadius: 10, padding: 14, gap: 10 }}>
                <div className="between">
                  <h3>{meta.label}</h3>
                  {keys[p] ? <span className="tag" style={{ background: 'var(--good-bg)', color: 'var(--good-ink)' }}>מפתח הוזן</span> : <span className="tag" style={{ background: 'var(--sunken)', color: 'var(--ink-2)' }}>אין מפתח</span>}
                </div>
                <p className="small ink2">{meta.keyHint} {meta.keyUrl && <a href={meta.keyUrl} target="_blank" rel="noreferrer">איפה משיגים מפתח</a>}</p>
                <div className="wrap" style={{ flexWrap: 'nowrap' }}>
                  <label className="field" style={{ flex: 1 }}>
                    <span className="sr-only">מפתח {meta.label}</span>
                    <input
                      type={shown[p] ? 'text' : 'password'}
                      value={keys[p] ?? ''}
                      onChange={(e) => {
                        setKeys({ ...keys, [p]: e.target.value.trim() });
                        if (p === 'gemini') setCheck({ state: 'idle' });
                      }}
                      placeholder="הדבק כאן את המפתח"
                      autoComplete="off"
                      spellCheck={false}
                      dir="ltr"
                    />
                  </label>
                  <button type="button" className="btn btn-sm" onClick={() => setShown({ ...shown, [p]: !shown[p] })}>{shown[p] ? 'הסתר' : 'הצג'}</button>
                </div>
                <div className="between">
                  <label className="inline small ink2">
                    מגבלת בקשות לדקה
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      className="input"
                      style={{ width: 90, minHeight: 36 }}
                      value={settings.rpm[p]}
                      onChange={(e) => setSettings({ ...settings, rpm: { ...settings.rpm, [p]: Math.max(1, +e.target.value || 1) } })}
                    />
                  </label>
                  <label className="inline small ink2">
                    מכסה יומית לכל מודל
                    <input
                      type="number"
                      min={1}
                      className="input"
                      style={{ width: 90, minHeight: 36 }}
                      placeholder="ללא"
                      value={settings.rpd[p] ?? ''}
                      onChange={(e) => setSettings({ ...settings, rpd: { ...settings.rpd, [p]: e.target.value ? Math.max(1, +e.target.value) : null } })}
                    />
                  </label>
                  {p === 'gemini' && (
                    <button type="button" className="btn btn-sm" disabled={!keys.gemini || check.state === 'busy'} onClick={verifyGemini}>
                      {check.state === 'busy' ? 'בודק…' : 'בדוק מפתח'}
                    </button>
                  )}
                </div>
                {p === 'gemini' && (check.state === 'ok' || check.state === 'fail') && (
                  <div className={`notice ${check.state === 'fail' ? 'error' : Object.values(health).some((h) => h !== 'checking' && h.health !== 'ok') ? 'warn' : 'good'}`} role="status">
                    {check.msg}
                  </div>
                )}
                {p === 'gemini' && Object.keys(health).length > 0 && (
                  <ul className="stack-sm small" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {geminiProfiles.filter((x) => health[x.id]).map((x) => {
                      const h = health[x.id];
                      const ok = h !== 'checking' && h.health === 'ok';
                      return (
                        <li key={x.id} className="between" style={{ flexWrap: 'nowrap' }}>
                          <span className="inline" style={{ gap: 6 }}><span className="swatch sq" style={{ background: x.color }} />{x.label} <span className="mono xsmall muted" dir="ltr">{x.model}</span></span>
                          <span className="inline xsmall" style={{ gap: 4, fontWeight: 600, color: h === 'checking' ? 'var(--muted)' : ok ? 'var(--good-ink)' : 'var(--warn-ink)' }}>
                            {h === 'checking' ? 'בודק…' : ok ? '✓ עונה' : <><Warn />{h.detail}</>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {p === 'gemini' && (
                  <p className="xsmall muted">
                    במכסה החינמית יש לכל מודל מגבלה לדקה ומגבלה ליום; ל-Gemini 3.8 Flash, למשל, 20 בקשות ביום. הערכים המדויקים מופיעים ב-Google AI Studio. לכל מודל מכסה נפרדת, אז חלוקת המדינות בין כמה מודלים מאפשרת ניסויים גדולים יותר. כשהמכסה היומית נגמרת הריצה נעצרת, ואפשר להמשיך אותה כשהמכסה מתחדשת. "בדוק מפתח" שולח בקשה אחת לכל מודל, והיא נספרת במכסה. בשכבה החינמית Google רשאית להשתמש בתוכן הבקשות לשיפור המוצרים שלה.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <label className="check-row" style={{ borderBottom: 'none' }}>
          <input type="checkbox" checked={settings.rememberKeys} onChange={() => setSettings({ ...settings, rememberKeys: !settings.rememberKeys })} />
          <span className="stack-sm" style={{ gap: 0 }}>
            <span className="title">זכור את המפתחות במכשיר הזה</span>
            <span className="desc">כשהאפשרות כבויה, המפתחות נמחקים כשסוגרים את הלשונית. לא מומלץ לשמור מפתחות במחשב ציבורי.</span>
          </span>
        </label>
      </section>

      <section className="card" aria-labelledby="profiles-h">
        <div className="between">
          <div className="stack-sm">
            <h2 id="profiles-h">המודלים בניסויים</h2>
            <p className="small ink2">כל שורה היא "שחקן" שאפשר לשייך למדינות. אפשר להשוות גם בין גרסאות שונות של אותו ספק, למשל שני מודלים של Gemini.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={addProfile} disabled={profiles.length >= 8}>הוסף מודל</button>
        </div>
        <div className="table-wrap">
          <table className="data" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th scope="col">פעיל</th>
                <th scope="col">שם לתצוגה</th>
                <th scope="col">ספק</th>
                <th scope="col">מזהה מודל</th>
                <th scope="col"><span className="sr-only">פעולות</span></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const meta = PROVIDERS[p.provider];
                const missingKey = meta.needsKey && !keys[p.provider];
                return (
                  <tr key={p.id}>
                    <td>
                      <input type="checkbox" aria-label={`${p.label} פעיל`} checked={p.enabled} onChange={() => patch(p.id, { enabled: !p.enabled })} />
                    </td>
                    <td>
                      <div className="inline" style={{ width: '100%' }}>
                        <span className="swatch" style={{ background: p.color }} />
                        <input className="input" aria-label="שם לתצוגה" value={p.label} onChange={(e) => patch(p.id, { label: e.target.value })} style={{ minHeight: 36 }} />
                      </div>
                    </td>
                    <td>
                      <select
                        className="input"
                        aria-label="ספק"
                        value={p.provider}
                        style={{ minHeight: 36 }}
                        onChange={(e) => {
                          const provider = e.target.value as ProviderId;
                          const first = PROVIDERS[provider].models[0];
                          patch(p.id, { provider, model: first?.id ?? '', label: first?.label ?? p.label });
                        }}
                      >
                        {PROVIDER_ORDER.map((id) => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
                      </select>
                      {missingKey && <div className="xsmall" style={{ color: 'var(--warn-ink)', marginTop: 4 }}>חסר מפתח</div>}
                    </td>
                    <td>
                      {p.provider === 'demo' ? (
                        <select className="input" aria-label="סגנון הדמו" value={p.model} style={{ minHeight: 36 }} onChange={(e) => patch(p.id, { model: e.target.value })}>
                          {meta.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                      ) : (
                        <>
                          <input
                            className="input mono"
                            aria-label="מזהה מודל"
                            list={`models-${p.id}`}
                            value={p.model}
                            placeholder={meta.modelPlaceholder}
                            onChange={(e) => patch(p.id, { model: e.target.value.trim() })}
                            dir="ltr"
                            style={{ minHeight: 36, fontSize: 13 }}
                          />
                          <datalist id={`models-${p.id}`}>
                            {suggestions(p).map((m) => <option key={m} value={m} />)}
                          </datalist>
                        </>
                      )}
                    </td>
                    <td>
                      <button type="button" className="btn-icon" aria-label={`מחק את ${p.label}`} onClick={() => setProfiles(profiles.filter((x) => x.id !== p.id))} disabled={profiles.length <= 1}>
                        <Trash />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {PROVIDER_ORDER.filter((id) => PROVIDERS[id].note && profiles.some((p) => p.provider === id)).map((id) => (
          <div key={id} className="notice info"><Info /><span><strong>{PROVIDERS[id].label}:</strong> {PROVIDERS[id].note}</span></div>
        ))}
      </section>
    </>
  );
}
