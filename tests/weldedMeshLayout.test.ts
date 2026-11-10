import { describe, expect, it } from 'vitest';
import {
  catalogWeldedMesh,
  customWeldedMesh,
  defaultWeldedMeshCriteria,
  type WeldedMeshCriteria,
} from '../src/domain/weldedMesh';
import {
  buildRegion,
  outlineFromPoints,
  type WeldedMeshRegion,
} from '../src/domain/weldedMeshRegion';
import {
  LAYOUT_MAX_PANELS,
  layoutWires,
  planWeldedMeshLayout,
  type WeldedMeshLayout,
} from '../src/domain/weldedMeshLayout';
import { pointInPolygon } from '../src/domain/planarFaces';
import type { Point } from '../src/domain/types';

const P = (x: number, y: number): Point => ({ x, y });
const rect = (x: number, y: number, w: number, h: number): Point[] => [
  P(x, y),
  P(x + w, y),
  P(x + w, y + h),
  P(x, y + h),
];
const rotate = (p: Point, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return P(
    p.x * Math.cos(a) - p.y * Math.sin(a),
    p.x * Math.sin(a) + p.y * Math.cos(a),
  );
};
const region = (outer: Point[], openings: Point[][] = []): WeldedMeshRegion => {
  const o = outlineFromPoints(outer);
  const holes = openings.map((h) => outlineFromPoints(h));
  if (!o.ok) throw new Error(o.reason);
  const r = buildRegion(
    o.outline,
    holes.map((h) => {
      if (!h.ok) throw new Error(h.reason);
      return h.outline;
    }),
  );
  if (!r.ok) throw new Error(r.reason);
  return r.region;
};
const criteria = (
  patch: Partial<WeldedMeshCriteria> = {},
): WeldedMeshCriteria => ({
  ...defaultWeldedMeshCriteria(),
  ...patch,
});
const plan = (
  r: WeldedMeshRegion,
  c: WeldedMeshCriteria,
  options?: { anchor?: Point },
): WeldedMeshLayout => {
  const p = planWeldedMeshLayout(r, c, options);
  if (!p.ok) throw new Error(p.reason);
  return p.layout;
};
const reason = (r: WeldedMeshRegion, c: WeldedMeshCriteria) => {
  const p = planWeldedMeshLayout(r, c);
  return p.ok ? '' : p.reason;
};
const minX = (pts: Point[]) => Math.min(...pts.map((p) => p.x));
const minY = (pts: Point[]) => Math.min(...pts.map((p) => p.y));
/** Camadas físicas de tela num ponto: quantas peças o contêm. */
const layers = (l: WeldedMeshLayout, p: Point) =>
  l.panels
    .flatMap((panel) => panel.pieces)
    .filter(
      (piece) =>
        pointInPolygon(p, piece.outline) &&
        !piece.holes.some((h) => pointInPolygon(p, h)),
    ).length;

describe('Casos de referência da issue', () => {
  it('caso 1: 2.450 × 6.000 mm, Q92 alinhada, sem afastamento nem sobreposição', () => {
    for (const [orientation, outer] of [
      [0, rect(0, 0, 6000, 2450)],
      [90, rect(0, 0, 2450, 6000)],
    ] as const) {
      const l = plan(region([...outer]), criteria({ orientation }));
      expect(l.basePanels).toBe(1);
      expect(l.fullPanels).toBe(1);
      expect(l.cutPieces).toBe(0);
      expect(l.usefulArea).toBeCloseTo(14.7e6, 6);
      expect(l.appliedArea).toBeCloseTo(14.7e6, 6);
      expect(l.overlapArea).toBeCloseTo(0, 6);
      expect(l.wasteArea).toBeCloseTo(0, 6);
      // Valores de cálculo sem arredondar: 14,70 × 1,48 e 1 × 21,8.
      expect(l.appliedMass).toBeCloseTo(21.756, 9);
      expect(l.supplyMass).toBeCloseTo(21.8, 9);
      expect(l.panels[0].pieces[0].cut).toBe(false);
      expect(l.assumptions.join(' ')).toContain('conservadora');
    }
  });

  it('caso 2: dois Q92 lado a lado pela largura, sobreposição de 150 mm, 4.750 × 6.000 mm', () => {
    const l = plan(
      region(rect(0, 0, 6000, 4750)),
      criteria({ orientation: 0, start: 'bottom-left', widthOverlap: 150 }),
    );
    expect(l.basePanels).toBe(2);
    expect(l.cutPieces).toBe(0);
    expect(l.usefulArea).toBeCloseTo(28.5e6, 6);
    expect(l.appliedArea).toBeCloseTo(29.4e6, 6);
    expect(l.overlapArea).toBeCloseTo(0.9e6, 6);
    expect(l.appliedMass).toBeCloseTo(29.4 * 1.48, 9);
    expect(l.supplyMass).toBeCloseTo(2 * 21.8, 9);
    // Origem e orientação fixadas: painéis em y 0–2.450 e 2.300–4.750.
    expect(l.panels.map((p) => minY(p.rect))).toEqual([0, 2300]);
    expect(layers(l, P(3000, 2375))).toBe(2);
    expect(layers(l, P(3000, 1000))).toBe(1);
  });

  it('girar a região e a tela juntas não muda as quantidades', () => {
    const base = plan(
      region(rect(0, 0, 6000, 4750)),
      criteria({ widthOverlap: 150 }),
    );
    const turned = plan(
      region(rect(0, 0, 6000, 4750).map((p) => rotate(p, 30))),
      criteria({ widthOverlap: 150, orientation: 30 }),
    );
    expect(turned.basePanels).toBe(base.basePanels);
    for (const k of ['usefulArea', 'appliedArea', 'overlapArea'] as const)
      expect(Math.abs(turned[k] - base[k])).toBeLessThan(10);
  });
});

