import { del, get, set } from 'idb-keyval';
import type { Run, RunStatus } from '../engine/types';

export interface RunSummary {
  id: string;
  name: string;
  createdAt: number;
  status: RunStatus;
  turnsDone: number;
  totalTurns: number;
}

const INDEX = 'runs:index';
const runKey = (id: string) => `run:${id}`;

// IndexedDB can be unavailable (private windows, blocked site data); runs then
// live in memory for this tab only.
const memory = new Map<string, unknown>();
let idbOk = true;

async function getItem<T>(key: string): Promise<T | undefined> {
  if (idbOk) {
    try {
      return await get<T>(key);
    } catch {
      idbOk = false;
    }
  }
  return memory.get(key) as T | undefined;
}

async function setItem(key: string, value: unknown): Promise<void> {
  if (idbOk) {
    try {
      await set(key, value);
      return;
    } catch {
      idbOk = false;
    }
  }
  memory.set(key, value);
}

async function delItem(key: string): Promise<void> {
  memory.delete(key);
  if (idbOk) {
    try {
      await del(key);
    } catch {
      idbOk = false;
    }
  }
}

export function summarize(run: Run): RunSummary {
  return {
    id: run.id,
    name: run.config.name,
    createdAt: run.createdAt,
    status: run.status,
    turnsDone: run.turns.length,
    totalTurns: run.config.turns * run.config.repeats,
  };
}

export async function listRuns(): Promise<RunSummary[]> {
  return ((await getItem<RunSummary[]>(INDEX)) ?? []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveRun(run: Run): Promise<void> {
  await setItem(runKey(run.id), run);
  const index = (await getItem<RunSummary[]>(INDEX)) ?? [];
  await setItem(INDEX, [summarize(run), ...index.filter((r) => r.id !== run.id)]);
}

export async function loadRun(id: string): Promise<Run | undefined> {
  const run = await getItem<Run>(runKey(id));
  // A run saved as "running" was cut off by a closed tab; it can be resumed.
  if (run?.status === 'running') {
    run.status = 'paused';
    run.statusNote = 'הריצה נקטעה כשהדף נסגר. אפשר להמשיך מהתור האחרון שנשמר.';
  }
  return run;
}

export async function deleteRun(id: string): Promise<void> {
  await delItem(runKey(id));
  const index = (await getItem<RunSummary[]>(INDEX)) ?? [];
  await setItem(INDEX, index.filter((r) => r.id !== id));
}
