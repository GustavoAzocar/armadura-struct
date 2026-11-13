import Ajv2020 from 'ajv/dist/2020';
import packageSchema from '../docs/openstruct-detail-v23.schema.json';
import {
  decodeProject,
  emptyProject,
  scheduleChanged,
} from '../src/domain/model';
import {
  previewDetailTransfer,
  applyDetailTransfer,
} from '../src/domain/detailTransfer';
import { composeSheet, modelToPaper } from '../src/domain/paper';
import { placeDrawing } from '../src/domain/sheets';
import { completeOwnership } from '../src/domain/hierarchy';
import { describe, it, expect } from 'vitest';
import { maskManipFixture } from './fixtures/maskManipulation';
import {
  measuredDistance,
  formatDimension,
  captureMaskReference,
  dimensionReferenceIssue,
  dimensionPresentationSchema,
} from '../src/domain/maskDimensions';
import { annotationPrimitives, dimensionValueMm } from '../src/domain/drafting';
import { nativePrimitive } from '../src/domain/nativeMasks';
import { maskPoint } from '../src/cad/import';
import { toCsv, toDxf, toPdf } from '../src/lib/exports';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import { cloneArmatureGraph } from '../src/domain/editing';
import type { Annotation, Project, Point } from '../src/domain/types';
const ctx = (p: Project) => ({
  key: 'model',
  detailId: p.hierarchy.objectDetails[p.masks[0].id],
});
function dimension(
  p: Project,
  kind: Annotation['kind'] = 'dimension-aligned',
  position: Point = { x: -1000, y: 4000 },
) {
  const m = p.masks[0];
  m.primitives[0] = nativePrimitive(
    {
      kind: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 3000, y: 4000 },
      ],
      closed: false,
    },
    'line',
  );
  const points = [
    maskPoint(m.primitives[0].points[0], m),
    maskPoint(m.primitives[0].points[1], m),
    position,
  ];
  const a: Annotation = {
    id: 'mask-dimension',
    kind,
    points,
    label: '',
    textHeight: 50,
    color: '#123456',
    style: { color: '#123456', lineWidth: 0.5 },
    dimensionPresentation: { unit: 'mm', precision: 0 },
    maskReferences: [
      captureMaskReference(p, ctx(p), m.id, points[0], 0)!,
      captureMaskReference(p, ctx(p), m.id, points[1], 1)!,
    ],
  };
  p.annotations.push(a);
  p.hierarchy.objectDetails[a.id] = ctx(p).detailId;
  return a;
}
const caption = (p: Project, a: Annotation) =>
  annotationPrimitives(a, p).find((v) => v.text)!.text;
