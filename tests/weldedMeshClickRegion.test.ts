import { describe, expect, it } from 'vitest';
import { nativePrimitive, newNativeMask } from '../src/domain/nativeMasks';
import { maskPoint } from '../src/cad/import';
import {
  REGION_MAX_CLICK_SEGMENTS,
  buildRegion,
  outlineFromMaskEntity,
  outlineFromPoints,
  outlinesAtPoint,
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
const line = (id: string, a: Point, b: Point) =>
  nativePrimitive({ kind: 'line', points: [a, b], closed: false }, id);
/** Quatro linhas soltas formando um retângulo, com `over` mm de sobra além dos cantos. */
const rectLines = (x: number, y: number, w: number, h: number, over = 0) => [
  line('base', P(x - over, y), P(x + w + over, y)),
  line('direita', P(x + w, y - over), P(x + w, y + h + over)),
  line('topo', P(x + w + over, y + h), P(x - over, y + h)),
  line('esquerda', P(x, y + h + over), P(x, y - over)),
];
const sortPoints = (pts: Point[]) =>
  [...pts]
    .map((p) => ({
      x: Math.round(p.x * 1e6) / 1e6,
      y: Math.round(p.y * 1e6) / 1e6,
    }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
const pick = (prims: Primitive[], at: Point, m = mask()) => {
  const r = outlinesAtPoint(m, prims, at);
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const reason = (prims: Primitive[], at: Point, m = mask()) => {
  const r = outlinesAtPoint(m, prims, at);
  return r.ok ? '' : r.reason;
};
const regionArea = (outer: RegionOutline, openings: RegionOutline[] = []) => {
  const r = buildRegion(outer, openings);
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe('Região pelo clique interno: faces das entidades da máscara ativa', () => {
  it('quatro linhas soltas de 2.450 × 6.000: mesma região do contorno e dos pontos', () => {
    const r = pick(rectLines(0, 0, 2450, 6000), P(1000, 1000));
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0];
    expect(c.kind).toBe('região por clique');
    expect(c.closure).toBe('closed');
    expect(c.exactness).toBe('exact');
    expect(c.area).toBeCloseTo(14.7e6, 6);
    expect(sortPoints(c.points)).toEqual(sortPoints(rect(0, 0, 2450, 6000)));
    const byPoints = outlineFromPoints(rect(0, 0, 2450, 6000));
    const byEntity = outlineFromMaskEntity(
      mask(),
      nativePrimitive(
        { kind: 'rectangle', points: [P(0, 0), P(2450, 6000)], closed: true },
        'laje',
      ),
    );
    if (!byPoints.ok || !byEntity.ok) throw new Error('referência inválida');
    const areas = [c, byPoints.outline, byEntity.outline].map(
      (o) => regionArea(o).area,
    );
    expect(areas[0]).toBeCloseTo(areas[1], 6);
    expect(areas[0]).toBeCloseTo(areas[2], 6);
  });

  it('linhas com sobra nos cantos: as sobras são descartadas', () => {
    const r = pick(rectLines(0, 0, 2450, 6000, 300), P(1000, 1000));
    expect(sortPoints(r.candidates[0].points)).toEqual(
      sortPoints(rect(0, 0, 2450, 6000)),
    );
    expect(r.islands[0]).toEqual([]);
  });

  it('sobra de 0,5 mm além do canto não vira ponte de lacuna', () => {
    const c = pick(rectLines(0, 0, 2450, 6000, 0.5), P(1000, 1000))
      .candidates[0];
    expect(c.closure).toBe('closed');
    expect(c.area).toBeCloseTo(14.7e6, 6);
  });

  it('L côncavo misturando polilinha aberta e linhas', () => {
    const prims = [
      nativePrimitive(
        {
          kind: 'polyline',
          points: [P(0, 0), P(3000, 0), P(3000, 1000), P(1000, 1000)],
          closed: false,
        },
        'pl',
      ),
      line('a', P(1000, 1000), P(1000, 3000)),
      line('b', P(1000, 3000), P(0, 3000)),
      line('c', P(0, 3000), P(0, 0)),
    ];
    expect(pick(prims, P(500, 500)).candidates[0].area).toBeCloseTo(5e6, 6);
  });

  it('traço preso à borda que para no meio da laje (toco de viga) é ignorado', () => {
    const prims = [
      ...rectLines(0, 0, 4000, 3000),
      line('toco', P(2000, 0), P(2000, 1000)),
    ];
    const c = pick(prims, P(500, 500)).candidates[0];
    expect(c.area).toBeCloseTo(12e6, 6);
    expect(c.closure).toBe('closed');
  });

  it('risco curto saindo de um canto para dentro não vira lacuna fechada por ajuste', () => {
    const prims = [
      ...rectLines(0, 0, 2450, 6000),
      line('risco', P(0, 0), P(0.6, 0.6)),
    ];
    const c = pick(prims, P(1000, 1000)).candidates[0];
    expect(c.closure).toBe('closed');
    expect(c.area).toBeCloseTo(14.7e6, 6);
  });

  it('linha duplicada (desenhada duas vezes) não atrapalha', () => {
    const prims = [
      ...rectLines(0, 0, 2450, 6000),
      line('base-duplicada', P(0, 0), P(2450, 0)),
    ];
    expect(pick(prims, P(1000, 1000)).candidates[0].area).toBeCloseTo(
      14.7e6,
      6,
    );
  });

  it('base desenhada em dois trechos sobrepostos (colineares) forma a mesma região', () => {
    const prims = [
      line('base-1', P(0, 0), P(1500, 0)),
      line('base-2', P(1000, 0), P(2450, 0)),
      line('direita', P(2450, 0), P(2450, 6000)),
      line('topo', P(2450, 6000), P(0, 6000)),
      line('esquerda', P(0, 6000), P(0, 0)),
    ];
    const c = pick(prims, P(1000, 1000)).candidates[0];
    expect(c.area).toBeCloseTo(14.7e6, 6);
    expect(c.closure).toBe('closed');
  });

  it('laje com abertura desenhada: oferece a abertura como contorno interno, sem descontar', () => {
    const prims = [
      ...rectLines(0, 0, 4000, 3000),
      nativePrimitive(
        {
          kind: 'rectangle',
          points: [P(1000, 1000), P(1500, 1400)],
          closed: true,
        },
        'abertura',
      ),
    ];
    const r = pick(prims, P(500, 500));
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].area).toBeCloseTo(12e6, 6);
    expect(r.islands[0]).toHaveLength(1);
    expect(r.islands[0][0].area).toBeCloseTo(0.2e6, 6);
    // Só vira abertura quando o usuário escolhe.
    expect(regionArea(r.candidates[0]).area).toBeCloseTo(12e6, 6);
    expect(regionArea(r.candidates[0], r.islands[0]).area).toBeCloseTo(
      11.8e6,
      6,
    );
  });

  it('clique dentro do contorno interno: candidatos do menor para o maior', () => {
    const prims = [
      ...rectLines(0, 0, 4000, 3000),
      nativePrimitive(
        {
          kind: 'rectangle',
          points: [P(1000, 1000), P(1500, 1400)],
          closed: true,
        },
        'abertura',
      ),
    ];
    const r = pick(prims, P(1200, 1200));
    expect(r.candidates.map((c) => Math.round(c.area))).toEqual([
      200000, 12000000,
    ]);
    expect(r.islands[1]).toHaveLength(1);
  });

  it('linha interna atravessando divide a região: o clique pega só a parte clicada', () => {
    const prims = [
      ...rectLines(0, 0, 4000, 3000),
      line('eixo', P(1500, -100), P(1500, 3100)),
    ];
    expect(pick(prims, P(500, 500)).candidates[0].area).toBeCloseTo(4.5e6, 6);
    expect(pick(prims, P(3000, 1000)).candidates[0].area).toBeCloseTo(7.5e6, 6);
  });
});

describe('Lacunas entre entidades (até 1 mm, com confirmação)', () => {
  it('pontas a 0,5 mm num canto: fecha por ajuste e pede confirmação', () => {
    const prims = [
      line('base', P(0, 0), P(2450, 0)),
      line('direita', P(2450, 0), P(2450, 6000)),
      line('topo', P(2450, 6000), P(0, 6000)),
      line('esquerda', P(0, 6000), P(0, 0.5)),
    ];
    const c = pick(prims, P(1000, 1000)).candidates[0];
    expect(c.closure).toBe('adjusted');
    expect(c.gap).toBeCloseTo(0.5, 9);
    expect(c.area).toBeCloseTo(14.7e6, 6);
    const region = regionArea(c);
    expect(region.needsConfirmation).toBe(true);
    expect(region.adjustments.join(' ')).toContain('0,5 mm');
  });

  it('linha que para a 0,3 mm de outra (lacuna em T): fecha por ajuste', () => {
    const prims = [
      ...rectLines(0, 0, 4000, 3000),
      line('viga', P(1500, 0.3), P(1500, 3100)),
    ];
    const c = pick(prims, P(500, 500)).candidates[0];
    expect(c.area).toBeCloseTo(4.5e6, 3);
    expect(c.closure).toBe('adjusted');
    expect(c.gap).toBeCloseTo(0.3, 9);
  });

  it('ponta a 0,005 mm de outra linha conta como encostada, sem pedir confirmação', () => {
    const prims = [
      ...rectLines(0, 0, 4000, 3000),
      line('viga', P(1500, 0.005), P(1500, 3100)),
    ];
    const c = pick(prims, P(500, 500)).candidates[0];
    expect(c.area).toBeCloseTo(4.5e6, 0);
    expect(c.closure).toBe('closed');
  });

  it('lacuna de 1,5 mm não fecha: o diagnóstico aponta as pontas soltas', () => {
    const prims = [
      line('base', P(0, 0), P(2450, 0)),
      line('direita', P(2450, 0), P(2450, 6000)),
      line('topo', P(2450, 6000), P(0, 6000)),
      line('esquerda', P(0, 6000), P(0, 1.5)),
    ];
    const r = reason(prims, P(1000, 1000));
    expect(r).toContain('Nenhuma região fechada');
    expect(r).toContain('ponta(s) solta(s)');
    expect(r).toContain('1 mm');
  });
});

describe('Curvas, transformação, diagnósticos e limites', () => {
  it('arco e linha em D: região aproximada com aviso de 0,05 mm', () => {
    const prims = [
      nativePrimitive(
        {
          kind: 'arc',
          center: P(0, 0),
          radius: 1000,
          startAngle: -90,
          sweepAngle: 180,
        },
        'arco',
      ),
      line('corda', P(0, 1000), P(0, -1000)),
    ];
    const c = pick(prims, P(500, 0)).candidates[0];
    const half = (Math.PI * 1000 ** 2) / 2;
    expect(c.area).toBeLessThan(half);
    expect(c.area).toBeGreaterThan(half - Math.PI * 1000 * 0.05);
    expect(c.exactness).toBe('approximation');
    expect(c.notes.join(' ')).toContain('0,05 mm');
  });

  it('máscara transformada: a região sai em mm do modelo', () => {
    const m = mask({ scale: 2, rotation: 30, origin: P(100, 200) });
    const c = pick(rectLines(0, 0, 1000, 500), maskPoint(P(500, 250), m), m)
      .candidates[0];
    expect(c.area).toBeCloseTo(2e6, 3);
    expect(sortPoints(c.points)).toEqual(
      sortPoints(rect(0, 0, 1000, 500).map((p) => maskPoint(p, m))),
    );
  });

  it('clique fora de tudo e clique sobre a linha recebem diagnóstico; texto não participa', () => {
    const prims = [
      ...rectLines(0, 0, 2450, 6000),
      { layer: 'DESENHO', points: [P(100, 100)], text: 'L1' } as Primitive,
    ];
    expect(reason(prims, P(10000, 10000))).toContain('Nenhuma região fechada');
    expect(reason(prims, P(1000, 0.004))).toContain('sobre uma linha');
    expect(pick(prims, P(1000, 1000)).candidates[0].area).toBeCloseTo(
      14.7e6,
      6,
    );
  });

  it('limite explícito de segmentos', () => {
    expect(REGION_MAX_CLICK_SEGMENTS).toBe(20000);
    const many = Array.from({ length: REGION_MAX_CLICK_SEGMENTS + 1 }, (_, i) =>
      line(`l${i}`, P(i * 10, 0), P(i * 10 + 5, 0)),
    );
    expect(reason(many, P(1, 1))).toContain('20.000');
  });

  it('malha densa de 51 × 51 linhas (2.500 faces) responde rápido', () => {
    const prims: Primitive[] = [];
    for (let i = 0; i <= 50; i++) {
      prims.push(line(`h${i}`, P(0, i * 100), P(5000, i * 100)));
      prims.push(line(`v${i}`, P(i * 100, 0), P(i * 100, 5000)));
    }
    const start = performance.now();
    const c = pick(prims, P(150, 250)).candidates[0];
    expect(performance.now() - start).toBeLessThan(3000);
    expect(c.area).toBeCloseTo(1e4, 6);
  });
});
