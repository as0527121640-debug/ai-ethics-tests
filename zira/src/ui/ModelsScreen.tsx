import { useState } from 'react';
import type { ModelProfile, ProviderId } from '../engine/types';
import { PROVIDER_ORDER, PROVIDERS } from '../providers';
import { listGeminiModels } from '../providers/gemini';
import { nextColor, type Keys, type Settings } from '../store/settings';
import { Info, Trash } from './icons';

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
  const { profiles } = settings;
  const setProfiles = (p: ModelProfile[]) => setSettings({ ...settings, profiles: p });
  const patch = (id: string, p: Partial<ModelProfile>) => setProfiles(profiles.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const verifyGemini = async () => {
    const key = keys.gemini;
    if (!key) return;
    setCheck({ state: 'busy' });
    try {
      const models = await listGeminiModels(key);
      setCheck({ state: 'ok', models, msg: `המפתח תקין. ${models.length} מודלים של Gemini זמינים לו.` });
    } catch (e) {
      setCheck({ state: 'fail', msg: e instanceof Error ? e.message : String(e) });
    }
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
                  {p === 'gemini' && (
                    <button type="button" className="btn btn-sm" disabled={!keys.gemini || check.state === 'busy'} onClick={verifyGemini}>
                      {check.state === 'busy' ? 'בודק…' : 'בדוק מפתח'}
                    </button>
                  )}
                </div>
                {p === 'gemini' && (check.state === 'ok' || check.state === 'fail') && (
                  <div className={`notice ${check.state === 'ok' ? 'good' : 'error'}`} role="status">{check.msg}</div>
                )}
                {p === 'gemini' && (
                  <p className="xsmall muted">
                    במכסה החינמית: מגבלת הבקשות לדקה וליום תלויה במודל ומוצגת ב-Google AI Studio. ערך נמוך כאן מאט את הריצה אבל חוסך שגיאות. כשהמכסה היומית נגמרת הריצה נעצרת, ואפשר להמשיך אותה כשהמכסה מתחדשת. בשכבה החינמית Google רשאית להשתמש בתוכן הבקשות לשיפור המוצרים שלה.
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
