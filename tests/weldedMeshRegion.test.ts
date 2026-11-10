import { describe, expect, it } from 'vitest';
import { nativePrimitive, newNativeMask } from '../src/domain/nativeMasks';
import { maskPoint } from '../src/cad/import';
import {
  REGION_CURVE_TOLERANCE,
  REGION_MAX_CLOSURE_GAP,
  REGION_MAX_VERTICES,
  REGION_POINT_TOLERANCE,
  buildRegion,
  outlineFromMaskEntity,
  outlineFromPoints,
  signedArea,
  type RegionOutline,
} from '../src/domain/weldedMeshRegion';
import type { Mask, Point, Primitive } from '../src/domain/types';

const P = (x: number, y: number): Point => ({ x, y });
const rect = (x: number, y: number, w: number, h: number): Point[] => [
  P(x, y),
  P(x + w, y),
  P(x + w, y + h),
  P(x, y + h),
];
const mask = (patch: Partial<Mask> = {}): Mask => ({
  ...newNativeMask('Fôrma'),
  ...patch,
});
const outline = (points: Point[]): RegionOutline => {
  const r = outlineFromPoints(points);
  if (!r.ok) throw new Error(r.reason);
  return r.outline;
};
const fromEntity = (m: Mask, q: Primitive): RegionOutline => {
  const r = outlineFromMaskEntity(m, q);
  if (!r.ok) throw new Error(r.reason);
  return r.outline;
};
const reason = (r: { ok: true } | { ok: false; reason: string }) =>
  r.ok ? '' : r.reason;
/** Polilinha aberta em quadrado de 1.000 mm cujas pontas ficam a `gap` mm. */
const openSquare = (gap: number) =>
  nativePrimitive(
    {
      kind: 'polyline',
      points: [P(0, 0), P(1000, 0), P(1000, 1000), P(0, 1000), P(0, gap)],
      closed: false,
    },
    'open',
  );
const sortPoints = (pts: Point[]) =>
  [...pts]
    .map((p) => ({
      x: Math.round(p.x * 1e6) / 1e6,
      y: Math.round(p.y * 1e6) / 1e6,
    }))
    .sort((a, b) => a.x - b.x || a.y - b.y);

describe('Tolerâncias da região (documentadas e aprovadas)', () => {
  it('0,01 mm para pontos coincidentes, até 1 mm de lacuna com confirmação, 0,05 mm em curvas', () => {
    expect(REGION_POINT_TOLERANCE).toBe(0.01);
    expect(REGION_MAX_CLOSURE_GAP).toBe(1);
    expect(REGION_CURVE_TOLERANCE).toBe(0.05);
    expect(REGION_MAX_VERTICES).toBe(50000);
  });
});

describe('Região por pontos', () => {
  it('retângulo 2.450 × 6.000 mm: 14,70 m², exato e fechado', () => {
    const r = outlineFromPoints(rect(0, 0, 2450, 6000));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outline.area).toBeCloseTo(14.7e6, 6);
    expect(r.outline.exactness).toBe('exact');
    expect(r.outline.closure).toBe('closed');
    expect(r.outline.kind).toBe('pontos');
  });

  it('clicar de novo no primeiro ponto fecha; pontos repetidos (≤ 0,01 mm) são unidos com aviso', () => {
    const closedByClick = outline([...rect(0, 0, 1000, 500), P(0.004, 0.003)]);
    expect(closedByClick.points).toHaveLength(4);
    expect(closedByClick.area).toBeCloseTo(500000, 6);
    const duplicated = outline([
      P(0, 0),
      P(1000, 0),
      P(1000.005, 0),
      P(1000, 500),
      P(0, 500),
    ]);
    expect(duplicated.points).toHaveLength(4);
    expect(duplicated.notes.join(' ')).toContain('repetido');
  });

  it('côncavo (L) e inclinado: área correta', () => {
    const l = outline([
      P(0, 0),
      P(3000, 0),
      P(3000, 1000),
      P(1000, 1000),
      P(1000, 3000),
      P(0, 3000),
    ]);
    expect(l.area).toBeCloseTo(5e6, 6);
    const a = (30 * Math.PI) / 180;
    const inclined = outline(
      rect(0, 0, 2000, 1000).map((p) =>
        P(
          p.x * Math.cos(a) - p.y * Math.sin(a),
          p.x * Math.sin(a) + p.y * Math.cos(a),
        ),
      ),
    );
    expect(inclined.area).toBeCloseTo(2e6, 4);
  });

  it('recusa: menos de 3 vértices distintos, colineares, autointerseção, não finitos', () => {
    expect(reason(outlineFromPoints([P(0, 0), P(10, 0)]))).toContain(
      'três vértices',
    );
    expect(
      reason(outlineFromPoints([P(0, 0), P(10, 0), P(10, 0.004)])),
    ).toContain('três vértices');
    expect(reason(outlineFromPoints([P(0, 0), P(10, 0), P(20, 0)]))).toContain(
      'colineares',
    );
    expect(
      reason(outlineFromPoints([P(0, 0), P(10, 10), P(10, 0), P(0, 10)])),
    ).toContain('autointerseção');
    expect(reason(outlineFromPoints([P(0, 0), P(NaN, 0), P(0, 10)]))).toContain(
      'finitas',
    );
    expect(reason(outlineFromPoints([P(0, 0), P(2e9, 0), P(0, 10)]))).toContain(
      'finitas',
    );
  });

  it('limite de vértices: região grande demais recebe diagnóstico', () => {
    const n = REGION_MAX_VERTICES + 1;
    const big = Array.from({ length: n }, (_, i) =>
      P(
        1e6 * Math.cos((2 * Math.PI * i) / n),
        1e6 * Math.sin((2 * Math.PI * i) / n),
      ),
    );
    const r = reason(outlineFromPoints(big));
    expect(r).toContain('vértices');
    expect(r).toContain('50.000');
  });
});

