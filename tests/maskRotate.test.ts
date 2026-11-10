import { expect, it } from 'vitest';
import { maskManipFixture } from './fixtures/maskManipulation';
import { maskCadEntities } from '../src/domain/maskCadEditing';
import {
  applyMaskManipulation,
  previewMaskManipulation,
} from '../src/domain/maskManipulation';
import { nativePrimitive } from '../src/domain/nativeMasks';
import { maskPoint, parseDxf } from '../src/cad/import';
import {
  directionAngle,
  signedAngleDifference,
} from '../src/domain/transforms';
import { distance } from '../src/domain/geometry';
import { decodeProject, schedule } from '../src/domain/model';
import { setLayerState } from '../src/domain/layerProfiles';
import { hideObjects } from '../src/domain/visibility';
import { toCsv, toDxf, toPdf } from '../src/lib/exports';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import type { Point, Project } from '../src/domain/types';

const context = (p: Project) => ({
  key: 'model',
  detailId: p.hierarchy.objectDetails[p.masks[0].id],
});
const refs = (p: Project) =>
  maskCadEntities(p, context(p))
    .filter((e) => e.mask === p.masks[0])
    .map((e) => e.ref);
const preview = (
  p: Project,
  angle: number,
  base = { x: 10, y: 10 },
  selected = refs(p),
  wholeMask = false,
) =>
  previewMaskManipulation(
    p,
    p.masks[0].id,
    selected,
    'rotate',
    context(p),
    { kind: 'rotate', base, angle },
    false,
    wholeMask,
  );
const apply = (p: Project, plan: ReturnType<typeof preview>) =>
  applyMaskManipulation(p, plan, context(p));
function near(actual: Point, expected: Point) {
  expect(actual.x).toBeCloseTo(expected.x, 7);
  expect(actual.y).toBeCloseTo(expected.y, 7);
}

it('gira +90° anti-horário em torno da base, desfaz geometricamente com −90° e ignora voltas completas', () => {
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
  const plan = preview(p, 90, undefined, refs(p).slice(0, 1));
  near(p.masks[0].primitives[0].points[1], { x: 110, y: 10 });
  const q = apply(p, plan);
  const line = q.masks[0].primitives[0];
  near(line.points[0], { x: 10, y: 10 });
  near(line.points[1], { x: 10, y: 110 });
  expect(distance(...(line.points as [Point, Point]))).toBeCloseTo(100, 8);
  expect(line.id).toBe('line');
  expect(q.masks[0].primitives[1]).toBe(p.masks[0].primitives[1]);
  expect(q.masks[1]).toBe(p.masks[1]);
  const back = apply(q, preview(q, -90, undefined, refs(q).slice(0, 1)));
  near(back.masks[0].primitives[0].points[1], { x: 110, y: 10 });
  for (const angle of [0, 360, -720]) {
    expect(apply(p, preview(p, angle))).toBe(p);
    expect(apply(p, preview(p, angle, undefined, [], true))).toBe(p);
  }
});

it('alinha um segmento por Referência de dois pontos independentes da base', () => {
  const p = maskManipFixture();
  const a = { x: 20, y: 50 },
    b = { x: 120, y: 100 };
  p.masks[0].primitives[0] = nativePrimitive(
    { kind: 'line', points: [a, b], closed: false },
    'line',
  );
  const angle = signedAngleDifference(directionAngle(a, b), -90);
  const q = apply(p, preview(p, angle, a, refs(p).slice(0, 1)));
  near(q.masks[0].primitives[0].points[1], { x: a.x, y: a.y - distance(a, b) });
  expect(() => directionAngle(a, { ...a, y: a.y + 0.001 })).toThrow(
    'distintos',
  );
  expect(signedAngleDifference(179, -179)).toBe(2);
});

it('compõe pose e coordenadas locais equivalentes em referência escalada, com arcos, texto, retângulo e vínculos', () => {
  const p = maskManipFixture();
  const m = p.masks[0];
  Object.assign(m, {
    format: 'DXF',
    scale: 2.54,
    rotation: 26,
    origin: { x: -124, y: 58 },
  });
  m.primitives.push(
    nativePrimitive(
      {
        kind: 'arc',
        center: { x: 40, y: 38 },
        radius: 12,
        startAngle: 38,
        sweepAngle: -60,
      },
      'arc',
    ),
    {
      id: 'text',
      layer: 'DESENHO',
      points: [{ x: 50, y: 230 }],
      text: 'Referência',
      textRotation: 48,
      textHeight: 13,
      textAlign: 'center',
    },
  );
  m.primitives[2].sourceEntityId = 'externo-01';
  m.primitives[2].style = { color: '#99aabb', lineWidth: 0.25 };
  const base = { x: 1500, y: 1000 },
    angle = -24.75;
  const local = apply(p, preview(p, angle, base));
  const whole = apply(p, preview(p, angle, base, [], true));
  expect(whole.masks[0].primitives).toBe(m.primitives);
  expect(whole.masks[0].scale).toBe(m.scale);
  expect(whole.masks[0].rotation).toBeCloseTo(1.25);
  expect(local.masks[0].origin).toBe(m.origin);
  expect(local.masks[0].rotation).toBe(m.rotation);
  const [line, circle, rectangle, arc, text] = local.masks[0].primitives;
  expect(circle.native).toMatchObject({ kind: 'circle', radius: 100 });
  expect(arc.native).toMatchObject({
    kind: 'arc',
    startAngle: 13.25,
    sweepAngle: -60,
    radius: 12,
  });
  expect(rectangle).toMatchObject({
    id: 'rectangle',
    closed: true,
    sourceEntityId: 'externo-01',
    style: m.primitives[2].style,
  });
  expect(rectangle.points).toHaveLength(4);
  expect(distance(rectangle.points[0], rectangle.points[1])).toBeCloseTo(
    1000,
    8,
  );
  expect(distance(rectangle.points[1], rectangle.points[2])).toBeCloseTo(
    200,
    8,
  );
  expect(text).toMatchObject({
    textRotation: 23.25,
    textHeight: 13,
    textAlign: 'center',
  });
  for (const entity of [line, rectangle, arc, text]) {
    const equivalent = whole.masks[0].primitives.find(
      (q) => q.id === entity.id,
    )!;
    entity.points.forEach((v, i) =>
      near(
        maskPoint(v, local.masks[0]),
        maskPoint(equivalent.points[i], whole.masks[0]),
      ),
    );
  }
  const originalCircle = whole.masks[0].primitives[1].native!;
  if (circle.native?.kind !== 'circle' || originalCircle.kind !== 'circle')
    throw new Error('Círculo esperado');
  near(
    maskPoint(circle.native.center, local.masks[0]),
    maskPoint(originalCircle.center, whole.masks[0]),
  );
  const orthogonal = apply(p, preview(p, 90, base)).masks[0].primitives[2];
  expect(orthogonal.native?.kind).toBe('rectangle');
  expect(distance(orthogonal.points[0], orthogonal.points[1])).toBeCloseTo(
    200,
    8,
  );
});

