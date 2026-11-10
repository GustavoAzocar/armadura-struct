import { describe, it, expect } from 'vitest';
import { maskManipFixture } from './fixtures/maskManipulation';
import { maskCadEntities } from '../src/domain/maskCadEditing';
import {
  previewMaskManipulation,
  applyMaskManipulation,
  previewWholeMaskMove,
  applyWholeMaskMove,
} from '../src/domain/maskManipulation';
import { nativePrimitive, validateNativeMask } from '../src/domain/nativeMasks';
import { maskPoint, parseDxf } from '../src/cad/import';
import { decodeProject, schedule } from '../src/domain/model';
import { setLayerState } from '../src/domain/layerProfiles';
import {
  captureMaskReference,
  dimensionReferenceIssue,
} from '../src/domain/maskDimensions';
import { toCsv, toDxf, toPdf } from '../src/lib/exports';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import type { Annotation, Point, Project } from '../src/domain/types';
const ctx = (p: Project) => ({
  key: 'model',
  detailId: p.hierarchy.objectDetails[p.masks[0].id],
});
const refs = (p: Project) =>
  maskCadEntities(p, ctx(p))
    .filter((e) => e.mask.id === p.masks[0].id)
    .map((e) => e.ref);
const base = { x: 100, y: 100 },
  target = { x: 350, y: 50 },
  delta = { x: target.x - base.x, y: target.y - base.y };
const move = (p: Project, d: Point = delta, selected = refs(p).slice(0, 2)) =>
  applyMaskManipulation(
    p,
    previewMaskManipulation(p, p.masks[0].id, selected, 'move', ctx(p), {
      kind: 'translate',
      delta: d,
    }),
    ctx(p),
  );
const moveWhole = (p: Project, d: Point = delta) =>
  applyWholeMaskMove(
    p,
    previewWholeMaskMove(p, p.masks[0].id, ctx(p), d),
    ctx(p),
  );
const near = (a: Point, b: Point, digits = 7) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const world = (p: Project, i: number) =>
  p.masks[0].primitives[i].points.map((v) => maskPoint(v, p.masks[0]));
