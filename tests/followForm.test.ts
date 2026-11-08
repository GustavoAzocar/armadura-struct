import { toDxf, toPdf } from '../src/lib/exports';
import { parseDxf } from '../src/cad/import';
import { drawingPrimitives } from '../src/domain/drawingPrimitives';
import { composeSheet } from '../src/domain/paper';
import { placeDrawing } from '../src/domain/sheets';
import { describe, it, expect } from 'vitest';
import {
  buildFollowChain,
  chooseFollowSide,
  followEdges,
  previewFollow,
  physicalSegmentDistance,
  type FollowEdge,
} from '../src/domain/followForm';
import { geometry, distance, rotate, add, world } from '../src/domain/geometry';
import { newNativeMask, nativePrimitive } from '../src/domain/nativeMasks';
import {
  emptyProject,
  decodeProject,
  schedule,
  createScheduleLock,
} from '../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../src/domain/hierarchy';
import {
  executeRebarBatch,
  applyRebarBatch,
  rebarDefinition,
} from '../src/domain/rebarApi';
import { setLayerState } from '../src/domain/layerProfiles';
import { layerId } from '../src/domain/layers';
import { hideObjects } from '../src/domain/visibility';
import type { Point } from '../src/domain/types';
const v = (x: number, y: number) => ({ x, y });
const params = {
  cover: 30,
  diameter: 10,
  mandrel: 50,
  quantity: 1,
  extra: 0,
  extraReason: '',
};
const edges = (points: Point[], closed = false): FollowEdge[] =>
  points.slice(0, closed ? undefined : -1).map((a, i) => ({
    key: String(i),
    maskId: 'mask',
    primitiveIndex: i,
    edgeIndex: 0,
    label: 'face ' + i,
    a,
    b: points[(i + 1) % points.length],
  }));
const U = [v(0, 1000), v(0, 0), v(2000, 0), v(2000, 1000)];
const square = [v(0, 0), v(1000, 0), v(1000, 1000), v(0, 1000)];
const preview = (ps: Point[], point: Point, closed = false) =>
  previewFollow(edges(ps, closed), point, false, params);
