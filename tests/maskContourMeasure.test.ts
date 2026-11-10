import { describe, expect, it } from 'vitest';
import {
  CONTOUR_LENGTH_TOLERANCE,
  contourMeasureCandidates,
  formatArea,
  measureMaskEntity,
  measurePolyline,
  pathSelfIntersects,
  type ContourMeasurement,
} from '../src/domain/maskContourMeasure';
import { formatDimension } from '../src/domain/maskDimensions';
import { nativePrimitive, type NativeShape } from '../src/domain/nativeMasks';
import { hideObjects } from '../src/domain/visibility';
import { toCsv } from '../src/lib/exports';
import type { Mask, Point, Primitive, Project } from '../src/domain/types';
import { maskManipFixture } from './fixtures/maskManipulation';

/** Relative tolerance documented for the analytic/shoelace results. */
const REL = 1e-12;
const close = (a: number, b: number, rel = REL) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(
    Math.max(1e-9, Math.abs(b) * rel),
  );
const P = (x: number, y: number): Point => ({ x, y });
const native = (s: NativeShape) => nativePrimitive(s, 'q');
const mask = (patch: Partial<Mask> = {}): Mask => ({
  id: 'm',
  name: 'M',
  format: 'NATIVE',
  primitives: [],
  layers: { DESENHO: true },
  visible: true,
  opacity: 1,
  scale: 1,
  origin: P(0, 0),
  rotation: 0,
  sourceUnit: 'mm',
  warnings: [],
  ...patch,
});
const rectangle = native({
  kind: 'rectangle',
  points: [P(0, 0), P(3000, 4000)],
  closed: true,
});
const openPath = native({
  kind: 'polyline',
  points: [P(0, 0), P(3000, 0), P(3000, 4000)],
  closed: false,
});
const circle = native({ kind: 'circle', center: P(250, -40), radius: 1000 });
function closedOk(r: ContourMeasurement) {
  if (!r.ok || !r.closed)
    throw new Error(`esperado contorno fechado: ${JSON.stringify(r)}`);
  return r;
}
function openOk(r: ContourMeasurement) {
  if (!r.ok || r.closed)
    throw new Error(`esperado caminho aberto: ${JSON.stringify(r)}`);
  return r;
}