describe('Região a partir de uma entidade da máscara', () => {
  it('retângulo nativo em máscara transformada: transformação aplicada uma única vez', () => {
    const m = mask({ scale: 2, rotation: 30, origin: P(100, 200) });
    const q = nativePrimitive(
      { kind: 'rectangle', points: [P(0, 0), P(1000, 500)], closed: true },
      'r',
    );
    const o = fromEntity(m, q);
    expect(o.area).toBeCloseTo(1000 * 500 * 4, 4);
    expect(o.exactness).toBe('exact');
    expect(o.kind).toBe('retângulo');
    expect(sortPoints(o.points)).toEqual(
      sortPoints(rect(0, 0, 1000, 500).map((p) => maskPoint(p, m))),
    );
  });

  it('polilinha nativa fechada e côncava: exata', () => {
    const q = nativePrimitive(
      {
        kind: 'polyline',
        points: [
          P(0, 0),
          P(3000, 0),
          P(3000, 1000),
          P(1000, 1000),
          P(1000, 3000),
          P(0, 3000),
        ],
        closed: true,
      },
      'l',
    );
    const o = fromEntity(mask(), q);
    expect(o.area).toBeCloseTo(5e6, 6);
    expect(o.exactness).toBe('exact');
  });

  it('círculo: polígono com erro radial ≤ 0,05 mm no modelo, também com escala 2', () => {
    for (const scale of [1, 2]) {
      const m = mask({ scale, rotation: 15, origin: P(-50, 30) });
      const q = nativePrimitive(
        { kind: 'circle', center: P(100, 50), radius: 500 },
        'c',
      );
      const o = fromEntity(m, q);
      const c = maskPoint(P(100, 50), m),
        R = 500 * scale;
      for (const v of o.points)
        expect(Math.abs(Math.hypot(v.x - c.x, v.y - c.y) - R)).toBeLessThan(
          1e-6,
        );
      let sagitta = 0;
      o.points.forEach((v, i) => {
        const w = o.points[(i + 1) % o.points.length];
        const mid = P((v.x + w.x) / 2, (v.y + w.y) / 2);
        sagitta = Math.max(sagitta, R - Math.hypot(mid.x - c.x, mid.y - c.y));
      });
      expect(sagitta).toBeLessThanOrEqual(REGION_CURVE_TOLERANCE + 1e-9);
      expect(o.area).toBeLessThan(Math.PI * R * R);
      expect(o.area).toBeGreaterThan(Math.PI * R * R - 2 * Math.PI * R * 0.05);
      expect(o.exactness).toBe('approximation');
      expect(o.notes.join(' ')).toContain('0,05 mm');
    }
  });

  it('polilinha aberta: até 0,01 mm conta como fechada; até 1 mm fecha por ajuste; acima, recusa', () => {
    for (const gap of [0.005, 0.01]) {
      const o = fromEntity(mask(), openSquare(gap));
      expect(o.closure).toBe('coincident');
      expect(o.points).toHaveLength(4);
      expect(o.area).toBeCloseTo(1e6, 3);
    }
    for (const gap of [0.5, 1]) {
      const o = fromEntity(mask(), openSquare(gap));
      expect(o.closure).toBe('adjusted');
      expect(o.gap).toBeCloseTo(gap, 9);
      expect(o.points).toHaveLength(5);
    }
    const tooWide = reason(outlineFromMaskEntity(mask(), openSquare(1.5)));
    expect(tooWide).toContain('1,5 mm');
    expect(tooWide).toContain('1 mm');
  });

  it('linha, arco, texto e transformação inválida são recusados com o motivo', () => {
    const line = nativePrimitive(
      { kind: 'line', points: [P(0, 0), P(100, 0)], closed: false },
      'line',
    );
    expect(reason(outlineFromMaskEntity(mask(), line))).toContain('Linha');
    const arc = nativePrimitive(
      {
        kind: 'arc',
        center: P(0, 0),
        radius: 100,
        startAngle: 0,
        sweepAngle: 90,
      },
      'arc',
    );
    expect(reason(outlineFromMaskEntity(mask(), arc))).toContain('Arco');
    const text: Primitive = { layer: 'DESENHO', points: [P(0, 0)], text: 'V1' };
    expect(reason(outlineFromMaskEntity(mask(), text))).toContain('Texto');
    const square = nativePrimitive(
      { kind: 'rectangle', points: [P(0, 0), P(10, 10)], closed: true },
      's',
    );
    expect(reason(outlineFromMaskEntity(mask({ scale: 0 }), square))).toContain(
      'Transformação',
    );
  });

  it('contorno importado: usa a polilinha disponível e avisa que é aproximação', () => {
    const q: Primitive = {
      layer: '0',
      points: rect(0, 0, 100, 100),
      closed: true,
    };
    const o = fromEntity(mask({ format: 'DXF' }), q);
    expect(o.area).toBeCloseTo(10000, 6);
    expect(o.exactness).toBe('approximation');
    expect(o.notes.join(' ')).toContain('importad');
  });
});

