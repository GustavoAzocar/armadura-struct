import { describe, expect, it } from 'vitest';
import { modelPoint, panCamera, zoomCamera } from '../src/lib/cadNavigation';
const size = { w: 1600, h: 1000 };
const camera = { x: 12345, y: -5432, s: 0.12 };
const anchor = { x: 312, y: 783 };
describe('CAD logical camera', () => {
  it('a long wheel burst conserves the model point under the cursor', () => {
    const fixed = modelPoint(camera, size, anchor);
    let next = camera;
    for (let i = 0; i < 200; i++) next = zoomCamera(next, size, anchor, -2);
    expect(next.s).toBeCloseTo(camera.s * Math.exp(0.6), 12);
    const actual = modelPoint(next, size, anchor);
    expect(actual.x).toBeCloseTo(fixed.x, 7);
    expect(actual.y).toBeCloseTo(fixed.y, 7);
  });
  it('wheel events with different anchors are reversible in reverse order', () => {
    let next = camera;
    const inputs = Array.from({ length: 80 }, (_, i) => ({
      anchor: { x: 100 + i * 12, y: 400 + Math.sin(i) * 100 },
      delta: 3,
    }));
    for (const e of inputs) next = zoomCamera(next, size, e.anchor, e.delta);
    for (const e of [...inputs].reverse())
      next = zoomCamera(next, size, e.anchor, -e.delta);
    expect(next.x).toBeCloseTo(camera.x, 7);
    expect(next.y).toBeCloseTo(camera.y, 7);
    expect(next.s).toBeCloseTo(camera.s, 12);
  });
  it('pan uses the release, without accumulating error across intermediate moves', () => {
    const from = { x: 600, y: 500 },
      release = { x: 840, y: 380 };
    for (let i = 0; i < 1000; i++) panCamera(camera, from, { x: i, y: i });
    const next = panCamera(camera, from, release);
    expect(next).toEqual({ x: 10345, y: -6432, s: 0.12 });
    expect(modelPoint(next, size, release)).toEqual(
      modelPoint(camera, size, from),
    );
  });
  it('scale bounds retain the cursor anchor', () => {
    for (const delta of [-1e7, 1e7]) {
      const next = zoomCamera(camera, size, anchor, delta);
      expect([0.000001, 20]).toContain(next.s);
      const a = modelPoint(camera, size, anchor),
        b = modelPoint(next, size, anchor);
      expect(b.x).toBeCloseTo(a.x, 5);
      expect(b.y).toBeCloseTo(a.y, 5);
    }
  });
});
