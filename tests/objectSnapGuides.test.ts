import { describe, expect, it } from 'vitest';
import {
  createSnapIndex,
  defaultSnapModes,
  maskSnapSource,
  resolveObjectSnap,
  type SnapModes,
} from '../src/domain/objectSnaps';
import {
  acquireSnapGuides,
  snapGuideCandidates,
  snapGuidePath,
} from '../src/domain/objectSnapGuides';
import { pathCurve, roundCurve, TAU } from '../src/domain/maskCadGeometry';
import { nativePrimitive, newNativeMask } from '../src/domain/nativeMasks';
import { maskPoint } from '../src/cad/import';
import type { Point } from '../src/domain/types';

const modes = (...active: (keyof SnapModes)[]): SnapModes =>
  Object.fromEntries(
    Object.keys(defaultSnapModes).map((k) => [
      k,
      active.includes(k as keyof SnapModes),
    ]),
  ) as SnapModes;
const options = (active: (keyof SnapModes)[] = ['extension', 'parallel']) => ({
  enabled: true,
  active: true,
  modes: modes(...active),
  tolerance: 10,
  base: { x: 20, y: 30 },
  linear: true,
});
const curve = pathCurve(
  [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  false,
);
const index = createSnapIndex([{ id: 'line', curve }]);
const close = (p: Point | undefined, target: Point) => {
  expect(p).toBeDefined();
  expect(p!.x).toBeCloseTo(target.x, 6);
  expect(p!.y).toBeCloseTo(target.y, 6);
};

describe('guias temporárias · #165', () => {
  it('estende o extremo adquirido (100,0) até (130,0) junto ao cursor (130,3)', () => {
    const opt = options(['extension']);
    const refs = acquireSnapGuides(index, { x: 100, y: 0 }, {}, opt);
    expect(refs.extension).toEqual({ id: 'line:0', end: 1 });
    const raw = { x: 130, y: 3 };
    const guides = snapGuideCandidates(index, refs, raw, opt);
    close(guides[0].point, { x: 130, y: 0 });
    expect(snapGuidePath(guides[0].guide!)).toBe('M100,0 L130,0');
    close(resolveObjectSnap(index, raw, { ...opt, guides }).candidate?.point, {
      x: 130,
      y: 0,
    });
    expect(snapGuideCandidates(index, refs, { x: 90, y: 3 }, opt)).toEqual([]);
    expect(curve.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });
  it('o extremo inicial prolonga na direção oposta, sem guia anterior à aquisição', () => {
    const opt = options(['extension']);
    const raw = { x: -30, y: 3 };
    expect(snapGuideCandidates(index, {}, raw, opt)).toEqual([]);
    const refs = acquireSnapGuides(index, { x: 0, y: 0 }, {}, opt);
    close(snapGuideCandidates(index, refs, raw, opt)[0].point, {
      x: -30,
      y: 0,
    });
  });
  it.each([1, -1])(
    'continua arco com varredura de sinal %s e rejeita retorno sobre o arco',
    (sign) => {
      const c = roundCurve({ x: 0, y: 0 }, 100, 0, (sign * Math.PI) / 2);
      const idx = createSnapIndex([{ id: 'arc', curve: c }]);
      const opt = options(['extension']);
      const refs = acquireSnapGuides(idx, { x: 0, y: sign * 100 }, {}, opt);
      const raw = { x: -50, y: sign * Math.sqrt(7500) };
      const target = snapGuideCandidates(idx, refs, raw, opt)[0];
      close(target.point, raw);
      expect(target.guide!.kind).toBe('round');
      if (target.guide!.kind === 'round')
        expect(Math.sign(target.guide!.sweep)).toBe(sign);
      expect(
        snapGuideCandidates(idx, refs, { x: 70, y: sign * 70 }, opt),
      ).toEqual([]);
      const start = acquireSnapGuides(idx, { x: 100, y: 0 }, {}, opt);
      close(
        snapGuideCandidates(idx, start, { x: 0, y: -sign * 100 }, opt)[0].point,
        { x: 0, y: -sign * 100 },
      );
    },
  );
  it('círculos fechados não têm extremo e não oferecem extensão', () => {
    const idx = createSnapIndex([
      { id: 'circle', curve: roundCurve({ x: 0, y: 0 }, 100, 0, TAU, true) },
    ]);
    expect(acquireSnapGuides(idx, { x: 100, y: 0 }, {}, options())).toEqual({});
  });
  it('paralelo passa pela base (20,30), mesmo após afastar o cursor da referência', () => {
    const opt = options(['parallel']);
    const refs = acquireSnapGuides(index, { x: 40, y: 2 }, {}, opt);
    const raw = { x: 140, y: 33 };
    expect(acquireSnapGuides(index, raw, refs, opt)).toEqual(refs);
    const target = snapGuideCandidates(index, refs, raw, opt)[0];
    close(target.point, { x: 140, y: 30 });
    expect(snapGuidePath(target.guide!)).toBe('M20,30 L140,30');
    expect(snapGuideCandidates(index, {}, raw, opt)).toEqual([]);
  });
  it('paralelo exige base efetiva e comando linear', () => {
    for (const opt of [
      { ...options(), base: undefined },
      { ...options(), linear: false },
    ]) {
      const refs = acquireSnapGuides(index, { x: 40, y: 0 }, {}, opt);
      expect(refs.parallel).toBeUndefined();
      expect(
        snapGuideCandidates(
          index,
          { parallel: { id: 'line:0' } },
          { x: 140, y: 33 },
          opt,
        ),
      ).toEqual([]);
    }
  });
  it('F3, cancelamento, modos desligados e referência indisponível invalidam a aquisição', () => {
    const opt = options();
    const refs = acquireSnapGuides(index, { x: 100, y: 0 }, {}, opt);
    expect(refs.extension).toBeDefined();
    expect(refs.parallel).toBeDefined();
    for (const invalid of [
      { ...opt, enabled: false },
      { ...opt, active: false },
      { ...opt, modes: modes() },
    ]) {
      expect(acquireSnapGuides(index, { x: 130, y: 3 }, refs, invalid)).toEqual(
        {},
      );
      expect(
        snapGuideCandidates(index, refs, { x: 130, y: 3 }, invalid),
      ).toEqual([]);
    }
    const empty = createSnapIndex([]);
    expect(acquireSnapGuides(empty, { x: 130, y: 3 }, refs, opt)).toEqual({});
    expect(snapGuideCandidates(empty, refs, { x: 130, y: 3 }, opt)).toEqual([]);
  });
  it('adquire a direção transformada da máscara uma vez e mantém a abertura de captura', () => {
    const mask = {
      ...newNativeMask('DXF'),
      format: 'DXF' as const,
      rotation: 37,
      scale: 2,
      origin: { x: 3000, y: 100 },
    };
    const primitive = nativePrimitive(
      { kind: 'line', points: curve.points, closed: false },
      'reference',
    );
    const idx = createSnapIndex([maskSnapSource(mask, primitive, 0)]);
    const opt = {
      ...options(['parallel']),
      base: maskPoint({ x: 20, y: 30 }, mask),
    };
    const refs = acquireSnapGuides(
      idx,
      maskPoint({ x: 40, y: 0 }, mask),
      {},
      opt,
    );
    const raw = maskPoint({ x: 140, y: 33 }, mask);
    const guides = snapGuideCandidates(idx, refs, raw, opt);
    close(guides[0].point, maskPoint({ x: 140, y: 30 }, mask));
    close(
      resolveObjectSnap(idx, raw, { ...opt, guides }).candidate?.point,
      guides[0].point,
    );
    expect(
      resolveObjectSnap(idx, raw, { ...opt, tolerance: 2, guides }).candidate,
    ).toBeUndefined();
  });
});
