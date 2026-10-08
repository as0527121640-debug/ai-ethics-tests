import { useId, useMemo } from 'react';
import type { GeoData } from '../engine/world';

export type ArcKind = 'diplo' | 'econ' | 'intel' | 'mil' | 'nuke';
export interface Arc {
  from: string;
  to: string;
  kind: ArcKind;
}

const ARC_STYLE: Record<ArcKind, { stroke: string; width: number; dash?: string; marker: 'ink' | 'gray' | 'red' }> = {
  diplo: { stroke: '#17171b', width: 1.5, marker: 'ink' },
  econ: { stroke: '#4f4d48', width: 1.5, dash: '5 4', marker: 'gray' },
  intel: { stroke: '#17171b', width: 1.5, dash: '1.5 3.5', marker: 'ink' },
  mil: { stroke: '#b3261e', width: 3, marker: 'red' },
  nuke: { stroke: '#b3261e', width: 5, marker: 'red' },
};
const ARC_RANK: Record<ArcKind, number> = { intel: 0, diplo: 1, econ: 2, mil: 3, nuke: 4 };

export const ARC_LEGEND: { kind: ArcKind; label: string }[] = [
  { kind: 'diplo', label: 'דיפלומטיה' },
  { kind: 'econ', label: 'כלכלה' },
  { kind: 'intel', label: 'מודיעין (שנחשף)' },
  { kind: 'mil', label: 'צבאי' },
  { kind: 'nuke', label: 'גרעיני' },
];

export function ArcSwatch({ kind }: { kind: ArcKind }) {
  const s = ARC_STYLE[kind];
  return (
    <svg width="28" height="8" aria-hidden="true">
      <path d="M0 4h28" stroke={s.stroke} strokeWidth={Math.min(s.width, 4)} strokeDasharray={s.dash} />
    </svg>
  );
}

const ME = ['TUR', 'EGY', 'IRN', 'SAU', 'YEM', 'IRQ', 'SYR', 'ISR', 'JOR', 'OMN', 'ARE', 'LBN', 'KWT', 'QAT', 'CYP'];
export const MIDDLE_EAST = 'המזרח התיכון';
export const REGION_ORDER = ['all', 'אירופה', MIDDLE_EAST, 'אסיה', 'אפריקה', 'צפון אמריקה', 'דרום אמריקה', 'אוקיאניה'];

/** A frame around `box` with the map's own aspect ratio, so HTML labels map linearly. */
function frame(box: number[], W: number, H: number, pad: number): number[] {
  let w = box[2] - box[0] + pad * 2;
  let h = box[3] - box[1] + pad * 2;
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  const ar = W / H;
  if (w / h > ar) h = w / ar;
  else w = h * ar;
  return [cx - w / 2, cy - h / 2, w, h];
}

interface Props {
  geo: GeoData | null;
  fills: Record<string, string>;
  labels?: string[];
  region?: string;
  /** Frame these countries instead of a region. */
  focus?: string[];
  hovered?: string | null;
  onHover?: (id: string | null) => void;
  onClick?: (id: string) => void;
  arcs?: Arc[];
  ariaLabel: string;
}

