import { useState } from 'react';
import { fmtNum } from './format';

export interface Series {
  id: string;
  label: string;
  color: string;
  values: (number | null)[];
}

const PW = 600;
const PH = 240;

function niceStep(range: number): number {
  const raw = range / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/**
 * Line chart with a crosshair tooltip, direct end labels and a table view.
 * Time runs left to right even inside the RTL page, as is usual for data.
 */
export function LineChart({ series, count, xLabel = 'תור' }: { series: Series[]; count: number; xLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const N = Math.max(1, count);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const lo = Math.min(0, ...all);
  const hiRaw = Math.max(1, ...all);
  const step = niceStep(hiRaw - lo);
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hiRaw / step) * step;
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);

  const px = (i: number) => (N > 1 ? (i / (N - 1)) * PW : PW / 2);
  const py = (v: number) => PH - ((v - yMin) / (yMax - yMin || 1)) * PH;
  const pct = (i: number) => (px(i) / PW) * 100;

  const path = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  const ends = series
    .map((s) => {
      const i = s.values.map((v, k) => (v == null ? -1 : k)).filter((k) => k >= 0).pop();
      return i == null ? null : { id: s.id, label: s.label, color: s.color, v: s.values[i]!, top: py(s.values[i]!) };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.top - b.top);
  for (let i = 1; i < ends.length; i++) if (ends[i].top - ends[i - 1].top < 20) ends[i].top = ends[i - 1].top + 20;

  const xTicks = N <= 12
    ? Array.from({ length: N }, (_, i) => i)
    : Array.from(new Set([0, 1, 2, 3, 4].map((k) => Math.round((k * (N - 1)) / 4))));
  const colW = N > 1 ? 100 / (N - 1) : 100;
  const hoverRows = hover == null ? [] : series
    .map((s) => ({ ...s, v: s.values[hover] }))
    .filter((s): s is typeof s & { v: number } => s.v != null)
    .sort((a, b) => b.v - a.v);

  return (
    <div className="stack">
      <div className="wrap" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="chip" aria-pressed={table} onClick={() => setTable(!table)}>
          {table ? 'הצג כגרף' : 'הצג כטבלה'}
        </button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">סדרה</th>
                {Array.from({ length: N }, (_, i) => <th key={i} scope="col" className="num">{i + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.label}</th>
                  {Array.from({ length: N }, (_, i) => <td key={i} className="num">{s.values[i] == null ? '–' : fmtNum(s.values[i]!)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="chart">
            <div className="yaxis">
              {ticks.map((t) => <span key={t} style={{ top: `${(py(t) / PH) * 100}%` }}>{fmtNum(t)}</span>)}
            </div>
            <div className="plot" onMouseLeave={() => setHover(null)}>
              <svg viewBox={`0 0 ${PW} ${PH}`} preserveAspectRatio="none" aria-hidden="true">
                {ticks.map((t) => (
                  <path key={t} d={`M0,${py(t).toFixed(1)}H${PW}`} stroke={t === 0 ? '#c3c2b7' : '#e3e1da'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}
                {series.map((s) => (
                  <path key={s.id} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
              {series.map((s) =>
                s.values.filter((v) => v != null).length === 1
                  ? s.values.map((v, i) => v == null ? null : <span key={`${s.id}${i}`} className="dot" style={{ left: `${pct(i)}%`, top: `${(py(v) / PH) * 100}%`, background: s.color }} />)
                  : null,
              )}
              {hover != null && <div className="cross" style={{ left: `${pct(hover)}%` }} />}
              {hoverRows.map((s) => (
                <span key={s.id} className="dot" style={{ left: `${pct(hover!)}%`, top: `${(py(s.v) / PH) * 100}%`, background: s.color }} />
              ))}
              {Array.from({ length: N }, (_, i) => (
                <div
                  key={i}
                  className="hit"
                  style={{ left: `${Math.max(0, pct(i) - colW / 2)}%`, width: `${i === 0 || i === N - 1 ? colW / 2 : colW}%` }}
                  onMouseEnter={() => setHover(i)}
                />
              ))}
              {hover != null && hoverRows.length > 0 && (
                <div className="tip" style={hover > (N - 1) / 2 ? { right: `${100 - pct(hover) + 2}%` } : { left: `${pct(hover) + 2}%` }}>
                  <strong>{xLabel} {hover + 1}</strong>
                  {hoverRows.map((s) => (
                    <span key={s.id} className="between" style={{ gap: 16 }}>
                      <span className="inline" style={{ gap: 6 }}><span className="swatch sq" style={{ background: s.color }} />{s.label}</span>
                      <span className="mono" dir="ltr">{fmtNum(s.v)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="ends">
              {ends.map((e) => (
                <span key={e.id} className="end" style={{ top: e.top }}>
                  <span className="swatch" style={{ background: e.color, width: 8, height: 8 }} />
                  {e.label} <span className="mono ink2" dir="ltr">{fmtNum(e.v)}</span>
                </span>
              ))}
            </div>
            <span />
            <div className="xaxis">
              {xTicks.map((i) => <span key={i} style={{ left: `${pct(i)}%` }}>{i + 1}</span>)}
            </div>
            <span />
          </div>
          <span className="xsmall muted" style={{ textAlign: 'center' }}>{xLabel}</span>
        </>
      )}
    </div>
  );
}