describe('Medir e cotar referências de máscaras', () => {
  it('consulta 3-4-5 é pura e unidades/precisão alteram somente apresentação', () => {
    const p = maskManipFixture(),
      before = JSON.stringify(p),
      csv = toCsv(p),
      r = measuredDistance({ x: 0, y: 0 }, { x: 3000, y: 4000 });
    expect(r).toEqual({ distance: 5000, dx: 3000, dy: 4000 });
    expect(formatDimension(r.distance, { unit: 'mm', precision: 0 })).toBe(
      '5000 mm',
    );
    expect(formatDimension(r.distance, { unit: 'm', precision: 3 })).toBe(
      '5,000 m',
    );
    expect(formatDimension(1234.56789, { unit: 'cm', precision: 2 })).toBe(
      '123,46 cm',
    );
    expect(r.distance).toBe(5000);
    expect(JSON.stringify(p)).toBe(before);
    expect(toCsv(p)).toBe(csv);
    for (const x of [NaN, Infinity, 1e10])
      expect(() => measuredDistance({ x, y: 0 }, { x: 0, y: 0 })).toThrow();
    expect(() =>
      dimensionPresentationSchema.parse({ unit: 'px', precision: 9 }),
    ).toThrow();
  });
  it.each([
    ['dimension-aligned', { x: -1000, y: 4000 }, '5000 mm'],
    ['dimension-orthogonal', { x: 1500, y: 6000 }, '3000 mm'],
    ['dimension-orthogonal', { x: 6000, y: 2000 }, '4000 mm'],
  ] as const)(
    'cota %s usa projeção e posição do terceiro ponto',
    (kind, point, text) => {
      const p = maskManipFixture(),
        a = dimension(p, kind, { ...point });
      expect(caption(p, a)).toBe(text);
      expect(dimensionReferenceIssue(p, a)).toBeUndefined();
      expect(a.points[2]).toEqual(point);
      const q = decodeProject(JSON.stringify(p));
      expect(q.annotations.at(-1)).toEqual(a);
      expect(toCsv(q)).toBe(toCsv(p));
      expect(toDxf(q)).toContain(text);
      expect(toPdf(q).length).toBeGreaterThan(100);
    },
  );
  it('persiste e exporta a apresentação arredondada sem mudar geometria ou CSV', () => {
    const p = maskManipFixture();
    const a = dimension(p, 'dimension-orthogonal', { x: 1500, y: 6000 });
    const before = structuredClone(p);
    a.dimensionPresentation = {
      unit: 'mm',
      precision: 0,
      rounding: { multipleTicks: 70_000_000, mode: 'nearest' },
    };
    expect(dimensionValueMm(a)).toBe(3000);
    expect(caption(p, a)).toBe('~ 3010 mm');
    expect(a.points).toEqual(before.annotations.at(-1)?.points);
    expect(p.bars).toEqual(before.bars);
    expect(p.masks).toEqual(before.masks);
    expect(p.scheduleLock).toEqual(before.scheduleLock);
    expect(scheduleChanged(p)).toBe(false);
    expect(toCsv(p)).toBe(toCsv(before));
    expect(toDxf(p)).toContain('~ 3010 mm');
    expect(new TextDecoder().decode(toPdf(p))).toContain('~ 3010 mm');
    expect(decodeProject(JSON.stringify(p)).annotations.at(-1)).toEqual(a);
    for (const unit of ['mm', 'cm', 'm'] as const) {
      const pack = createDetailPackage(p, ctx(p).detailId, {
        producer: { app: 'test', version: '1' },
        unit,
      });
      const restored = readDetailPackage(JSON.stringify(pack)).project;
      const restoredDimension = restored.annotations.find(
        (item) => item.id === a.id,
      )!;
      expect(restoredDimension.dimensionPresentation).toEqual(
        a.dimensionPresentation,
      );
      expect(caption(restored, restoredDimension)).toBe('~ 3010 mm');
    }
    const stale = { ...p, masks: [] };
    expect(caption(stale, a)).toBe('[REFERÊNCIA ALTERADA] ~ 3010 mm');
    expect(caption(stale, { ...a, label: 'Cota 1234' })).toBe(
      '[REFERÊNCIA ALTERADA] Cota 1234',
    );
  });
  it('máscara girada/escalada mede no modelo; mover, escalar, aparar e apagar sinalizam valor estático', () => {
    const p = maskManipFixture();
    Object.assign(p.masks[0], {
      scale: 2,
      rotation: 30,
      origin: { x: 100, y: 200 },
      format: 'DXF',
    });
    const a = dimension(p);
    expect(measuredDistance(a.points[0], a.points[1]).distance).toBeCloseTo(
      10000,
      8,
    );
    expect(caption(p, a)).toBe('10000 mm');
    const before = toCsv(p);
    for (const mask of [
      { ...p.masks[0], origin: { x: 200, y: 200 } },
      { ...p.masks[0], scale: 3 },
      { ...p.masks[0], primitives: [] },
      {
        ...p.masks[0],
        primitives: [
          nativePrimitive(
            {
              kind: 'line',
              points: [
                { x: 1, y: 0 },
                { x: 2000, y: 4000 },
              ],
              closed: false,
            },
            'line',
          ),
        ],
      },
    ]) {
      const q = { ...p, masks: [mask, p.masks[1]] };
      expect(dimensionReferenceIssue(q, a)).toMatch(/Referência/);
      expect(caption(q, a)).toContain('[REFERÊNCIA ALTERADA]');
      expect(toDxf(q)).toContain('[REFERÊNCIA ALTERADA]');
      expect(toCsv(q)).toBe(before);
      expect(q.bars).toBe(p.bars);
      expect(q.scheduleLock).toBe(p.scheduleLock);
    }
    const gone = completeOwnership({ ...p, masks: [p.masks[1]] });
    expect(dimensionReferenceIssue(gone, a)).toMatch(/ausente/);
    expect(
      decodeProject(JSON.stringify(completeOwnership(gone))).annotations.at(-1)
        ?.maskReferences,
    ).toEqual(a.maskReferences);
  });
  it.each(['mm', 'cm', 'm'] as const)(
    'intercâmbio %s preserva dados, estilo, valor e diagnóstico; formato antigo não aceita campos novos',
    (unit) => {
      const p = maskManipFixture(),
        a = dimension(p),
        pack = createDetailPackage(p, ctx(p).detailId, {
          producer: { app: 'test', version: '1' },
          unit,
        }),
        q = readDetailPackage(JSON.stringify(pack)).project;
      expect(pack.schema).toBe('openstruct.detail/23');
      const r = q.annotations.find((v) => v.id === a.id)!;
      expect(dimensionReferenceIssue(q, r)).toBeUndefined();
      expect(r.maskReferences).toEqual(a.maskReferences);
      expect(caption(q, r)).toBe('5000 mm');
      expect(r.style).toEqual(a.style);
      expect(() =>
        decodeProject(JSON.stringify({ ...p, schema: 'armadurastruct/23' })),
      ).toThrow(/formato 24/);
      expect(() =>
        readDetailPackage(
          JSON.stringify({ ...pack, schema: 'openstruct.detail/14' }),
        ),
      ).toThrow(/v15/);
    },
  );
  it('clone de máscara+cota remapeia verificação; cota sozinha informa divergência; mudanças de estilo não invalidam', () => {
    const p = maskManipFixture(),
      a = dimension(p);
    const q = cloneArmatureGraph(p, {
      barIds: [],
      objectIds: [p.masks[0].id, a.id],
      delta: { x: 500, y: 100 },
      shared: 'keep',
    }).project;
    const copy = q.annotations.find(
      (v) => !p.annotations.some((old) => old.id === v.id),
    )!;
    expect(copy.maskReferences![0].maskId).not.toBe(p.masks[0].id);
    expect(dimensionReferenceIssue(q, copy)).toBeUndefined();
    const z = {
      ...p,
      masks: p.masks.map((m) => ({ ...m, style: { color: '#abcdef' } })),
    };
    expect(dimensionReferenceIssue(z, a)).toBeUndefined();
  });
  it.each([false, true])(
    'vistas 1:50 e 1:100 conservam valor da cota (arredondamento %s)',
    (rounded) => {
      let p = maskManipFixture();
      const a = dimension(p);
      if (rounded)
        a.dimensionPresentation!.rounding = {
          multipleTicks: 70_000_000,
          mode: 'nearest',
        };
      expect(caption(p, a)).toBe(rounded ? '~ 4970 mm' : '5000 mm');
      for (const scale of [50, 100]) {
        p = placeDrawing(p, p.sheets[0].id, p.hierarchy.drawings[0].id).project;
        const view = p.hierarchy.placements.at(-1)!;
        view.scale = scale;
        const [x, y] = [
          modelToPaper({ x: 0, y: 0 }, view),
          modelToPaper({ x: 1000, y: 0 }, view),
        ];
        expect(Math.hypot(y.x - x.x, y.y - x.y)).toBeCloseTo(1000 / scale, 8);
      }
      expect(
        composeSheet(p, p.sheets[0].id).views.every((v) =>
          v.content.some((q) => q.text === caption(p, a)),
        ),
      ).toBe(true);
    },
  );
  it('inserção de pacote remapeia referência para a máscara importada no novo projeto', () => {
    const source = maskManipFixture(),
      a = dimension(source),
      target = emptyProject();
    const read = readDetailPackage(
      JSON.stringify(
        createDetailPackage(source, ctx(source).detailId, {
          producer: { app: 'test', version: '1' },
          unit: 'cm',
        }),
      ),
    ).project;
    const plan = previewDetailTransfer(target, read, {
      mode: 'insert',
      sourceDetailId: ctx(source).detailId,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(plan.issues).toEqual([]);
    const q = applyDetailTransfer(target, plan),
      copy = q.annotations.find((v) => v.maskReferences?.length)!;
    expect(copy.id).not.toBe(a.id);
    expect(copy.maskReferences![0].maskId).not.toBe(source.masks[0].id);
    expect(dimensionReferenceIssue(q, copy)).toBeUndefined();
    expect(caption(q, copy)).toBe('5000 mm');
  });
  it('captura respeita visibilidade e contexto; migra projeto antigo sem inventar associação ou mudar cotas existentes', () => {
    const p = maskManipFixture();
    expect(
      captureMaskReference(
        p,
        { ...ctx(p), key: 'sheet:x' },
        p.masks[0].id,
        { x: 0, y: 0 },
        0,
      ),
    ).toBeUndefined();
    expect(
      captureMaskReference(
        p,
        { ...ctx(p), detailId: 'foreign' },
        p.masks[0].id,
        { x: 0, y: 0 },
        0,
      ),
    ).toBeUndefined();
    const old = { ...p, schema: 'armadurastruct/23' },
      q = decodeProject(JSON.stringify(old));
    expect(q.schema).toBe('armadurastruct/35');
    expect(q.annotations[0].maskReferences).toBeUndefined();
    expect(annotationPrimitives(q.annotations[0], q)).toEqual(
      annotationPrimitives(p.annotations[0], p),
    );
  });
});

it('versiona o arredondamento e conserva 31/20 sem o campo novo', () => {
  const p = maskManipFixture();
  const a = dimension(p);
  const legacy = structuredClone(a);
  expect(
    decodeProject(
      JSON.stringify({ ...p, schema: 'armadurastruct/31' }),
    ).annotations.at(-1),
  ).toEqual(legacy);
  const pack = createDetailPackage(p, ctx(p).detailId, {
    producer: { app: 'test', version: '1' },
  });
  expect(
    readDetailPackage({
      ...pack,
      schema: 'openstruct.detail/20',
    }).project.annotations.at(-1),
  ).toEqual(legacy);
  a.dimensionPresentation!.rounding = {
    multipleTicks: 5_000_000,
    mode: 'nearest',
  };
  expect(p.schema).toBe('armadurastruct/35');
  expect(decodeProject(JSON.stringify(p)).annotations.at(-1)).toEqual(a);
  for (const schema of ['armadurastruct/24', 'armadurastruct/31'])
    expect(() => decodeProject(JSON.stringify({ ...p, schema }))).toThrow(
      /formato 32/,
    );
  const rounded = createDetailPackage(p, ctx(p).detailId, {
    producer: { app: 'test', version: '1' },
  });
  expect(rounded.schema).toBe('openstruct.detail/23');
  const validate = new Ajv2020({
    strict: false,
    formats: { 'date-time': true },
  }).compile(packageSchema);
  expect(validate(rounded), JSON.stringify(validate.errors)).toBe(true);
  const invalid = structuredClone(rounded);
  invalid.objects.annotations.at(-1)!.dimensionPresentation = {
    unit: 'm',
    precision: 2,
    rounding: { multipleTicks: 5_000_000, mode: 'nearest' },
  };
  expect(validate(invalid)).toBe(false);

  for (const schema of ['openstruct.detail/15', 'openstruct.detail/20'])
    expect(() => readDetailPackage({ ...rounded, schema })).toThrow(/v21/);
});

it('preserva arredondamento de 32/21 e lê hélice com arredondamento a partir de 33/22', async () => {
  const { helixBar } = await import('../src/domain/helixBars');
  const { defaultHelixCriteria } = await import('../src/domain/helixSchema');
  const p = maskManipFixture();
  const a = dimension(p);
  a.dimensionPresentation!.rounding = {
    multipleTicks: 5_000_000,
    mode: 'nearest',
  };
  // Existing 32/21 files keep the exact presentation, without helix data.
  expect(
    decodeProject(
      JSON.stringify({ ...p, schema: 'armadurastruct/32' }),
    ).annotations.at(-1),
  ).toEqual(a);
  const options = { producer: { app: 'test', version: '1' } };
  const oldPack = createDetailPackage(p, ctx(p).detailId, options);
  expect(
    readDetailPackage({
      ...oldPack,
      schema: 'openstruct.detail/21',
    }).project.annotations.at(-1),
  ).toEqual(a);
  const b = helixBar(
    defaultHelixCriteria(),
    { x: 0, y: 0 },
    0,
    'N99',
    'helix-rounding',
  );
  p.bars.push(b);
  p.hierarchy.objectDetails[b.id] = ctx(p).detailId;
  const reopened = decodeProject(
    JSON.stringify({ ...p, schema: 'armadurastruct/33' }),
  );
  expect(reopened.annotations.at(-1)).toEqual(a);
  expect(reopened.bars.at(-1)?.helix).toEqual(b.helix);
  const pack = createDetailPackage(p, ctx(p).detailId, options);
  const validate = new Ajv2020({
    strict: false,
    formats: { 'date-time': true },
  }).compile(packageSchema);
  expect(validate(pack), JSON.stringify(validate.errors)).toBe(true);
  const roundtrip = readDetailPackage({
    ...pack,
    schema: 'openstruct.detail/22',
  }).project;
  expect(roundtrip.annotations.at(-1)?.dimensionPresentation).toEqual(
    a.dimensionPresentation,
  );
  expect(roundtrip.bars.find((bar) => bar.id === b.id)?.helix).toEqual(b.helix);
  expect(() =>
    decodeProject(JSON.stringify({ ...p, schema: 'armadurastruct/32' })),
  ).toThrow(/formato 33/);
  expect(() =>
    readDetailPackage({ ...pack, schema: 'openstruct.detail/21' }),
  ).toThrow(/detail\/22/);
});