describe('Seguir fôrma: cadeia e lado físicos, antes de criar aço', () => {
  it('linha de 1000: c + Ø/2, dois lados, sem desconto axial; reversão não troca o lado', () => {
    for (const ps of [
      [v(0, 0), v(1000, 0)],
      [v(1000, 0), v(0, 0)],
    ])
      for (const y of [-200, 200]) {
        const p = preview(ps, v(500, y));
        expect(p.offset).toBe(35);
        expect(p.theoretical).toEqual([
          v(0, Math.sign(y) * 35),
          v(1000, Math.sign(y) * 35),
        ]);
        expect(p.physical.length).toBe(1000);
        expect(p.physical.segments).toHaveLength(1);
      }
  });
  it('U: todas as ordens e sentidos produzem os vértices e 3740 + 30π mm', () => {
    for (const order of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ])
      for (const reversed of [false, true]) {
        const raw = edges(U),
          e = order.map((i) =>
            reversed ? { ...raw[i], a: raw[i].b, b: raw[i].a } : raw[i],
          );
        const p = previewFollow(e, v(1000, 500), false, params);
        expect(p.theoretical).toEqual([
          v(35, 1000),
          v(35, 35),
          v(1965, 35),
          v(1965, 1000),
        ]);
        expect(
          p.physical.segments.filter((s) => s.type === 'arc'),
        ).toHaveLength(2);
        expect(p.radius).toBe(30);
        expect(p.physical.length).toBeCloseTo(3740 + 30 * Math.PI, 9);
        for (let i = 1; i < p.physical.segments.length; i++)
          expect(
            distance(p.physical.segments[i - 1].b, p.physical.segments[i].a),
          ).toBeLessThan(1e-8);
      }
  });
  it('polilinha, linhas independentes e três arestas de retângulo são equivalentes', () => {
    const results = [
      edges(U),
      edges([...U].reverse()),
      edges([...U, v(0, 1000)], false).slice(0, 3),
    ];
    results.forEach((e) =>
      expect(
        previewFollow(e, v(1000, 500), false, params).physical.length,
      ).toBeCloseTo(3740 + 30 * Math.PI, 9),
    );
  });
  it.each([false, true])(
    'quadrado fechado com referências invertidas=%s: interior e exterior, quatro curvas e continuidade sem duplicar aço',
    (reversed) => {
      const ps = reversed ? [...square].reverse() : square;
      for (const [pick, side, expected] of [
        [v(500, 500), 'Interior', 3480 + 60 * Math.PI],
        [v(1200, 500), 'Exterior', 4040 + 60 * Math.PI],
      ] as const) {
        const p = preview(ps, pick, true);
        expect(p.side.label).toBe(side);
        expect(p.physical.length).toBeCloseTo(expected, 9);
        expect(
          p.physical.segments.filter((s) => s.type === 'arc'),
        ).toHaveLength(4);
        expect(
          distance(p.worldSegments[0].a, p.worldSegments.at(-1)!.b),
        ).toBeLessThan(1e-8);
        expect(p.bar.kind).toBe('free');
        expect(p.bar.distribution).toBeUndefined();
        expect(p.bar.manufacturing).toBeUndefined();
        const restored = decodeProject(
          JSON.stringify(
            completeOwnership({
              ...emptyProject(),
              bars: [{ ...p.bar, mark: 'N1' }],
            }),
          ),
        );
        expect(geometry(restored.bars[0]).length).toBeCloseTo(expected, 9);
      }
    },
  );
  it('L fechado com canto côncavo, cadeia inclinada e translação preservam a geometria', () => {
    const ps = [
      v(0, 0),
      v(1000, 0),
      v(1000, 500),
      v(500, 500),
      v(500, 1000),
      v(0, 1000),
    ];
    const a = preview(ps, v(200, 200), true);
    expect(a.physical.segments.filter((s) => s.type === 'arc')).toHaveLength(6);
    const transform = (p: Point) => add(rotate(p, 37), v(10000, -3400));
    const b = preview(ps.map(transform), transform(v(200, 200)), true);
    expect(a.physical.length).toBeCloseTo(b.physical.length, 8);
    const u = preview(U.map(transform), transform(v(1000, 500)));
    expect(u.physical.length).toBeCloseTo(3740 + 30 * Math.PI, 8);
  });
  it('inverter lado requer um clique prévio e preserva o parâmetro explícito', () => {
    const e = edges([v(0, 0), v(1000, 0)]);
    expect(() => previewFollow(e, undefined, true, params)).toThrow(/lado/);
    expect(previewFollow(e, v(500, 100), true, params).theoretical[0].y).toBe(
      -35,
    );
    expect(() => chooseFollowSide(buildFollowChain(e), v(500, 0))).toThrow(
      /afastado/,
    );
    expect(() => chooseFollowSide(buildFollowChain(e), v(1500, 0))).toThrow(
      /ambíguo/,
    );
    expect(() => previewFollow([], v(0, 0), false, params)).toThrow(
      /Selecione/,
    );
  });
  it('tolerância explícita de 0,1mm ajusta apenas pontas próximas e informa cada ajuste', () => {
    const e = edges([v(0, 0), v(1000, 0), v(1000, 1000)]);
    e[1].a = v(1000.05, 0);
    const chain = buildFollowChain(e);
    expect(chain.adjustments).toHaveLength(2);
    chain.adjustments.forEach((a) => expect(a.distance).toBeCloseTo(0.025, 8));
    expect(e[1].a.x).toBe(1000.05);
    e[1].a = v(1000.11, 0);
    expect(() => buildFollowChain(e)).toThrow(/desconectados/);
  });
  it('colinearidade só consolida avanços e não muda a forma/comprimento', () => {
    const p = preview([v(0, 0), v(200, 0), v(1000, 0)], v(500, 200));
    expect(p.chain.points).toEqual([v(0, 0), v(1000, 0)]);
    expect(p.physical.length).toBe(1000);
    expect(() => preview([v(0, 0), v(1000, 0), v(500, 0)], v(0, 100))).toThrow(
      /180|sobrepostos/,
    );
  });
  it('duplicatas, desconexão, ramificações, sobreposição e autointerseções são recusadas sem ligações inventadas', () => {
    const a = edges(U);
    expect(() => buildFollowChain([a[0], a[0]])).toThrow(/duplicidade/);
    expect(() => buildFollowChain([...a, { ...a[0], key: 'clone' }])).toThrow(
      /duplicados/,
    );
    expect(() =>
      buildFollowChain([
        ...a,
        { ...a[0], key: 'branch', a: v(0, 0), b: v(-500, 0) },
      ]),
    ).toThrow(/ramificada/);
    expect(() => buildFollowChain([a[0], a[2]])).toThrow(/desconectados/);
    expect(() =>
      preview([v(0, 0), v(1000, 1000), v(0, 1000), v(1000, 0)], v(100, 0)),
    ).toThrow(/autointerseção/);
    expect(() =>
      previewFollow(
        [{ ...a[0], unsupported: 'Arco sem suporte' }],
        v(0, 0),
        false,
        params,
      ),
    ).toThrow(/Arco/);
  });
  it('colapso, dobra curta e envelope externo incompatível impedem a confirmação', () => {
    expect(() =>
      previewFollow(edges(square, true), v(500, 500), false, {
        ...params,
        cover: 600,
      }),
    ).toThrow(/excessivo|colapsou/);
    expect(() => preview([v(0, 0), v(20, 0), v(20, 20)], v(10, 10))).toThrow();
    expect(() =>
      previewFollow(edges(square, true), v(1200, 500), false, {
        ...params,
        mandrel: 150,
      }),
    ).toThrow(/viola/);
    expect(() =>
      previewFollow(edges(square, true), v(500, 500), false, {
        ...params,
        mandrel: 2000,
      }),
    ).toThrow(/insuficiente/);
  });
  it('parâmetros e adicional são explícitos, sem alterar o cobrimento herdado', () => {
    const e = edges([v(0, 0), v(1000, 0)]);
    for (const patch of [
      { cover: NaN },
      { cover: -1 },
      { diameter: 0 },
      { mandrel: -3 },
      { quantity: 1.5 },
      { extra: -1 },
      { extra: 10 },
    ])
      expect(() =>
        previewFollow(e, v(500, 200), false, { ...params, ...patch }),
      ).toThrow();
    const configured = { ...params, cover: 42 };
    expect(previewFollow(e, v(500, 200), false, configured).offset).toBe(47);
    expect(
      previewFollow(e, v(500, 200), false, {
        ...configured,
        cover: 55,
        extra: 8,
        extraReason: 'camada intermediária informada',
      }).offset,
    ).toBe(68);
    const noted = previewFollow(e, v(500, 200), false, {
      ...configured,
      extra: 8,
      extraReason: 'camada intermediária informada',
    });
    expect(noted.bar.comment).toContain(
      'adicional 8 mm (camada intermediária informada)',
    );
    expect(() =>
      previewFollow(e, v(500, 200), false, {
        ...configured,
        extraReason: 'x'.repeat(201),
      }),
    ).toThrow(/200/);
    const project = completeOwnership({
      ...emptyProject(),
      bars: [{ ...noted.bar, mark: 'N1' }],
    });
    expect(decodeProject(JSON.stringify(project)).bars[0].comment).toBe(
      noted.bar.comment,
    );
    expect(configured.cover).toBe(42);
  });
  it('captura respeita contexto, visibilidade, layers e geometria local de importadas/nativas', () => {
    let p = emptyProject();
    const owner = p.hierarchy.details[0].id;
    const m = {
      ...newNativeMask('Fôrma'),
      format: 'DXF' as const,
      sourceUnit: 'cm',
      scale: 10,
      rotation: 37,
      origin: v(500, -300),
      primitives: [{ layer: 'FORMA', points: [v(0, 0), v(100, 0)] }],
    };
    p = completeOwnership({ ...p, masks: [m] });
    const context = { key: 'model', detailId: owner };
    const e = followEdges(p, context);
    expect(e).toHaveLength(1);
    expect(distance(e[0].a, e[0].b)).toBeCloseTo(1000, 8);
    expect(
      followEdges(p, { ...context, key: 'sheet:' + p.sheets[0].id }),
    ).toEqual([]);
    const other = createHierarchyNode(
      p,
      'detail',
      'V2',
      p.hierarchy.elements[0].id,
    );
    expect(
      followEdges(other.project, { ...context, detailId: other.id }),
    ).toEqual([]);
    expect(followEdges(hideObjects(p, 'model', [m.id]), context)).toEqual([]);
    expect(
      followEdges(
        setLayerState(p, 'model', layerId('MASCARA'), { capture: false }),
        context,
      ),
    ).toEqual([]);
    expect(
      followEdges(
        completeOwnership({
          ...p,
          masks: [
            {
              ...newNativeMask('Nativa'),
              primitives: [
                nativePrimitive({
                  kind: 'rectangle',
                  points: [v(0, 0), v(2000, 1000)],
                  closed: true,
                }),
              ],
            },
          ],
        }),
        context,
      ),
    ).toHaveLength(4);
  });
  it('prévia não altera o projeto; a API cria uma única ocorrência, invalida RA bloqueada, salva/reabre e mantém a máscara', () => {
    let p = emptyProject();
    p = completeOwnership({
      ...p,
      masks: [
        {
          ...newNativeMask('Sapata'),
          primitives: U.slice(0, -1).map((a, i) =>
            nativePrimitive({
              kind: 'line',
              points: [a, U[i + 1]],
              closed: false,
            }),
          ),
        },
      ],
    });
    p = { ...p, scheduleLock: createScheduleLock(p) };
    const before = JSON.stringify(p),
      owner = p.hierarchy.details[0].id;
    const a = previewFollow(
      followEdges(p, { key: 'model', detailId: owner }),
      v(1000, 500),
      false,
      params,
    );
    expect(JSON.stringify(p)).toBe(before);
    const batch = executeRebarBatch(
      p,
      [
        {
          type: 'bar.create',
          detailId: owner,
          definition: { ...rebarDefinition(a.bar), mark: 'N1' },
        },
      ],
      { units: 'mm', schedule: 'invalidate-lock' },
    );
    const q = applyRebarBatch(p, batch);
    expect(q.bars).toHaveLength(1);
    expect(schedule(q)[0].quantity).toBe(1);
    expect(q.scheduleLock).toBeUndefined();
    expect(q.masks).toEqual(p.masks);
    expect(geometry(q.bars[0]).length).toBeCloseTo(3740 + 30 * Math.PI, 9);
    expect(q.bars[0].points.map((x) => world(x, q.bars[0]))).toEqual(
      a.theoretical,
    );
    expect(decodeProject(JSON.stringify(q))).toEqual(q);
  });
  it('CAD, prancha, DXF e PDF consomem a geometria confirmada; o exemplo não depende de estado transitório', () => {
    const a = preview(U, v(1000, 500));
    const p = completeOwnership({
      ...emptyProject(),
      bars: [{ ...a.bar, id: 'physical', mark: 'N1' }],
    });
    const lines = drawingPrimitives(p).filter(
      (q) => q.layer === 'ARMADURAS' && !q.text,
    );
    expect(lines).toHaveLength(1);
    const dxf = parseDxf(toDxf(p), 'Conferência');
    const exported = dxf.primitives.find(
      (q) => q.layer === 'ARMADURAS' && !q.text,
    )!;
    expect(exported.points).toHaveLength(lines[0].points.length);
    exported.points.forEach((pt, i) =>
      expect(distance(pt, lines[0].points[i])).toBeLessThan(1e-5),
    );
    expect(new TextDecoder().decode(toPdf(p).slice(0, 5))).toBe('%PDF-');
    const sheet = placeDrawing(
      p,
      p.sheets[0].id,
      p.hierarchy.drawings[0].id,
    ).project;
    const composed = composeSheet(sheet, sheet.sheets[0].id)
      .views.flatMap((v) => v.content)
      .filter((q) => q.layer === 'ARMADURAS' && !q.text);
    expect(composed).toHaveLength(1);
    expect(geometry(p.bars[0]).length).toBeCloseTo(3740 + 30 * Math.PI, 9);
    expect(schedule(sheet)).toEqual(schedule(p));
  });
  it('distância analítica detecta encontro reta/arco e arcos opostos sem depender de amostragem', () => {
    const arc = {
      type: 'arc' as const,
      center: v(0, 0),
      radius: 10,
      startAngle: 0,
      angle: Math.PI / 2,
      a: v(10, 0),
      b: v(0, 10),
    };
    expect(
      physicalSegmentDistance(arc, { type: 'line', a: v(7, -5), b: v(7, 15) }),
    ).toBe(0);
    expect(
      physicalSegmentDistance(arc, {
        type: 'line',
        a: v(20, -5),
        b: v(20, 15),
      }),
    ).toBeCloseTo(10, 9);
    expect(
      physicalSegmentDistance(arc, {
        ...arc,
        center: v(10, 0),
        startAngle: Math.PI / 2,
        a: v(10, 10),
        b: v(0, 0),
      }),
    ).toBe(0);
  });
});
