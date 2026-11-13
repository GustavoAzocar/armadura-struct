import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  installCadDiagnostics,
  measureCadWork,
  recordCadWork,
  setCadDiagnosticScene,
} from '../src/lib/cadDiagnostics';
let dispose: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
  vi.stubGlobal('navigator', { userAgent: 'diagnostic test' });
  vi.stubGlobal('innerWidth', 1600);
  vi.stubGlobal('innerHeight', 1000);
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 0),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  dispose = installCadDiagnostics();
});
afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('stays inactive by default; a bounded capture stops recording and retains no project contents', () => {
  recordCadWork('ignored', 10);
  expect(window.armaduraCadDiagnostics!.snapshot()).toBeNull();
  setCadDiagnosticScene({
    bars: 400,
    representations: 400,
    masks: 1,
    maskPrimitives: 20000,
  });
  window.armaduraCadDiagnostics!.start();
  for (let i = 0; i < 3000; i++) recordCadWork('pointer', 2);
  expect(measureCadWork('operation', () => 42)).toBe(42);
  const result = window.armaduraCadDiagnostics!.stop()!;
  expect(result.sceneAtStart.maskPrimitives).toBe(20000);
  expect(result.metrics.pointer).toMatchObject({
    count: 3000,
    retained: 2048,
    dropped: 952,
    p95Ms: 2,
    totalMs: 6000,
  });
  recordCadWork('pointer', 1000);
  expect(window.armaduraCadDiagnostics!.snapshot()!.metrics.pointer.count).toBe(
    3000,
  );
  expect(cancelAnimationFrame).toHaveBeenCalledWith(0);
  expect(JSON.stringify(result)).not.toMatch(
    /fileName|projectName|origin|token|email/,
  );
});
it('limits recording to at most a minute, isolates sessions, and cleans up on unmount', () => {
  window.armaduraCadDiagnostics!.start(Infinity);
  vi.advanceTimersByTime(10000);
  recordCadWork('late', 1);
  expect(
    window.armaduraCadDiagnostics!.snapshot()!.metrics.late,
  ).toBeUndefined();
  window.armaduraCadDiagnostics!.start(999999);
  recordCadWork('new', 5);
  vi.advanceTimersByTime(60000);
  recordCadWork('new', 99);
  expect(window.armaduraCadDiagnostics!.snapshot()!.metrics.new.count).toBe(1);
  dispose();
  expect(window.armaduraCadDiagnostics).toBeUndefined();
});