it('salva, reabre, intercambia e exporta a rotação com RA, posições, aço e tabelas preservados', () => {
  const p = maskManipFixture(),
    before = JSON.stringify(p);
  const plan = preview(p, 90, { x: 0, y: 0 });
  expect(JSON.stringify(p)).toBe(before);
  const q = apply(p, plan);
  expect(decodeProject(JSON.stringify(q)).masks).toEqual(q.masks);
  const exchanged = readDetailPackage(
    JSON.stringify(
      createDetailPackage(q, context(q).detailId, {
        producer: { app: 'test', version: '1' },
        unit: 'mm',
      }),
    ),
  ).project;
  expect(exchanged.masks[0].primitives.map((e) => e.native)).toEqual(
    q.masks[0].primitives.map((e) => e.native),
  );
  expect(q.bars).toBe(p.bars);
  expect(q.fabricationPositions).toBe(p.fabricationPositions);
  expect(q.scheduleLock).toBe(p.scheduleLock);
  expect(q.annotations).toBe(p.annotations);
  expect(schedule(q)).toEqual(schedule(p));
  expect(toCsv(q)).toBe(toCsv(p));
  const read = (project: Project) =>
    parseDxf(toDxf(project), 'resultado.dxf').primitives;
  const beforeDxf = read(p),
    afterDxf = read(q);
  const dxfTable = (items: typeof beforeDxf) =>
    items.filter((e) => e.layer === 'QUADRO_ACO').map((e) => e.text);
  expect(dxfTable(beforeDxf).length).toBeGreaterThan(2);
  expect(dxfTable(afterDxf)).toEqual(dxfTable(beforeDxf));
  const line = afterDxf.find(
    (e) =>
      e.layer === 'DESENHO' &&
      e.points.length === 2 &&
      Math.abs(e.points[0].x) < 1e-7 &&
      Math.abs(e.points[1].x) < 1e-7,
  );
  expect(line).toBeDefined();
  near(line!.points[0], { x: 0, y: 0 });
  near(line!.points[1], { x: 0, y: 1000 });
  const beforePdf = Buffer.from(toPdf(p)).toString('latin1');
  const afterPdf = Buffer.from(toPdf(q)).toString('latin1');
  const pdfRow = /\(N1\)/g;
  expect(beforePdf.match(pdfRow)?.length).toBeGreaterThan(0);
  expect(afterPdf.match(pdfRow)).toEqual(beforePdf.match(pdfRow));
});

it('recusa alvos ambíguos, bloqueados, ocultos, concorrência e valores inválidos', () => {
  const p = maskManipFixture();
  const selected = refs(p);
  expect(() => preview(p, 90, undefined, [])).toThrow('Selecione');
  expect(() => preview(p, 90, undefined, selected, true)).toThrow(
    'apenas um alvo',
  );
  for (const angle of [NaN, Infinity, 360001])
    expect(() => preview(p, angle)).toThrow();
  expect(() => preview(p, 90, { x: 1e9, y: 1e9 }, [], true)).toThrow('limites');
  const plan = preview(p, 20);
  expect(() => apply({ ...p }, plan)).toThrow('projeto mudou');
  expect(() =>
    applyMaskManipulation(p, plan, { ...context(p), key: 'sheet:abc' }),
  ).toThrow('projeto mudou');
  expect(() =>
    applyMaskManipulation(p, plan, { ...context(p), scopeDetailId: 'outro' }),
  ).toThrow('projeto mudou');
  for (const flag of ['visible', 'capture', 'editable'] as const) {
    const layer = p.layers.find((l) => l.name === 'DESENHO')!;
    const locked = setLayerState(p, 'model', layer.id, { [flag]: false });
    expect(() => preview(locked, 90, undefined, selected)).toThrow();
    expect(() => preview(locked, 90, undefined, [], true)).toThrow(
      'bloqueadas',
    );
  }
  const hidden = hideObjects(p, 'model', [p.masks[0].id]);
  expect(() => preview(hidden, 90, undefined, [], true)).toThrow('oculta');
  p.masks[0].primitives.push({ layer: 'DESENHO', points: [] });
  expect(() => preview(p, 90, undefined, [], true)).toThrow(
    'geometria de rotação',
  );
});