describe('Região com aberturas', () => {
  it('desconta a abertura; contorno externo anti-horário e aberturas horárias', () => {
    const outerCw = outline([...rect(0, 0, 4000, 3000)].reverse());
    const opening = outline(rect(1000, 1000, 500, 400));
    const before = structuredClone(outerCw);
    const r = buildRegion(outerCw, [opening]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.grossArea).toBeCloseTo(12e6, 6);
    expect(r.openingsArea).toBeCloseTo(0.2e6, 6);
    expect(r.area).toBeCloseTo(11.8e6, 6);
    expect(signedArea(r.region.outer)).toBeGreaterThan(0);
    expect(signedArea(r.region.openings[0])).toBeLessThan(0);
    expect(r.exactness).toBe('exact');
    expect(r.needsConfirmation).toBe(false);
    expect(outerCw).toEqual(before);
  });

  it('abertura fora, cruzando, tocando ou a menos de 0,01 mm do contorno é recusada; a 0,5 mm é aceita', () => {
    const outer = outline(rect(0, 0, 1000, 1000));
    const check = (pts: Point[]) => buildRegion(outer, [outline(pts)]);
    expect(reason(check(rect(2000, 0, 100, 100)))).toContain('fora');
    const crossing = reason(check(rect(900, 400, 200, 200)));
    expect(crossing).toContain('abertura 1');
    expect(crossing).toContain('contorno externo');
    expect(reason(check(rect(900, 400, 100, 200)))).toContain(
      'contorno externo',
    );
    expect(reason(check(rect(899.995, 400, 100, 200)))).toContain(
      'contorno externo',
    );
    expect(check(rect(899.5, 400, 100, 200)).ok).toBe(true);
  });

  it('aberturas sobrepostas ou uma dentro da outra são recusadas', () => {
    const outer = outline(rect(0, 0, 2000, 2000));
    const overlap = buildRegion(outer, [
      outline(rect(100, 100, 300, 300)),
      outline(rect(300, 300, 300, 300)),
    ]);
    expect(reason(overlap)).toContain('aberturas 1 e 2');
    const nested = buildRegion(outer, [
      outline(rect(100, 100, 500, 500)),
      outline(rect(200, 200, 100, 100)),
    ]);
    expect(reason(nested)).toContain('abertura 2');
    expect(reason(nested)).toContain('dentro da abertura 1');
  });

  it('lacuna fechada por ajuste exige confirmação e é listada', () => {
    const outer = outline(rect(-1000, -1000, 4000, 4000));
    const r = buildRegion(outer, [fromEntity(mask(), openSquare(0.5))]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.needsConfirmation).toBe(true);
    expect(r.adjustments.join(' ')).toContain('Abertura 1');
    expect(r.adjustments.join(' ')).toContain('0,5 mm');
  });

  it('círculo como abertura deixa a região aproximada, com aviso', () => {
    const outer = outline(rect(0, 0, 3000, 3000));
    const hole = fromEntity(
      mask(),
      nativePrimitive(
        { kind: 'circle', center: P(1500, 1500), radius: 300 },
        'h',
      ),
    );
    const r = buildRegion(outer, [hole]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exactness).toBe('approximation');
    expect(r.notes.join(' ')).toContain('0,05 mm');
    expect(Math.abs(r.area - (9e6 - Math.PI * 300 ** 2))).toBeLessThan(
      2 * Math.PI * 300 * 0.05,
    );
  });

  it('a mesma região por contorno da máscara e por pontos dá o mesmo resultado', () => {
    const q = nativePrimitive(
      { kind: 'rectangle', points: [P(0, 0), P(2450, 6000)], closed: true },
      'slab',
    );
    const a = buildRegion(fromEntity(mask(), q));
    const b = buildRegion(outline(rect(0, 0, 2450, 6000)));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.area).toBeCloseTo(b.area, 6);
    expect(sortPoints(a.region.outer)).toEqual(sortPoints(b.region.outer));
  });
});
