import { version } from '../../package.json';

type Metric = { values: number[]; count: number; total: number; max: number };
type Scene = {
  bars: number;
  representations: number;
  masks: number;
  maskPrimitives: number;
};
type Session = {
  started: number;
  ended?: number;
  metrics: Map<string, Metric>;
  scene: Scene;
};
const limit = 2048;
let session: Session | undefined;
let scene: Scene = { bars: 0, representations: 0, masks: 0, maskPrimitives: 0 };

export function setCadDiagnosticScene(counts: Scene) {
  scene = counts;
}
export function cadDiagnosticNow() {
  return session && session.ended === undefined ? performance.now() : undefined;
}
export function recordCadWork(name: string, ms: number) {
  if (!session || session.ended !== undefined || !Number.isFinite(ms) || ms < 0)
    return;
  if (!session.metrics.has(name)) {
    if (session.metrics.size >= 24) return;
    session.metrics.set(name, { values: [], count: 0, total: 0, max: 0 });
  }
  const metric = session.metrics.get(name)!;
  if (metric.values.length < limit) metric.values.push(ms);
  metric.count++;
  metric.total += ms;
  metric.max = Math.max(metric.max, ms);
}
export function measureCadWork<T>(name: string, run: () => T): T {
  const started = cadDiagnosticNow();
  if (started === undefined) return run();
  try {
    return run();
  } finally {
    recordCadWork(name, performance.now() - started);
  }
}

function snapshot() {
  if (!session) return null;
  return {
    version,
    build: import.meta.env.MODE,
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    durationMs: (session.ended ?? performance.now()) - session.started,
    sceneAtStart: { ...session.scene },
    sceneNow: { ...scene },
    note: 'Local timings only. Frames are rAF opportunities; feedback ends at JS publication, not physical display. No CPU/GPU utilization or thermal measurement.',
    metrics: Object.fromEntries(
      [...session.metrics].map(([name, m]) => {
        const sorted = [...m.values].sort((a, b) => a - b);
        return [
          name,
          {
            count: m.count,
            retained: sorted.length,
            dropped: m.count - sorted.length,
            medianMs: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
            p95Ms:
              sorted[
                Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
              ] ?? 0,
            maxMs: m.max,
            totalMs: m.total,
            samplesMs: [...m.values],
          },
        ];
      }),
    ),
  };
}
export type CadDiagnostics = {
  start: (durationMs?: number) => void;
  stop: () => ReturnType<typeof snapshot>;
  snapshot: typeof snapshot;
};
declare global {
  interface Window {
    armaduraCadDiagnostics?: CadDiagnostics;
  }
}

/** Opt-in, bounded, in-memory diagnostics. Nothing is persisted or sent. */
export function installCadDiagnostics() {
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: PerformanceObserver | undefined;
  const stop = () => {
    if (session && session.ended === undefined)
      session.ended = performance.now();
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    if (timer !== undefined) clearTimeout(timer);
    observer?.disconnect();
    observer = undefined;
    return snapshot();
  };
  const api: CadDiagnostics = {
    start(durationMs = 10000) {
      stop();
      session = {
        started: performance.now(),
        metrics: new Map(),
        scene: { ...scene },
      };
      const recording = session;
      let previous: number | undefined;
      const tick = (now: number) => {
        if (session !== recording || recording.ended !== undefined) return;
        if (previous !== undefined) recordCadWork('frame', now - previous);
        previous = now;
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      const duration = Number.isFinite(durationMs)
        ? Math.max(1000, Math.min(60000, durationMs))
        : 10000;
      timer = setTimeout(stop, duration);
      if (typeof PerformanceObserver !== 'undefined') {
        try {
          observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
              recordCadWork('longTask', entry.duration);
          });
          observer.observe({ entryTypes: ['longtask'] });
        } catch {
          observer = undefined;
        }
      }
    },
    stop,
    snapshot,
  };
  window.armaduraCadDiagnostics = api;
  return () => {
    stop();
    session = undefined;
    if (window.armaduraCadDiagnostics === api)
      delete window.armaduraCadDiagnostics;
  };
}
