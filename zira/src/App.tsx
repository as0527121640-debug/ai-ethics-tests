import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RateLimiter } from './engine/errors';
import { createRun, SimRunner } from './engine/runner';
import type { ProviderId, Run, SimConfig } from './engine/types';
import type { GeoData } from './engine/world';
import { makeDecide } from './providers';
import { deleteRun, listRuns, loadRun, saveRun, type RunSummary } from './store/runs';
import { loadConfig, loadKeys, loadSettings, saveConfig, saveKeys, saveSettings, type Keys, type Settings } from './store/settings';
import { Globe, Key } from './ui/icons';
import { ModelsScreen } from './ui/ModelsScreen';
import { ReportScreen } from './ui/ReportScreen';
import { RunScreen } from './ui/RunScreen';
import { SetupScreen } from './ui/SetupScreen';

export type Route = 'setup' | 'run' | 'report' | 'models';
const ROUTES: Route[] = ['setup', 'run', 'report', 'models'];

function useRoute(): [Route, (r: Route) => void] {
  const parse = (): Route => {
    const r = window.location.hash.replace(/^#\/?/, '') as Route;
    return ROUTES.includes(r) ? r : 'setup';
  };
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (r) => { window.location.hash = `/${r}`; }];
}

const NAV: { route: Route; n: string; label: string }[] = [
  { route: 'setup', n: '01', label: 'הגדרה' },
  { route: 'run', n: '02', label: 'הרצה' },
  { route: 'report', n: '03', label: 'ניתוח' },
];

export default function App() {
  const [route, go] = useRoute();
  const [geo, setGeo] = useState<GeoData | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [keys, setKeys] = useState<Keys>(loadKeys);
  const [config, setConfig] = useState<SimConfig>(loadConfig);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [current, setCurrent] = useState<Run | null>(null);
  const [, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const runnerRef = useRef<SimRunner | null>(null);
  const keysRef = useRef(keys);
  const rpmRef = useRef(settings.rpm);
  const limiters = useRef(new Map<ProviderId, RateLimiter>());
  keysRef.current = keys;
  rpmRef.current = settings.rpm;

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}world-he.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setGeo)
      .catch(() => setGeoFailed(true));
    listRuns().then(setRuns);
  }, []);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveConfig(config), [config]);
  useEffect(() => saveKeys(keys, settings.rememberKeys), [keys, settings.rememberKeys]);

  const geoById = useMemo(() => Object.fromEntries((geo?.countries ?? []).map((c) => [c.id, c])), [geo]);
  const running = runnerRef.current !== null;

  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  const limiterFor = useCallback((p: ProviderId) => {
    let l = limiters.current.get(p);
    if (!l) {
      l = new RateLimiter(rpmRef.current[p]);
      limiters.current.set(p, l);
    }
    l.rpm = rpmRef.current[p];
    return l;
  }, []);

  const refresh = () => setTick((t) => t + 1);

  const resume = useCallback(
    async (run: Run) => {
      if (runnerRef.current) return;
      const runner = new SimRunner(run, {
        decide: makeDecide((p) => keysRef.current[p]),
        geo: geoById,
        limiter: limiterFor,
        save: async (r) => {
          await saveRun(r);
          setRuns(await listRuns());
        },
        onChange: refresh,
        onNotice: setNotice,
      });
      runnerRef.current = runner;
      setCurrent(run);
      refresh();
      try {
        await runner.start();
      } finally {
        runnerRef.current = null;
        setRuns(await listRuns());
        refresh();
      }
    },
    [geoById, limiterFor],
  );

  const start = useCallback(async () => {
    if (runnerRef.current || !geo) return;
    const run = createRun({ ...config, seed: Math.floor(Math.random() * 1e9) }, settings.profiles, geoById);
    await saveRun(run);
    setRuns(await listRuns());
    setCurrent(run);
    go('run');
    void resume(run);
  }, [config, settings.profiles, geo, geoById, go, resume]);

  const open = useCallback(async (id: string) => {
    if (runnerRef.current?.run.id === id) return setCurrent(runnerRef.current.run);
    setCurrent((await loadRun(id)) ?? null);
  }, []);

  const stopPaused = useCallback(async (run: Run) => {
    run.status = 'stopped';
    run.statusNote = undefined;
    await saveRun(run);
    setRuns(await listRuns());
    refresh();
  }, []);

  const remove = useCallback(async (id: string) => {
    if (runnerRef.current?.run.id === id) return;
    await deleteRun(id);
    setRuns(await listRuns());
    setCurrent((c) => (c?.id === id ? null : c));
  }, []);

  // Show the latest run by default on the run and report screens.
  useEffect(() => {
    if (!current && runs.length && (route === 'run' || route === 'report')) void open(runs[0].id);
  }, [current, runs, route, open]);

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/setup">
          <Globe />
          <span>
            <strong>זירה</strong>
            <span>סימולטור גאופוליטי למודלי שפה</span>
          </span>
        </a>
        <nav className="nav" aria-label="ניווט ראשי">
          {NAV.map((n) => (
            <a key={n.route} href={`#/${n.route}`} aria-current={route === n.route ? 'page' : undefined}>
              <span className="mono">{n.n}</span>
              {n.label}
            </a>
          ))}
          <a href="#/models" aria-current={route === 'models' ? 'page' : undefined}>
            <Key />
            מודלים ומפתחות
          </a>
        </nav>
      </header>
      <main className="container">
        {geoFailed && <div className="notice error">לא הצלחנו לטעון את מפת העולם. נסה לרענן את הדף.</div>}
        {route === 'setup' && (
          <SetupScreen
            geo={geo}
            config={config}
            setConfig={setConfig}
            profiles={settings.profiles}
            keys={keys}
            rpm={settings.rpm}
            rpd={settings.rpd}
            running={running}
            onStart={start}
          />
        )}
        {route === 'models' && <ModelsScreen settings={settings} setSettings={setSettings} keys={keys} setKeys={setKeys} />}
        {route === 'run' && (
          <RunScreen
            geo={geo}
            run={current}
            runs={runs}
            live={running && runnerRef.current?.run.id === current?.id}
            busy={running}
            notice={notice}
            onOpen={open}
            onPause={() => runnerRef.current?.pause()}
            onStop={() => (runnerRef.current ? runnerRef.current.stop() : current && stopPaused(current))}
            onResume={() => current && resume(current)}
          />
        )}
        {route === 'report' && <ReportScreen geo={geo} run={current} runs={runs} onOpen={open} onDelete={remove} locked={running ? runnerRef.current?.run.id : undefined} />}
      </main>
    </>
  );
}