describe('Medir contorno — cálculo geométrico', () => {
  it('retângulo 3.000 × 4.000 mm: perímetro 14.000 mm e área 12 m²', () => {
    const r = closedOk(measureMaskEntity(mask(), rectangle));
    expect(r.perimeter).toBe(14000);
    expect(r.area).toBe(12e6);
    expect(r.exactness).toBe('exact');
    expect(r.kind).toBe('retângulo');
    expect(formatDimension(r.perimeter, { unit: 'mm', precision: 0 })).toBe(
      '14000 mm',
    );
    expect(formatArea(r.area, { unit: 'm', precision: 2 })).toBe('12,00 m²');
    expect(formatArea(r.area, { unit: 'cm', precision: 0 })).toBe('120000 cm²');
    expect(formatArea(r.area, { unit: 'mm', precision: 1 })).toBe(
      '12000000,0 mm²',
    );
  });

  it('caminho aberto 3.000 + 4.000 mm: comprimento 7.000 mm, sem área', () => {
    const r = openOk(measureMaskEntity(mask(), openPath));
    expect(r.length).toBe(7000);
    expect('area' in r).toBe(false);
    expect('perimeter' in r).toBe(false);
    expect(r.notes).toEqual([]);
  });

  it('círculo de raio 1.000 mm usa cálculo analítico', () => {
    const r = closedOk(measureMaskEntity(mask(), circle));
    expect(r.exactness).toBe('analytic');
    close(r.perimeter, 2 * Math.PI * 1000);
    close(r.area, Math.PI * 1000 ** 2);
    expect(formatArea(r.area, { unit: 'm', precision: 4 })).toBe('3,1416 m²');
  });

  it('arco nativo: comprimento analítico, sem área nem fechamento', () => {
    const r = openOk(
      measureMaskEntity(
        mask(),
        native({
          kind: 'arc',
          center: P(0, 0),
          radius: 1000,
          startAngle: 30,
          sweepAngle: -90,
        }),
      ),
    );
    close(r.length, (Math.PI / 2) * 1000);
    expect(r.exactness).toBe('analytic');
  });

  it('rotação e translação preservam valores; escala 2 dobra comprimento e quadruplica área', () => {
    const base = mask();
    const moved = mask({ rotation: 37.5, origin: P(123456.7, -98765.4) });
    const scaled = mask({ scale: 2, rotation: -113, origin: P(-5000, 7000) });
    for (const q of [rectangle, circle]) {
      const a = closedOk(measureMaskEntity(base, q)),
        b = closedOk(measureMaskEntity(moved, q)),
        c = closedOk(measureMaskEntity(scaled, q));
      close(b.perimeter, a.perimeter, 1e-11);
      close(b.area, a.area, 1e-11);
      close(c.perimeter, 2 * a.perimeter, 1e-11);
      close(c.area, 4 * a.area, 1e-11);
    }
    const a = openOk(measureMaskEntity(base, openPath)),
      b = openOk(measureMaskEntity(moved, openPath)),
      c = openOk(measureMaskEntity(scaled, openPath));
    close(b.length, a.length, 1e-11);
    close(c.length, 2 * a.length, 1e-11);
  });

  it('unidade de origem importada usa a escala física da máscara (pol → mm)', () => {
    const imported = mask({ format: 'DXF', scale: 25.4, sourceUnit: 'pol' });
    const q: Primitive = {
      layer: '0',
      points: [P(0, 0), P(10, 0), P(10, 10), P(0, 10)],
      closed: true,
    };
    const r = closedOk(measureMaskEntity(imported, q));
    close(r.perimeter, 40 * 25.4);
    close(r.area, 100 * 25.4 ** 2);
  });

  it('inverter a ordem dos vértices não altera área nem perímetro', () => {
    const pts = [P(0, 0), P(5000, 0), P(5000, 1000), P(2000, 3000), P(0, 2000)];
    const a = closedOk(measurePolyline(pts, true)),
      b = closedOk(measurePolyline([...pts].reverse(), true));
    expect(b.area).toBe(a.area);
    close(b.perimeter, a.perimeter);
    expect(a.area).toBeGreaterThan(0);
  });

  it('vértice de fechamento repetido não cria aresta nula', () => {
    const r = closedOk(
      measurePolyline(
        [P(0, 0), P(3000, 0), P(3000, 4000), P(0, 4000), P(0, 0)],
        true,
      ),
    );
    expect(r.perimeter).toBe(14000);
    expect(r.area).toBe(12e6);
  });

  it('caminho aberto com extremidades coincidentes não é fechado silenciosamente', () => {
    const r = openOk(
      measurePolyline(
        [P(0, 0), P(3000, 0), P(3000, 4000), P(0, 4000), P(0, 0)],
        false,
      ),
    );
    expect(r.length).toBe(14000);
    expect('area' in r).toBe(false);
    expect(r.notes.join(' ')).toMatch(/não está marcada como fechada/);
    expect(r.notes.join(' ')).not.toMatch(/cruza/);
  });

  it('autointerseção em contorno fechado é recusada sem números', () => {
    const bowtie = [P(0, 0), P(1000, 1000), P(1000, 0), P(0, 1000)];
    expect(pathSelfIntersects(bowtie, true)).toBe(true);
    const r = measurePolyline(bowtie, true);
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty('area');
    expect(r).not.toHaveProperty('perimeter');
    if (!r.ok) expect(r.reason).toMatch(/autointerseção/);
    // Touching at a non-adjacent vertex and collinear overlap are also invalid.
    expect(
      measurePolyline([P(0, 0), P(2000, 0), P(1000, 0), P(1000, 1000)], true)
        .ok,
    ).toBe(false);
    expect(
      measurePolyline(
        [P(0, 0), P(2000, 0), P(2000, 2000), P(1000, 0), P(0, 2000)],
        true,
      ).ok,
    ).toBe(false);
  });

  it('caminho aberto que cruza a si mesmo mostra comprimento com aviso', () => {
    const r = openOk(
      measurePolyline([P(0, 0), P(1000, 1000), P(1000, 0), P(0, 1000)], false),
    );
    close(r.length, 2000 * Math.SQRT2 + 1000);
    expect(r.notes.join(' ')).toMatch(/cruza ou sobrepõe/);
  });

  it('geometria degenerada, não finita ou sem suporte gera aviso', () => {
    const invalid: [Point[], boolean, RegExp][] = [
      [[P(0, 0), P(1000, 0), P(2000, 0)], true, /colineares/],
      [
        [P(0, 0), P(0, CONTOUR_LENGTH_TOLERANCE / 2), P(10, 10)],
        false,
        /comprimento nulo/,
      ],
      [[P(0, 0), P(Number.NaN, 0)], false, /não finitas/],
      [[P(0, 0), P(2e9, 0)], false, /não finitas/],
      [[P(0, 0)], false, /menos de dois/],
      [[P(0, 0), P(1000, 0)], true, /três vértices/],
    ];
    for (const [pts, closed, reason] of invalid) {
      const r = measurePolyline(pts, closed);
      expect(r.ok, JSON.stringify(pts)).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(reason);
    }
    const text: Primitive = { layer: 'T', points: [P(0, 0)], text: 'P1' };
    const t = measureMaskEntity(mask(), text);
    expect(t.ok).toBe(false);
    expect(measureMaskEntity(mask({ scale: 0 }), rectangle).ok).toBe(false);
    expect(
      measureMaskEntity(
        mask({ origin: P(Number.POSITIVE_INFINITY, 0) }),
        circle,
      ).ok,
    ).toBe(false);
    const broken = {
      ...circle,
      native: { kind: 'circle', center: P(0, 0), radius: -1 },
    } as Primitive;
    const b = measureMaskEntity(mask(), broken);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toMatch(/Geometria nativa inválida/);
  });

  it('geometria importada informa aproximação disponível', () => {
    const arcLike: Primitive = {
      layer: 'FORMA',
      points: Array.from({ length: 65 }, (_, i) => ({
        x: 1000 * Math.cos((i / 64) * 2 * Math.PI),
        y: 1000 * Math.sin((i / 64) * 2 * Math.PI),
      })),
      closed: true,
    };
    const r = closedOk(measureMaskEntity(mask({ format: 'DXF' }), arcLike));
    expect(r.exactness).toBe('approximation');
    expect(r.kind).toBe('contorno importado');
    expect(r.notes[0]).toMatch(/aproximação discretizada/);
    // The polygon value is reported, not the invented original circle.
    expect(r.area).toBeLessThan(Math.PI * 1000 ** 2);
    expect(r.perimeter).toBeLessThan(2 * Math.PI * 1000);
  });
});