const dimension = (p: Project): Annotation => {
  const m = p.masks[0];
  const points = [
    maskPoint(m.primitives[0].points[0], m),
    maskPoint(m.primitives[0].points[1], m),
    { x: 500, y: -400 },
  ];
  const a: Annotation = {
    id: 'mask-dimension',
    kind: 'dimension-aligned',
    points,
    label: '',
    textHeight: 50,
    color: '#123456',
    maskReferences: [
      captureMaskReference(p, ctx(p), m.id, points[0], 0)!,
      captureMaskReference(p, ctx(p), m.id, points[1], 1)!,
    ],
  };
  p.annotations.push(a);
  p.hierarchy.objectDetails[a.id] = ctx(p).detailId;
  return a;
};
describe('Mover entidades e máscara inteira', () => {
  it('duas entidades de (100,100) a (350,50): Δ=(250,−50); terceira entidade, aço, RA/CSV e outras máscaras intactos', () => {
    const p = maskManipFixture();
    p.masks[0].primitives[0].style = { color: '#123456', lineWidth: 0.5 };
    p.masks[0].primitives[1].layerId = p.layers[0].id;
    const q = move(p);
    expect(delta).toEqual({ x: 250, y: -50 });
    for (const i of [0, 1])
      world(p, i).forEach((v, j) =>
        near(world(q, i)[j], { x: v.x + 250, y: v.y - 50 }),
      );
    const circle = q.masks[0].primitives[1].native!;
    expect(circle).toMatchObject({ kind: 'circle', radius: 100 });
    if (circle.kind !== 'circle') throw Error();
    near(circle.center, { x: 250, y: 450 });
    // IDs, layers, style and lineage stay with the moved entities.
    expect(q.masks[0].primitives.map((v) => v.id)).toEqual(
      p.masks[0].primitives.map((v) => v.id),
    );
    expect(q.masks[0].primitives[0].style).toEqual(
      p.masks[0].primitives[0].style,
    );
    expect(q.masks[0].primitives[1].layerId).toBe(p.layers[0].id);
    expect(q.masks[0].primitives[2]).toBe(p.masks[0].primitives[2]);
    expect(q.masks[0].primitives).toHaveLength(3);
    expect(q.masks[0].origin).toEqual(p.masks[0].origin);
    expect(q.masks[0].scale).toBe(p.masks[0].scale);
    expect(q.masks[0].rotation).toBe(p.masks[0].rotation);
    expect(q.masks[1]).toBe(p.masks[1]);
    expect(q.bars).toBe(p.bars);
    expect(q.annotations).toBe(p.annotations);
    expect(q.hierarchy).toBe(p.hierarchy);
    expect(q.scheduleLock).toBe(p.scheduleLock);
    expect(schedule(q)).toEqual(schedule(p));
    expect(toCsv(q)).toBe(toCsv(p));
    validateNativeMask(q.masks[0]);
  });
  it('máscara girada 30° e escala 2: mesmo deslocamento global, sem fator duplicado; escala/rotação/origem preservadas', () => {
    const p = maskManipFixture();
    Object.assign(p.masks[0], {
      rotation: 30,
      scale: 2,
      origin: { x: 750, y: -320 },
      format: 'DXF',
      sourceUnit: 'cm',
    });
    const q = move(p, delta, refs(p));
    p.masks[0].primitives.forEach((_, i) =>
      world(p, i).forEach((v, j) =>
        near(world(q, i)[j], { x: v.x + 250, y: v.y - 50 }),
      ),
    );
    expect(q.masks[0]).toMatchObject({
      rotation: 30,
      scale: 2,
      origin: { x: 750, y: -320 },
    });
    // Radius is local; scale must not be applied to it a second time.
    expect(q.masks[0].primitives[1].native).toMatchObject({ radius: 100 });
    const back = move(q, { x: -250, y: 50 }, refs(q));
    back.masks[0].primitives.forEach((v, i) =>
      v.points.forEach((a, j) => near(a, p.masks[0].primitives[i].points[j])),
    );
  });
  it('máscara inteira: translada somente a origem, uma vez, com rotação e escala; primitivas locais idênticas', () => {
    const p = maskManipFixture();
    Object.assign(p.masks[0], {
      rotation: 30,
      scale: 2,
      origin: { x: 750, y: -320 },
    });
    const q = moveWhole(p);
    expect(q.masks[0].origin).toEqual({ x: 1000, y: -370 });
    expect(q.masks[0].primitives).toBe(p.masks[0].primitives);
    expect(q.masks[0]).toMatchObject({ rotation: 30, scale: 2 });
    p.masks[0].primitives.forEach((_, i) =>
      world(p, i).forEach((v, j) =>
        near(world(q, i)[j], { x: v.x + 250, y: v.y - 50 }),
      ),
    );
    expect(q.masks[1]).toBe(p.masks[1]);
    expect(q.bars).toBe(p.bars);
    expect(q.annotations).toBe(p.annotations);
    expect(toCsv(q)).toBe(toCsv(p));
  });
  it('alcances distintos: entidades não mexem na origem; máscara inteira não reescreve entidades', () => {
    const p = maskManipFixture();
    const entities = move(p, delta, refs(p).slice(0, 1)),
      whole = moveWhole(p);
    expect(entities.masks[0].origin).toEqual(p.masks[0].origin);
    expect(entities.masks[0].primitives[1]).toBe(p.masks[0].primitives[1]);
    expect(whole.masks[0].primitives).toBe(p.masks[0].primitives);
    expect(whole.masks[0].origin).not.toEqual(p.masks[0].origin);
  });
  it('arco, círculo, retângulo, polilinha e texto: forma, ângulos, alinhamento e altura preservados', () => {
    const p = maskManipFixture();
    p.masks[0].primitives = [
      nativePrimitive(
        {
          kind: 'arc',
          center: { x: 100, y: 100 },
          radius: 200,
          startAngle: 30,
          sweepAngle: 80,
        },
        'arc',
      ),
      nativePrimitive(
        {
          kind: 'polyline',
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 50 },
          ],
          closed: true,
        },
        'poly',
      ),
      p.masks[0].primitives[2],
      {
        id: 'text',
        layer: 'DESENHO',
        text: 'Pilar P1',
        textHeight: 25,
        textRotation: 15,
        textAlign: 'center',
        points: [{ x: 10, y: 20 }],
      },
    ];
    // Imported references carry text entities; natives remain analytic.
    p.masks[0].format = 'DXF';
    p.masks[0].rotation = 30;
    expect(refs(p)).toHaveLength(4);
    const q = move(p, delta, refs(p));
    const arc = q.masks[0].primitives[0].native!;
    expect(arc).toMatchObject({
      kind: 'arc',
      radius: 200,
      startAngle: 30,
      sweepAngle: 80,
    });
    expect(q.masks[0].primitives[1].native).toMatchObject({
      kind: 'polyline',
      closed: true,
    });
    expect(q.masks[0].primitives[2].native?.kind).toBe('rectangle');
    expect(q.masks[0].primitives[3]).toMatchObject({
      text: 'Pilar P1',
      textHeight: 25,
      textRotation: 15,
      textAlign: 'center',
    });
    for (const i of [0, 1, 2, 3])
      world(p, i).forEach((v, j) =>
        near(world(q, i)[j], { x: v.x + 250, y: v.y - 50 }),
      );
  });
  it('base = destino é neutro e não gera novo projeto; prévia é pura', () => {
    const p = maskManipFixture(),
      before = JSON.stringify(p);
    const plan = previewMaskManipulation(
      p,
      p.masks[0].id,
      refs(p),
      'move',
      ctx(p),
      { kind: 'translate', delta },
    );
    previewWholeMaskMove(p, p.masks[0].id, ctx(p), delta);
    expect(JSON.stringify(p)).toBe(before);
    expect(plan.result[0].id).toBe('line');
    expect(move(p, { x: 0, y: 0 })).toBe(p);
    expect(moveWhole(p, { x: 0, y: 0 })).toBe(p);
  });
  it('cotas estáticas com referência indicam divergência após mover entidade ou máscara inteira; nenhuma cota é arrastada', () => {
    for (const whole of [false, true]) {
      const p = maskManipFixture();
      const a = dimension(p);
      expect(dimensionReferenceIssue(p, a)).toBeUndefined();
      const q = whole ? moveWhole(p) : move(p, delta, refs(p).slice(0, 1));
      expect(q.annotations).toBe(p.annotations);
      expect(dimensionReferenceIssue(q, q.annotations.at(-1)!)).toMatch(
        /alterada/,
      );
      expect(q.annotations.at(-1)!.points).toEqual(a.points);
    }
  });
  it('recusa seleção vazia/repetida, contexto/projeto alterados, layer protegido, máscara oculta e coordenadas inválidas sem alteração parcial', () => {
    const p = maskManipFixture(),
      snapshot = JSON.stringify(p);
    expect(() => move(p, delta, [])).toThrow();
    expect(() => move(p, delta, [refs(p)[0], refs(p)[0]])).toThrow();
    const external = maskCadEntities(p, {
      key: 'model',
      detailId: p.hierarchy.objectDetails[p.masks[1].id],
    }).find((e) => e.mask.id === p.masks[1].id)!.ref;
    expect(() => move(p, delta, [external])).toThrow();
    for (const d of [
      { x: NaN, y: 0 },
      { x: Infinity, y: 0 },
      { x: 2e9, y: 0 },
    ]) {
      expect(() => move(p, d)).toThrow();
      expect(() => moveWhole(p, d)).toThrow();
    }
    const plan = previewMaskManipulation(
      p,
      p.masks[0].id,
      refs(p),
      'move',
      ctx(p),
      { kind: 'translate', delta },
    );
    expect(() => applyMaskManipulation({ ...p }, plan, ctx(p))).toThrow();
    expect(() =>
      applyMaskManipulation(p, plan, { ...ctx(p), key: 'drawing:other' }),
    ).toThrow();
    const wholePlan = previewWholeMaskMove(p, p.masks[0].id, ctx(p), delta);
    expect(() => applyWholeMaskMove({ ...p }, wholePlan, ctx(p))).toThrow();
    expect(() =>
      applyWholeMaskMove(p, wholePlan, { ...ctx(p), key: 'drawing:other' }),
    ).toThrow();
    expect(() =>
      previewMaskManipulation(p, p.masks[0].id, refs(p), 'move', ctx(p), {
        kind: 'mirror',
        base: { x: 0, y: 0 },
        axisEnd: { x: 0, y: 1 },
      }),
    ).toThrow(/translação/);
    const layer = p.layers.find((l) => l.name === 'DESENHO')!.id;
    for (const field of ['visible', 'capture', 'editable'] as const)
      expect(() =>
        move(setLayerState(p, 'model', layer, { [field]: false })),
      ).toThrow();
    // Whole mask: a locked layer blocks; a hidden layer follows and is reported.
    expect(() =>
      moveWhole(setLayerState(p, 'model', layer, { editable: false })),
    ).toThrow(/bloqueado/);
    const hidden = setLayerState(p, 'model', layer, { visible: false });
    expect(
      previewWholeMaskMove(hidden, p.masks[0].id, ctx(p), delta).hidden,
    ).toBe(3);
    const invisible = {
      ...p,
      masks: p.masks.map((m) => ({ ...m, visible: false })),
    };
    expect(() => move(invisible)).toThrow();
    expect(() => moveWhole(invisible)).toThrow();
    expect(() => moveWhole(p, delta)).not.toThrow();
    expect(() =>
      previewWholeMaskMove(
        p,
        p.masks[0].id,
        { ...ctx(p), key: 'sheet:a' },
        delta,
      ),
    ).toThrow();
    expect(JSON.stringify(p)).toBe(snapshot);
  });
  it('salvar/reabrir, pacote de intercâmbio, DXF e PDF concordam com o resultado', () => {
    for (const whole of [false, true]) {
      const p = maskManipFixture();
      const q = whole ? moveWhole(p) : move(p);
      expect(decodeProject(JSON.stringify(q)).masks).toEqual(q.masks);
      const exchanged = readDetailPackage(
        JSON.stringify(
          createDetailPackage(q, ctx(p).detailId, {
            producer: { app: 'test', version: '1' },
            unit: 'mm',
          }),
        ),
      ).project;
      const m = exchanged.masks.find((m) => m.name === q.masks[0].name)!;
      near(maskPoint(m.primitives[0].points[1], m), world(q, 0)[1]);
      const line = world(q, 0);
      expect(
        parseDxf(toDxf(q), 'move.dxf').primitives.some(
          (v) =>
            !v.text &&
            v.points.length === 2 &&
            v.points.every(
              (a, i) => Math.hypot(a.x - line[i].x, a.y - line[i].y) < 1e-6,
            ),
        ),
      ).toBe(true);
      expect(toPdf(q).length).toBeGreaterThan(100);
      expect(toCsv(q)).toBe(toCsv(p));
    }
  });
});