describe('Paginação conservadora', () => {
  it('7.000 mm de comprimento com sobreposição de 300 mm: 1 painel inteiro e 1 recorte', () => {
    const r = region(rect(0, 0, 7000, 2450));
    const left = plan(r, criteria({ lengthOverlap: 300 }));
    expect(left.basePanels).toBe(2);
    expect(left.cutPieces).toBe(1);
    expect(left.usefulArea).toBeCloseTo(17.15e6, 6);
    expect(left.appliedArea).toBeCloseTo(14.7e6 + 1300 * 2450, 6);
    expect(left.overlapArea).toBeCloseTo(300 * 2450, 6);
    expect(left.wasteArea).toBeCloseTo(4700 * 2450, 6);
    expect(minX(left.panels[0].rect)).toBe(0);
    const right = plan(
      r,
      criteria({ lengthOverlap: 300, start: 'bottom-right' }),
    );
    expect(right.basePanels).toBe(2);
    expect(right.appliedArea).toBeCloseTo(left.appliedArea, 6);
    // Começando pela direita, o painel inteiro fica encostado em x = 7.000.
    expect(minX(right.panels[0].rect)).toBe(1000);
    expect(right.panels[0].pieces[0].cut).toBe(false);
  });

  it('peça desconexa do mesmo painel-base não vira outro painel; não é área ÷ área comercial', () => {
    // Forma de ∩: duas pernas ligadas por uma faixa acima da 1ª fileira de painéis.
    const r = region([
      P(0, 0),
      P(1000, 0),
      P(1000, 2450),
      P(5000, 2450),
      P(5000, 0),
      P(6000, 0),
      P(6000, 3000),
      P(0, 3000),
    ]);
    const l = plan(r, criteria());
    expect(l.basePanels).toBe(2);
    expect(l.panels[0].pieces).toHaveLength(2);
    expect(l.panels[1].pieces).toHaveLength(1);
    expect(l.usefulArea).toBeCloseTo(8.2e6, 6);
    // Arredondar a área pela área do painel daria 1 painel: errado.
    expect(Math.ceil(l.usefulArea / (6000 * 2450))).toBe(1);
  });

  it('ponto de partida explícito ancora a grade', () => {
    const l = plan(region(rect(0, 0, 7000, 2450)), criteria(), {
      anchor: P(500, 0),
    });
    expect(l.basePanels).toBe(3);
    const full = l.panels.find((p) => !p.pieces[0].cut)!;
    expect(minX(full.rect)).toBe(500);
  });

  it('painéis vizinhos sem sobreposição recebem aviso', () => {
    const l = plan(region(rect(0, 0, 12000, 2450)), criteria());
    expect(l.basePanels).toBe(2);
    expect(l.warnings.join(' ')).toContain('sem sobreposição');
  });

  it('é determinística: mesma entrada, mesmo plano', () => {
    const r = region(rect(0, 0, 7000, 5000), [rect(2000, 2000, 600, 400)]);
    const c = criteria({ lengthOverlap: 300, widthOverlap: 150 });
    expect(plan(r, c)).toEqual(plan(r, c));
  });
});

describe('Região útil: afastamentos e aberturas', () => {
  it('afastamento do contorno e das aberturas, em planta', () => {
    const l = plan(
      region(rect(0, 0, 6000, 2450), [rect(2000, 800, 500, 400)]),
      criteria({ edgeOffset: 50, openingOffset: 100 }),
    );
    expect(l.usefulArea).toBeCloseTo(5900 * 2350 - 700 * 600, 3);
    expect(l.basePanels).toBe(1);
    expect(l.panels[0].pieces[0].holes).toHaveLength(1);
    expect(layers(l, P(2550, 1000))).toBe(0);
    expect(layers(l, P(25, 1000))).toBe(0);
    expect(l.assumptions.join(' ')).toContain('cobrimento');
  });

  it('afastamentos que eliminam a região não geram lançamento', () => {
    expect(
      reason(region(rect(0, 0, 6000, 2450)), criteria({ edgeOffset: 1300 })),
    ).toContain('eliminam');
  });

  it('L côncavo com abertura: peças dentro da região, fora dos vazios e cobrindo tudo', () => {
    const outer = [
      P(0, 0),
      P(9000, 0),
      P(9000, 3000),
      P(4000, 3000),
      P(4000, 6000),
      P(0, 6000),
    ];
    const opening = rect(1000, 1000, 800, 600);
    const l = plan(
      region(outer, [opening]),
      criteria({ lengthOverlap: 300, widthOverlap: 150 }),
    );
    expect(l.usefulArea).toBeCloseTo(27e6 + 12e6 - 0.48e6, 3);
    expect(l.appliedArea - l.usefulArea).toBeCloseTo(l.overlapArea, 3);
    expect(l.overlapArea).toBeGreaterThan(0);
    for (let x = 13; x < 9000; x += 97)
      for (let y = 13; y < 6000; y += 97) {
        const p = P(x, y);
        const useful = pointInPolygon(p, outer) && !pointInPolygon(p, opening);
        if (useful) expect(layers(l, p)).toBeGreaterThanOrEqual(1);
        else expect(layers(l, p)).toBe(0);
      }
  });
});