describe('Medir contorno — consulta no projeto', () => {
  const ctx = (p: Project) => ({
    key: 'model',
    detailId: p.hierarchy.objectDetails['target-mask'],
  });
  it('candidatos respeitam visibilidade, captura e detalhamento; consulta não altera o projeto', () => {
    const p = maskManipFixture();
    p.masks[0].primitives.push({
      id: 'note',
      layer: 'DESENHO',
      points: [P(0, 0)],
      text: 'texto',
    });
    const before = JSON.stringify(p),
      csv = toCsv(p);
    const all = contourMeasureCandidates(p, ctx(p));
    expect(all.map((e) => e.ref.id)).toEqual(
      expect.arrayContaining(['line', 'circle', 'rectangle']),
    );
    expect(all.some((e) => e.ref.id === 'note')).toBe(false);
    for (const e of all) measureMaskEntity(e.mask, e.ref.primitive);
    expect(JSON.stringify(p)).toBe(before);
    expect(toCsv(p)).toBe(csv);

    const hidden = hideObjects(p, 'model', ['target-mask']);
    expect(
      contourMeasureCandidates(hidden, ctx(p)).some(
        (e) => e.mask.id === 'target-mask',
      ),
    ).toBe(false);
    const other = { ...ctx(p), detailId: 'outro-detalhamento' };
    expect(contourMeasureCandidates(p, other)).toEqual([]);
    expect(contourMeasureCandidates(p, { ...ctx(p), key: 'sheet:x' })).toEqual(
      [],
    );
  });
});
