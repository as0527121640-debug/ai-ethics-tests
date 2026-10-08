// Builds public/world-he.json: Natural Earth 1:110m countries, projected with
// Equal Earth into a 1000-unit-wide frame, with Hebrew names, centroids and
// the population / GDP fields used as starting data.
//
//   node scripts/build-world.mjs [path/to/ne_110m_admin_0_countries.geojson]
//
// Without an argument the source is downloaded from the Natural Earth repo.
import { readFile, writeFile } from 'node:fs/promises';

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const OUT = new URL('../public/world-he.json', import.meta.url);

const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const XMAX = 2.7064, YMAX = 1.3173;
const WIDTH = 1000;
const SCALE = WIDTH / (2 * XMAX);

function project(lon, lat) {
  const lam = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const th = Math.asin(M * Math.sin(phi));
  const t2 = th * th, t6 = t2 * t2 * t2;
  const x = (2 * Math.sqrt(3) * lam * Math.cos(th)) / (3 * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [(x + XMAX) * SCALE, (YMAX - y) * SCALE];
}

const round1 = (v) => Math.round(v * 10) / 10;

function ringPath(ring) {
  const pts = [];
  for (const [lon, lat] of ring) {
    const [x, y] = project(lon, lat);
    const p = [round1(x), round1(y)];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  if (pts.length < 3) return null;
  return { d: 'M' + pts.map(([x, y]) => `${x},${y}`).join(' L') + 'Z', pts };
}

function areaCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  if (Math.abs(a) < 1e-9) return { area: 0, c: pts[0] };
  return { area: Math.abs(a / 2), c: [cx / (3 * a), cy / (3 * a)] };
}

const CONT_HE = {
  Africa: 'אפריקה', Asia: 'אסיה', Europe: 'אירופה', 'North America': 'צפון אמריקה',
  'South America': 'דרום אמריקה', Oceania: 'אוקיאניה',
};
// Natural Earth's Hebrew names are formal; the UI needs the everyday ones.
const SHORT_HE = {
  CHN: 'סין', COD: 'קונגו (קינשאסה)', COG: 'קונגו (ברזוויל)', CAF: 'מרכז אפריקה',
  DOM: 'הרפ׳ הדומיניקנית', ARE: 'איחוד האמירויות', CYN: 'צפון קפריסין', PSX: 'הרשות הפלסטינית',
};
// Countries whose overseas parts would stretch a continent's bounding box.
const SKIP_IN_REGION_BOX = new Set(['RUS', 'FRA', 'USA', 'NZL', 'FJI']);

const src = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], 'utf8'))
  : await (await fetch(SOURCE_URL)).json();

const countries = [];
const boxes = {};
for (const f of src.features) {
  const p = f.properties;
  if (p.CONTINENT === 'Antarctica' || p.CONTINENT === 'Seven seas (open ocean)') continue;
  const g = f.geometry;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  const parts = [];
  let best = { area: 0, c: null };
  const xs = [], ys = [];
  for (const poly of polys) {
    poly.forEach((ring, k) => {
      const r = ringPath(ring);
      if (!r) return;
      parts.push(r.d);
      if (k === 0) {
        const ac = areaCentroid(r.pts);
        if (ac.area > best.area) best = ac;
        for (const [x, y] of r.pts) { xs.push(x); ys.push(y); }
      }
    });
  }
  if (!SKIP_IN_REGION_BOX.has(p.ADM0_A3)) {
    const b = (boxes[p.CONTINENT] ??= [Infinity, Infinity, -Infinity, -Infinity]);
    b[0] = Math.min(b[0], ...xs); b[1] = Math.min(b[1], ...ys);
    b[2] = Math.max(b[2], ...xs); b[3] = Math.max(b[3], ...ys);
  }
  countries.push({
    id: p.ADM0_A3,
    he: SHORT_HE[p.ADM0_A3] ?? p.NAME_HE ?? p.NAME,
    en: p.NAME,
    cont: CONT_HE[p.CONTINENT] ?? p.CONTINENT,
    pop: p.POP_EST,
    gdp: p.GDP_MD,
    cx: round1(best.c[0]),
    cy: round1(best.c[1]),
    d: parts.join(''),
  });
}
countries.sort((a, b) => a.he.localeCompare(b.he, 'he'));
const regions = Object.entries(boxes).map(([k, b]) => ({ name: CONT_HE[k], box: b.map(round1) }));

await writeFile(
  OUT,
  JSON.stringify({
    source: 'Natural Earth 1:110m (public domain), Equal Earth projection, 1000 wide',
    width: WIDTH,
    height: round1(2 * YMAX * SCALE),
    regions,
    countries,
  }),
);
console.log(`${countries.length} countries → ${OUT.pathname}`);
