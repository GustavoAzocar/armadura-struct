import { describe, expect, it } from 'vitest';
import {
  createSnapIndex,
  defaultSnapModes,
  maskSnapSource,
  resolveObjectSnap,
  closedCurveCentroid,
  perpendicularPoints,
  tangentPoints,
  type SnapModes,
  type SnapSource,
} from '../src/domain/objectSnaps';
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
const line = (id: string, a: Point, b: Point): SnapSource => ({
  id,
  curve: pathCurve([a, b], false),
});

describe('relações com ponto-base · #164', () => {
  it('perpendicular no segmento finito (0,0)–(10,0), sem prolongamento implícito', () => {
    const c = pathCurve(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      false,
    );
    expect(perpendicularPoints(c, { x: 4, y: 3 })).toEqual([{ x: 4, y: 0 }]);
    expect(perpendicularPoints(c, { x: 11, y: 3 })).toEqual([]);
    expect(perpendicularPoints(c, { x: 4, y: 0 })).toEqual([]);
  });
  it('perpendicular radial respeita a varredura e não escolhe direção arbitrária no centro', () => {
    const c = roundCurve({ x: 0, y: 0 }, 5, 0, TAU, true);
    expect(perpendicularPoints(c, { x: 10, y: 0 })).toEqual([
      { x: 5, y: 0 },
      { x: -5, y: 0 },
    ]);
    expect(perpendicularPoints(c, { x: 0, y: 0 })).toEqual([]);
    expect(
      perpendicularPoints(roundCurve({ x: 0, y: 0 }, 5, 0, Math.PI / 2), {
        x: 10,
        y: 0,
      }),
    ).toEqual([{ x: 5, y: 0 }]);
  });
  it('duas tangências do círculo R5 a partir de (5,5), com escolha pelo cursor', () => {
    const c = roundCurve({ x: 0, y: 0 }, 5, 0, TAU, true);
    const points = tangentPoints(c, { x: 5, y: 5 });
    expect(points).toHaveLength(2);
    expectPoint(points[0], { x: 0, y: 5 });
    expectPoint(points[1], { x: 5, y: 0 });
    const index = createSnapIndex([{ id: 'circle', curve: c }]);
    for (const point of [
      { x: 0, y: 5 },
      { x: 5, y: 0 },
    ])
      expectPoint(
        resolveObjectSnap(index, point, {
          enabled: true,
          modes: modes('tangent'),
          tolerance: 1,
          base: { x: 5, y: 5 },
        }).candidate?.point,
        point,
      );
  });
  it('arco que contém uma tangência não oferece a outra; base interior ou sobre a curva não produz tangente nula', () => {
    const arc = roundCurve({ x: 0, y: 0 }, 5, -0.2, 0.4);
    expect(tangentPoints(arc, { x: 5, y: 5 })).toHaveLength(1);
    expectPoint(tangentPoints(arc, { x: 5, y: 5 })[0], { x: 5, y: 0 });
    expect(tangentPoints(arc, { x: 1, y: 0 })).toEqual([]);
    expect(tangentPoints(arc, { x: 5, y: 0 })).toEqual([]);
    expect(
      tangentPoints(
        pathCurve(
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          false,
        ),
        { x: 5, y: 5 },
      ),
    ).toEqual([]);
  });
  it('sem base não oferece relações e o desempate é determinístico', () => {
    const index = createSnapIndex([
      { id: 'circle', curve: roundCurve({ x: 0, y: 0 }, 5, 0, TAU, true) },
    ]);
    const options = {
      enabled: true,
      modes: modes('perpendicular', 'tangent'),
      tolerance: 10,
    };
    expect(
      resolveObjectSnap(index, { x: 5, y: 0 }, options).candidate,
    ).toBeUndefined();
    const initial = resolveObjectSnap(
      index,
      { x: 2.5, y: 2.5 },
      { ...options, base: { x: 5, y: 5 } },
    );
    for (let i = 0; i < 10; i++)
      expect(
        resolveObjectSnap(
          index,
          { x: 2.5, y: 2.5 },
          { ...options, base: { x: 5, y: 5 } },
        ),
      ).toEqual(initial);
  });
  it('perpendicular em máscara importada girada e escalada usa a base real do modelo', () => {
    const mask = {
      ...newNativeMask('DXF'),
      format: 'DXF' as const,
      origin: { x: 100, y: -40 },
      rotation: 37,
      scale: 3,
    };
    const source = maskSnapSource(
      mask,
      {
        layer: 'DESENHO',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
      0,
    );
    const foot = maskPoint({ x: 4, y: 0 }, mask),
      base = maskPoint({ x: 4, y: 3 }, mask);
    expectPoint(
      resolveObjectSnap(createSnapIndex([source]), foot, {
        enabled: true,
        modes: modes('perpendicular'),
        tolerance: 0.1,
        base,
      }).candidate?.point,
      foot,
    );
  });
});
const snap = (
  sources: SnapSource[],
  raw: Point,
  active: (keyof SnapModes)[],
  tolerance = 0.1,
) =>
  resolveObjectSnap(createSnapIndex(sources), raw, {
    enabled: true,
    modes: modes(...active),
    tolerance,
  }).candidate;
const expectPoint = (actual: Point | undefined, expected: Point) => {
  expect(actual).toBeDefined();
  expect(actual!.x).toBeCloseTo(expected.x, 7);
  expect(actual!.y).toBeCloseTo(expected.y, 7);
};

describe('encaixes por pontos e curvas · #163', () => {
  it('mantém somente os dois modos antigos ativos por padrão', () => {
    expect(
      Object.entries(defaultSnapModes)
        .filter(([, v]) => v)
        .map(([k]) => k),
    ).toEqual(['endpoint', 'midpoint']);
  });
  it('desliga inclusive pontos extras e recusa abertura/coordenadas inválidas', () => {
    const index = createSnapIndex([
      line('a', { x: 0, y: 0 }, { x: 100, y: 0 }),
    ]);
    for (const patch of [
      { enabled: false },
      { tolerance: 0 },
      { tolerance: Infinity },
    ])
      expect(
        resolveObjectSnap(
          index,
          { x: 0, y: 0 },
          {
            enabled: true,
            modes: defaultSnapModes,
            tolerance: 10,
            extra: [{ x: 0, y: 0 }],
            ...patch,
          },
        ).candidate,
      ).toBeUndefined();
    expect(
      resolveObjectSnap(
        index,
        { x: NaN, y: 0 },
        { enabled: true, modes: defaultSnapModes, tolerance: 10 },
      ).candidate,
    ).toBeUndefined();
  });
  it('reproduz o resolvedor anterior, incluindo ordem dos empates, vértices amostrados e pontos extras', () => {
    const chains = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      },
      {
        points: [
          { x: -10, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    ];
    const extra = [
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ];
    const index = createSnapIndex([], chains);
    for (let x = -12; x <= 12; x += 0.8)
      for (let y = -5; y <= 12; y += 1.3) {
        const raw = { x, y };
        let expected: Point | undefined,
          best = 3;
        const accept = (p: Point) => {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < best) {
            best = d;
            expected = p;
          }
        };
        extra.forEach(accept);
        for (const chain of chains)
          chain.points.forEach((p, i) => {
            accept(p);
            if (i)
              accept({
                x: (p.x + chain.points[i - 1].x) / 2,
                y: (p.y + chain.points[i - 1].y) / 2,
              });
          });
        expect(
          resolveObjectSnap(index, raw, {
            enabled: true,
            modes: defaultSnapModes,
            tolerance: 3,
            extra,
          }).candidate?.point,
        ).toEqual(expected);
      }
    expect(
      resolveObjectSnap(
        index,
        { x: 5, y: 0 },
        { enabled: true, modes: defaultSnapModes, tolerance: 3, extra },
      ).candidate?.mode,
    ).toBe('extra');
  });
  it('centro (100,50) e quadrante (120,50) de círculo analítico R20', () => {
    const sources = [
      { id: 'circle', curve: roundCurve({ x: 100, y: 50 }, 20, 0, TAU, true) },
    ];
    expect(snap(sources, { x: 100.01, y: 50 }, ['center'])?.point).toEqual({
      x: 100,
      y: 50,
    });
    expectPoint(snap(sources, { x: 120, y: 50.01 }, ['quadrant'])?.point, {
      x: 120,
      y: 50,
    });
    expect(snap(sources, { x: 100, y: 50 }, ['endpoint'])).toBeUndefined();
  });
  it.each([1, -1])(
    'quadrantes respeitam varredura e sentido %s do arco',
    (sign) => {
      const arc = [
        {
          id: 'arc',
          curve: roundCurve(
            { x: 0, y: 0 },
            20,
            (sign * Math.PI) / 4,
            (sign * Math.PI) / 2,
          ),
        },
      ];
      expectPoint(snap(arc, { x: 0, y: sign * 20 }, ['quadrant'])?.point, {
        x: 0,
        y: sign * 20,
      });
      expect(snap(arc, { x: 20, y: 0 }, ['quadrant'])).toBeUndefined();
      expect(snap(arc, { x: -20, y: 0 }, ['quadrant'])).toBeUndefined();
    },
  );
  it('centro de área do triângulo é (30,20), independentemente da orientação', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 90, y: 0 },
      { x: 0, y: 60 },
    ];
    for (const pts of [points, [...points].reverse(), [...points, points[0]]])
      expectPoint(closedCurveCentroid(pathCurve(pts, true)), { x: 30, y: 20 });
    expectPoint(
      snap(
        [{ id: 'triangle', curve: pathCurve(points, true) }],
        { x: 30.02, y: 20.02 },
        ['geometricCenter'],
      )?.point,
      { x: 30, y: 20 },
    );
  });
  it('usa área de polígono côncavo, não média dos vértices, e tolera origem distante', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 4 },
      { x: 0, y: 4 },
    ];
    expectPoint(closedCurveCentroid(pathCurve(pts, true)), {
      x: 19 / 14,
      y: 19 / 14,
    });
    expectPoint(
      closedCurveCentroid(
        pathCurve(
          pts.map((p) => ({ x: p.x + 1e8, y: p.y - 1e8 })),
          true,
        ),
      ),
      { x: 1e8 + 19 / 14, y: -1e8 + 19 / 14 },
    );
  });
  it('não oferece centro de área em caminho aberto, colinear ou autocruzado', () => {
    for (const c of [
      pathCurve(
        [
          { x: 0, y: 0 },
          { x: 90, y: 0 },
          { x: 0, y: 60 },
        ],
        false,
      ),
      pathCurve(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
        true,
      ),
      pathCurve(
        [
          { x: 0, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
          { x: 20, y: 0 },
        ],
        true,
      ),
    ])
      expect(closedCurveCentroid(c)).toBeUndefined();
  });
  it('interseção real em (50,0), sem prolongar o segmento', () => {
    const first = line('first', { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(
      snap(
        [first, line('cross', { x: 50, y: -40 }, { x: 50, y: 40 })],
        { x: 50, y: 0.01 },
        ['intersection'],
      )?.point,
    ).toEqual({ x: 50, y: 0 });
    expect(
      snap(
        [first, line('outside', { x: 120, y: -40 }, { x: 120, y: 40 })],
        { x: 120, y: 0 },
        ['intersection'],
        30,
      ),
    ).toBeUndefined();
  });
  it('sobreposição não inventa interseção, mas contato único de pontas é válido', () => {
    const a = line('a', { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(
      snap(
        [a, line('overlap', { x: 20, y: 0 }, { x: 80, y: 0 })],
        { x: 40, y: 0 },
        ['intersection'],
      ),
    ).toBeUndefined();
    expect(
      snap(
        [a, line('touch', { x: 100, y: 0 }, { x: 120, y: 0 })],
        { x: 100, y: 0 },
        ['intersection'],
      )?.point,
    ).toEqual({ x: 100, y: 0 });
  });
  it('interseções linha/círculo e círculo/círculo respeitam arcos finitos e coincidência', () => {
    const circle: SnapSource = {
      id: 'round',
      curve: roundCurve({ x: 0, y: 0 }, 5, 0, TAU, true),
    };
    expectPoint(
      snap(
        [circle, line('axis', { x: -10, y: 0 }, { x: 10, y: 0 })],
        { x: 5, y: 0 },
        ['intersection'],
      )?.point,
      { x: 5, y: 0 },
    );
    expect(
      snap([circle, { ...circle, id: 'coincident' }], { x: 5, y: 0 }, [
        'intersection',
      ]),
    ).toBeUndefined();
    expectPoint(
      snap(
        [
          circle,
          { id: 'second', curve: roundCurve({ x: 6, y: 0 }, 5, 0, TAU, true) },
        ],
        { x: 3, y: 4 },
        ['intersection'],
      )?.point,
      { x: 3, y: 4 },
    );
  });
  it('Ponto mais próximo projeta em (40,0) e respeita as pontas finitas', () => {
    const sources = [line('line', { x: 0, y: 0 }, { x: 100, y: 0 })];
    expect(snap(sources, { x: 40, y: 5 }, ['nearest'], 10)?.point).toEqual({
      x: 40,
      y: 0,
    });
    expect(snap(sources, { x: 104, y: 1 }, ['nearest'], 10)?.point).toEqual({
      x: 100,
      y: 0,
    });
  });
  it('ponto discreto vence projeção mais próxima e os modos desligados não competem', () => {
    const sources = [line('line', { x: 0, y: 0 }, { x: 100, y: 0 })];
    expect(
      snap(sources, { x: 4, y: 1 }, ['nearest', 'endpoint'], 10)?.mode,
    ).toBe('endpoint');
    expect(snap(sources, { x: 4, y: 1 }, ['nearest'], 10)?.point).toEqual({
      x: 4,
      y: 0,
    });
  });
  it('transforma máscara exatamente uma vez e usa âncora real de texto', () => {
    const mask = {
      ...newNativeMask('Transformada'),
      origin: { x: 300, y: -200 },
      rotation: 37,
      scale: 2,
    };
    const circle = nativePrimitive({
      kind: 'circle',
      center: { x: 100, y: 50 },
      radius: 20,
    });
    const source = maskSnapSource(mask, circle, 0),
      center = maskPoint({ x: 100, y: 50 }, mask);
    expectPoint(snap([source], center, ['center'])?.point, center);
    expectPoint(
      snap([source], { x: center.x + 40, y: center.y }, ['quadrant'])?.point,
      { x: center.x + 40, y: center.y },
    );
    const text = {
      ...nativePrimitive({ kind: 'text', at: { x: 7, y: 11 } }),
      text: 'Âncora',
    };
    const at = maskPoint({ x: 7, y: 11 }, mask);
    expectPoint(
      snap([maskSnapSource(mask, text, 1)], at, ['insertion'])?.point,
      at,
    );
  });
  it.each(['DXF', 'DWG'] as const)(
    '%s amostrado não ganha centro, quadrante ou semântica de nó',
    (format) => {
      const mask = {
        ...newNativeMask('Amostrada'),
        format,
        rotation: 20,
        scale: 2,
      };
      const primitive = {
        layer: 'FORMA',
        closed: true,
        points: Array.from({ length: 16 }, (_, i) => ({
          x: 20 * Math.cos((i * TAU) / 16),
          y: 20 * Math.sin((i * TAU) / 16),
        })),
      };
      const source = maskSnapSource(mask, primitive, 0);
      expect(source.curve?.kind).toBe('path');
      expect(
        snap(
          [source],
          maskPoint({ x: 0, y: 0 }, mask),
          ['center', 'quadrant', 'node'],
          100,
        ),
      ).toBeUndefined();
    },
  );
  it('Nó requer semântica explícita; vértice de caminho não se transforma em Nó', () => {
    expect(
      snap([line('path', { x: 0, y: 0 }, { x: 10, y: 0 })], { x: 0, y: 0 }, [
        'node',
      ]),
    ).toBeUndefined();
    expect(
      snap([{ id: 'point-object', node: { x: 3, y: 4 } }], { x: 3, y: 4 }, [
        'node',
      ])?.point,
    ).toEqual({ x: 3, y: 4 });
  });
  it('busca espacial limita pares à vizinhança da abertura em cena de 20 mil entidades', () => {
    const sources = Array.from({ length: 20000 }, (_, i) =>
      line(
        `dense:${i}`,
        { x: (i % 200) * 160, y: Math.floor(i / 200) * 240 },
        { x: (i % 200) * 160 + 100, y: Math.floor(i / 200) * 240 + 60 },
      ),
    );
    sources.push(line('cross', { x: 50, y: -10 }, { x: 50, y: 80 }));
    const stats = { points: 0, curves: 0, pairs: 0 };
    const hit = resolveObjectSnap(
      createSnapIndex(sources),
      { x: 50, y: 30 },
      {
        enabled: true,
        modes: modes('intersection', 'nearest'),
        tolerance: 5,
        stats,
      },
    );
    expectPoint(hit.candidate?.point, { x: 50, y: 30 });
    expect(stats.curves).toBeLessThan(10);
    expect(stats.points).toBeLessThan(20);
    expect(stats.pairs).toBeLessThan(10);
    expect(hit.limited).toBe(false);
  });
});
