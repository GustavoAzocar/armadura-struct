import { describe, it, expect } from 'vitest';
import { maskManipFixture } from './fixtures/maskManipulation';
import { maskCadEntities } from '../src/domain/maskCadEditing';
import {
  previewMaskManipulation,
  applyMaskManipulation,
} from '../src/domain/maskManipulation';
import { nativePrimitive, validateNativeMask } from '../src/domain/nativeMasks';
import { maskPoint, parseDxf } from '../src/cad/import';
import {
  angleByPoints,
  transformPoint,
  type SelectionTransform,
} from '../src/domain/transforms';
import { decodeProject, schedule } from '../src/domain/model';
import { setLayerState } from '../src/domain/layerProfiles';
import { toCsv, toDxf, toPdf } from '../src/lib/exports';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import type { Project, Point } from '../src/domain/types';
type Rotate = Extract<SelectionTransform, { kind: 'rotate' }>;
const ctx = (p: Project) => ({
  key: 'model',
  detailId: p.hierarchy.objectDetails[p.masks[0].id],
});
const refs = (p: Project) =>
  maskCadEntities(p, ctx(p))
    .filter((e) => e.mask.id === p.masks[0].id)
    .map((e) => e.ref);
const turn = (angle: number, base: Point = { x: 10, y: 10 }): Rotate => ({
  kind: 'rotate',
  base,
  angle,
});
const rotate = (p: Project, t: Rotate, selected = refs(p)) =>
  applyMaskManipulation(
    p,
    previewMaskManipulation(p, p.masks[0].id, selected, 'rotate', ctx(p), t),
    ctx(p),
  );