describe('Malha desenhada (representação nominal)', () => {
  it('Q92: 16 fios longitudinais e 40 transversais por painel, nas direções certas', () => {
    const l = plan(region(rect(0, 0, 6000, 2450)), criteria());
    const { simplified, wires } = layoutWires(l);
    expect(simplified).toBe(false);
    const long = wires.filter((w) => w.kind === 'longitudinal');
    const trans = wires.filter((w) => w.kind === 'transverse');
    expect(long).toHaveLength(16);
    expect(trans).toHaveLength(40);
    for (const w of long) expect(Math.abs(w.a.y - w.b.y)).toBeLessThan(1e-6);
    for (const w of trans) expect(Math.abs(w.a.x - w.b.x)).toBeLessThan(1e-6);
    expect(new Set(wires.map((w) => w.diameter))).toEqual(new Set([4.2]));
  });

  it('modelo assimétrico girado 90°: sem trocar bitola, espaçamento nem direção', () => {
    const mesh = customWeldedMesh(
      catalogWeldedMesh('Q92')!,
      {
        designation: 'R-teste',
        family: 'R',
        longitudinal: { diameter: 6, spacing: 100, steelArea: 283 },
        transverse: { diameter: 4.2, spacing: 300, steelArea: 46 },
        massPerArea: 2.6,
        massPerPanel: 38.2,
      },
      'custom:r',
    );
    const l = plan(
      region(rect(0, 0, 2450, 6000)),
      criteria({ mesh, orientation: 90 }),
    );
    expect(l.basePanels).toBe(1);
    const { wires } = layoutWires(l);
    const long = wires.filter((w) => w.kind === 'longitudinal');
    const trans = wires.filter((w) => w.kind === 'transverse');
    // Longitudinais: paralelos ao comprimento do painel, agora em Y, Ø 6 a cada 100.
    expect(long).toHaveLength(24);
    for (const w of long) {
      expect(w.diameter).toBe(6);
      expect(Math.abs(w.a.x - w.b.x)).toBeLessThan(1e-6);
    }
    const xs = long.map((w) => w.a.x).sort((a, b) => a - b);
    xs.slice(1).forEach((x, i) => expect(x - xs[i]).toBeCloseTo(100, 6));
    // Transversais: paralelos à largura, agora em X, Ø 4,2 a cada 300.
    expect(trans).toHaveLength(20);
    for (const w of trans) {
      expect(w.diameter).toBe(4.2);
      expect(Math.abs(w.a.y - w.b.y)).toBeLessThan(1e-6);
    }
    expect(l.appliedMass).toBeCloseTo(14.7 * 2.6, 9);
  });

  it('fios não atravessam aberturas nem saem da região útil', () => {
    const outer = rect(0, 0, 6000, 2450),
      opening = rect(2000, 800, 500, 400);
    const l = plan(region(outer, [opening]), criteria());
    const { wires } = layoutWires(l);
    expect(wires.length).toBeGreaterThan(56);
    for (const w of wires) {
      const mid = P((w.a.x + w.b.x) / 2, (w.a.y + w.b.y) / 2);
      expect(pointInPolygon(mid, opening)).toBe(false);
      expect(pointInPolygon(mid, outer)).toBe(true);
    }
  });

  it('malha densa é simplificada sem mudar os quantitativos', () => {
    const l = plan(
      region(rect(0, 0, 6000, 4750)),
      criteria({ widthOverlap: 150 }),
    );
    const before = structuredClone(l);
    const r = layoutWires(l, 10);
    expect(r.simplified).toBe(true);
    expect(r.wires).toEqual([]);
    expect(l).toEqual(before);
    expect(l.appliedArea).toBeCloseTo(29.4e6, 6);
  });
});

describe('Validações e limites', () => {
  it('critérios inválidos não geram plano', () => {
    expect(
      reason(region(rect(0, 0, 6000, 2450)), criteria({ lengthOverlap: 6000 })),
    ).toContain('Sobreposição no comprimento');
  });

  it('limite explícito de painéis', () => {
    expect(LAYOUT_MAX_PANELS).toBe(5000);
    expect(reason(region(rect(0, 0, 1e6, 1e6)), criteria())).toContain('5.000');
  });
});