export function WorldMap({ geo, fills, labels = [], region = 'all', focus, hovered, onHover, onClick, arcs = [], ariaLabel }: Props) {
  const uid = useId().replace(/:/g, '');
  const byId = useMemo(() => Object.fromEntries((geo?.countries ?? []).map((c) => [c.id, c])), [geo]);
  const W = geo?.width ?? 1000;
  const H = geo?.height ?? 486.7;

  const vb = useMemo(() => {
    if (!geo) return [0, 0, W, H];
    const centroids = (ids: string[]) => ids.map((id) => byId[id]).filter(Boolean);
    if (focus && focus.length) {
      const cs = centroids(focus);
      if (cs.length) {
        const xs = cs.map((c) => c.cx);
        const ys = cs.map((c) => c.cy);
        return frame([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], W, H, 60);
      }
    }
    if (region === MIDDLE_EAST) {
      const cs = centroids(ME);
      const xs = cs.map((c) => c.cx);
      const ys = cs.map((c) => c.cy);
      return frame([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], W, H, 20);
    }
    const r = geo.regions.find((x) => x.name === region);
    return r ? frame(r.box, W, H, 12) : [0, 0, W, H];
  }, [geo, byId, region, focus, W, H]);

  const arcPaths = useMemo(() => {
    const best = new Map<string, Arc>();
    for (const a of arcs) {
      if (a.from === a.to || !byId[a.from] || !byId[a.to]) continue;
      const k = `${a.from}>${a.to}`;
      const cur = best.get(k);
      if (!cur || ARC_RANK[a.kind] > ARC_RANK[cur.kind]) best.set(k, a);
    }
    return [...best.values()]
      .sort((a, b) => ARC_RANK[a.kind] - ARC_RANK[b.kind])
      .map((a) => {
        const p = byId[a.from];
        const q = byId[a.to];
        let x1 = p.cx, y1 = p.cy, x2 = q.cx, y2 = q.cy;
        const dx = x2 - x1, dy = y2 - y1;
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L;
        const trim = Math.min(10, L / 4);
        x1 += ux * trim; y1 += uy * trim; x2 -= ux * trim; y2 -= uy * trim;
        const bend = 0.2;
        const qx = (x1 + x2) / 2 - uy * L * bend;
        const qy = (y1 + y2) / 2 + ux * L * bend;
        return { key: `${a.from}>${a.to}`, d: `M${x1.toFixed(1)},${y1.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`, s: ARC_STYLE[a.kind] };
      });
  }, [arcs, byId]);

  const labelPos = labels
    .map((id) => byId[id])
    .filter(Boolean)
    .map((c) => ({ id: c.id, name: c.he, left: ((c.cx - vb[0]) / vb[2]) * 100, top: ((c.cy - vb[1]) / vb[3]) * 100 }))
    .filter((l) => l.left > 1 && l.left < 99 && l.top > 1 && l.top < 99);

  return (
    <div className="map" role="img" aria-label={ariaLabel} onMouseLeave={() => onHover?.(null)}>
      {!geo && <div className="loading">טוען מפה…</div>}
      {geo && (
        <svg viewBox={vb.map((v) => v.toFixed(1)).join(' ')} aria-hidden="true">
          <defs>
            {(['ink', 'gray', 'red'] as const).map((m) => (
              <marker key={m} id={`${uid}-${m}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9 z" fill={m === 'ink' ? '#17171b' : m === 'gray' ? '#4f4d48' : '#b3261e'} />
              </marker>
            ))}
          </defs>
          {geo.countries.map((c) => (
            <path
              key={c.id}
              d={c.d}
              className={`country${onClick ? ' clickable' : ''}${hovered === c.id ? ' hover' : ''}`}
              style={{ fill: fills[c.id] ?? (hovered === c.id ? 'var(--land-hover)' : 'var(--land)') }}
              onClick={onClick ? () => onClick(c.id) : undefined}
              onMouseEnter={onHover ? () => onHover(c.id) : undefined}
            />
          ))}
          {arcPaths.map((a) => (
            <path
              key={a.key}
              d={a.d}
              fill="none"
              stroke={a.s.stroke}
              strokeWidth={a.s.width}
              strokeDasharray={a.s.dash}
              vectorEffect="non-scaling-stroke"
              markerEnd={`url(#${uid}-${a.s.marker})`}
              style={{ pointerEvents: 'none' }}
            />
          ))}
        </svg>
      )}
      {labelPos.map((l) => (
        <span key={l.id} className="label" style={{ left: `${l.left}%`, top: `${l.top}%` }}>
          {l.name}
        </span>
      ))}
    </div>
  );
}