const near = (a: Point, b: Point, digits = 7) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const len = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
/** Fixture with the issue's reference line as the first entity. */
const issueLine = () => {
  const p = maskManipFixture();
  p.masks[0].primitives[0] = nativePrimitive(
    {
      kind: 'line',
      points: [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
      ],
      closed: false,
    },
    'line',
  );
  p.masks[0].primitives[0].style = { color: '#123456', lineWidth: 0.5 };
  return p;
};
describe('Rotacionar entidades de máscara', () => {
  it('critério da issue: (10,10)–(110,10), base (10,10), +90° → (10,10)–(10,110); preserva ID, estilo, aço, RA, CSV e o restante', () => {
    const p = issueLine();
    const q = rotate(p, turn(90), refs(p).slice(0, 1));
    const line = q.masks[0].primitives[0];
    near(line.points[0], { x: 10, y: 10 });
    near(line.points[1], { x: 10, y: 110 });
    expect(len(line.points[0], line.points[1])).toBeCloseTo(100, 9);
    expect(line.native).toMatchObject({ kind: 'line', closed: false });
    expect(line.id).toBe('line');
    expect(line.style).toEqual(p.masks[0].primitives[0].style);
    expect(q.masks[0].primitives).toHaveLength(3);
    expect(q.masks[0].primitives[1]).toBe(p.masks[0].primitives[1]);
    expect(q.masks[0].primitives[2]).toBe(p.masks[0].primitives[2]);
    expect(q.masks[0].id).toBe(p.masks[0].id);
    expect(q.masks[0].rotation).toBe(p.masks[0].rotation);
    expect(q.masks[1]).toBe(p.masks[1]);
    expect(q.bars).toBe(p.bars);
    expect(q.annotations).toBe(p.annotations);
    expect(q.hierarchy).toBe(p.hierarchy);
    expect(q.scheduleLock).toBe(p.scheduleLock);
    expect(schedule(q)).toEqual(schedule(p));
    expect(toCsv(q)).toBe(toCsv(p));
  });
  it('−90° reverte +90°; ângulo decimal/negativo ida e volta reproduz a geometria', () => {
    const p = issueLine();
    const down = rotate(p, turn(-90), refs(p).slice(0, 1));
    near(down.masks[0].primitives[0].points[1], { x: 10, y: -90 });
    for (const angle of [90, -12.75, 37.5, 179.999]) {
      const there = rotate(p, turn(angle, { x: -250, y: 400 }));
      const back = rotate(there, turn(-angle, { x: -250, y: 400 }));
      back.masks[0].primitives.forEach((v, i) => {
        v.points.forEach((a, j) => near(a, p.masks[0].primitives[i].points[j]));
        expect(v.id).toBe(p.masks[0].primitives[i].id);
      });
    }
  });
  it.each([0, 360, -360, 720, 1e-12])(
    '%s° é operação neutra: devolve o mesmo projeto, sem alteração inútil',
    (angle) => {
      const p = issueLine();
      expect(rotate(p, turn(angle))).toBe(p);
    },
  );
  it('máscara girada/escalada/transladada: gira em mm do modelo pela base escolhida, sem tocar origin/rotation/scale', () => {
    const p = maskManipFixture();
    Object.assign(p.masks[0], {
      rotation: 30,
      scale: 2,
      origin: { x: 750, y: -320 },
      format: 'DXF',
      sourceUnit: 'cm',
    });
    const t = turn(37.5, { x: -250, y: 400 });
    const q = rotate(p, t);
    p.masks[0].primitives.forEach((v, i) => {
      const result = q.masks[0].primitives[i];
      if (v.native?.kind === 'circle') {
        const c = result.native!;
        if (c.kind !== 'circle') throw Error();
        near(
          maskPoint(c.center, q.masks[0]),
          transformPoint(maskPoint(v.native.center, p.masks[0]), t),
        );
        expect(c.radius).toBe(v.native.radius);
      } else
        // Only polyline vertices are compared; rectangle corners stay exact too.
        v.points.forEach((a, j) =>
          near(
            maskPoint(result.points[j], q.masks[0]),
            transformPoint(maskPoint(a, p.masks[0]), t),
            6,
          ),
        );
    });
    validateNativeMask(q.masks[0]);
    expect(q.masks[0].origin).toEqual(p.masks[0].origin);
    expect(q.masks[0].rotation).toBe(30);
    expect(q.masks[0].scale).toBe(2);
    expect(q.masks[1]).toBe(p.masks[1]);
  });
  it('arco gira centro e início sem inverter a abertura; círculo conserva raio; conjunto gira pela mesma base', () => {
    const p = maskManipFixture();
    p.masks[0].primitives[0] = nativePrimitive(
      {
        kind: 'arc',
        center: { x: 100, y: 100 },
        radius: 200,
        startAngle: 30,
        sweepAngle: 80,
      },
      'arc',
    );
    const t = turn(50, { x: 1000, y: 300 }),
      q = rotate(p, t);
    const a = q.masks[0].primitives[0].native!;
    if (a.kind !== 'arc') throw Error('arco deveria continuar arco');
    expect(a.radius).toBe(200);
    expect(a.sweepAngle).toBe(80);
    expect(a.startAngle).toBeCloseTo(80, 9);
    near(a.center, transformPoint({ x: 100, y: 100 }, t));
    near(
      q.masks[0].primitives[0].points[0],
      transformPoint(p.masks[0].primitives[0].points[0], t),
    );
    const circle = q.masks[0].primitives[1].native!;
    expect(circle).toMatchObject({ kind: 'circle', radius: 100 });
    if (circle.kind !== 'circle') throw Error();
    near(circle.center, transformPoint({ x: 0, y: 500 }, t));
  });
  it.each([
    [30, 'polyline'],
    [90, 'polyline'],
    [180, 'rectangle'],
  ])(
    'retângulo a %s°: lados 1000 × 200, fechado, vértices exatos (%s)',
    (angle, kind) => {
      const p = maskManipFixture();
      const t = turn(angle, { x: 0, y: 0 });
      const q = rotate(p, t, refs(p).slice(2, 3));
      const r = q.masks[0].primitives[2];
      expect(r.native?.kind).toBe(kind);
      expect(r.closed).toBe(true);
      expect(r.points).toHaveLength(4);
      expect(r.id).toBe(p.masks[0].primitives[2].id);
      const before = p.masks[0].primitives[2].points;
      r.points.forEach((v, i) => near(v, transformPoint(before[i], t)));
      expect(len(r.points[0], r.points[1])).toBeCloseTo(1000, 8);
      expect(len(r.points[1], r.points[2])).toBeCloseTo(200, 8);
      expect(len(r.points[2], r.points[3])).toBeCloseTo(1000, 8);
      expect(len(r.points[3], r.points[0])).toBeCloseTo(200, 8);
    },
  );
  it('Referência: orienta um segmento inclinado para a direção capturada sem mudar o tamanho', () => {
    const p = maskManipFixture();
    p.masks[0].primitives[0] = nativePrimitive(
      {
        kind: 'line',
        points: [
          { x: 0, y: 0 },
          { x: 300, y: 400 },
        ],
        closed: false,
      },
      'line',
    );
    const base = { x: 0, y: 0 };
    // Direção existente = o próprio segmento; nova direção = eixo X.
    const angle = angleByPoints(base, { x: 300, y: 400 }, { x: 1000, y: 0 });
    const q = rotate(p, turn(angle, base), refs(p).slice(0, 1));
    const [a, b] = q.masks[0].primitives[0].points;
    near(a, { x: 0, y: 0 });
    near(b, { x: 500, y: 0 });
  });
  it('texto: âncora gira, direção soma o ângulo, conteúdo/altura/alinhamento ficam; ida e volta restaura', () => {
    const p = maskManipFixture();
    p.masks[0].format = 'DXF';
    p.masks[0].primitives = [
      {
        id: 'text',
        layer: 'CAD',
        text: 'Cota 100',
        textHeight: 25,
        textRotation: 0,
        textAlign: 'left',
        points: [{ x: 100, y: 200 }],
      },
    ];
    const q = rotate(p, turn(90, { x: 0, y: 0 }));
    near(q.masks[0].primitives[0].points[0], { x: -200, y: 100 });
    expect(q.masks[0].primitives[0]).toMatchObject({
      text: 'Cota 100',
      textHeight: 25,
      textAlign: 'left',
      textRotation: 90,
    });
    const z = rotate(q, turn(-90, { x: 0, y: 0 }));
    near(z.masks[0].primitives[0].points[0], { x: 100, y: 200 });
    expect(z.masks[0].primitives[0].textRotation).toBeCloseTo(0, 9);
    const w = rotate(p, turn(270, { x: 0, y: 0 }));
    expect(w.masks[0].primitives[0].textRotation).toBeCloseTo(-90, 9);
    expect(
      parseDxf(toDxf(q), 'rotate.dxf').primitives.some(
        (v) => v.text === 'Cota 100',
      ),
    ).toBe(true);
  });
  it('prévia não muda o projeto; gira no lugar preservando IDs/linhagem; salvar, intercâmbio, PDF e DXF concordam', () => {
    const p = maskManipFixture();
    p.masks[0].primitives[1].sourceEntityId = 'line';
    p.masks[0].primitives[2].sourceEntityId = 'DXF/42';
    const before = JSON.stringify(p);
    const plan = previewMaskManipulation(
      p,
      p.masks[0].id,
      refs(p),
      'rotate',
      ctx(p),
      turn(45),
    );
    expect(JSON.stringify(p)).toBe(before);
    const q = applyMaskManipulation(p, plan, ctx(p));
    expect(q.masks[0].primitives.map((v) => v.id)).toEqual(
      p.masks[0].primitives.map((v) => v.id),
    );
    expect(q.masks[0].primitives[1].sourceEntityId).toBe('line');
    expect(q.masks[0].primitives[2].sourceEntityId).toBe('DXF/42');
    expect(decodeProject(JSON.stringify(q)).masks).toEqual(q.masks);
    const pkg = readDetailPackage(
      JSON.stringify(
        createDetailPackage(q, ctx(p).detailId, {
          producer: { app: 'test', version: '1' },
          unit: 'mm',
        }),
      ),
    ).project;
    expect(pkg.masks[0].primitives.map((v) => v.native)).toEqual(
      q.masks[0].primitives.map((v) => v.native),
    );
    const line = q.masks[0].primitives[0];
    expect(
      parseDxf(toDxf(q), 'rotate.dxf').primitives.some(
        (v) =>
          !v.text &&
          v.points.length === line.points.length &&
          v.points.every((a, i) => len(a, line.points[i]) < 1e-7),
      ),
    ).toBe(true);
    expect(toPdf(q).length).toBeGreaterThan(100);
  });
  it('recusa ângulo/base inválidos, transformação de outro tipo, seleção, contexto, máscara e layer protegidos sem alteração parcial', () => {
    const p = maskManipFixture(),
      snapshot = JSON.stringify(p);
    for (const angle of [NaN, Infinity, -Infinity, 1e7])
      expect(() => rotate(p, turn(angle))).toThrow();
    for (const base of [
      { x: NaN, y: 0 },
      { x: 0, y: Infinity },
      { x: 1e10, y: 0 },
    ])
      expect(() => rotate(p, turn(30, base))).toThrow();
    expect(() =>
      previewMaskManipulation(p, p.masks[0].id, refs(p), 'rotate', ctx(p), {
        kind: 'translate',
        delta: { x: 10, y: 0 },
      }),
    ).toThrow();
    expect(() =>
      previewMaskManipulation(p, p.masks[0].id, refs(p), 'rotate', ctx(p)),
    ).toThrow();
    expect(() =>
      previewMaskManipulation(
        p,
        p.masks[0].id,
        refs(p),
        'mirror',
        ctx(p),
        turn(30),
      ),
    ).toThrow();
    expect(() => rotate(p, turn(30), [])).toThrow();
    expect(() => rotate(p, turn(30), [refs(p)[0], refs(p)[0]])).toThrow();
    const plan = previewMaskManipulation(
      p,
      p.masks[0].id,
      refs(p),
      'rotate',
      ctx(p),
      turn(30),
    );
    expect(() => applyMaskManipulation({ ...p }, plan, ctx(p))).toThrow();
    expect(() =>
      applyMaskManipulation(p, plan, { ...ctx(p), key: 'drawing:other' }),
    ).toThrow();
    for (const field of ['visible', 'capture', 'editable'] as const) {
      const q = setLayerState(
        p,
        'model',
        p.layers.find((l) => l.name === 'DESENHO')!.id,
        { [field]: false },
      );
      expect(() => rotate(q, turn(30))).toThrow();
    }
    expect(() =>
      rotate(
        { ...p, masks: p.masks.map((m) => ({ ...m, visible: false })) },
        turn(30),
      ),
    ).toThrow();
    // Um ângulo neutro ainda valida a seleção antes de devolver o projeto.
    expect(() => rotate(p, turn(360), [])).toThrow();
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});
