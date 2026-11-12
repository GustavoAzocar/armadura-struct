import { expect, it } from 'vitest';
import DxfParser, { type ITextEntity } from 'dxf-parser';
import { setDetailRepetition } from '../src/domain/detailRepetition';
import { drawingPrimitives } from '../src/domain/drawingPrimitives';
import { completeOwnership } from '../src/domain/hierarchy';
import {
  createScheduleLock,
  emptyProject,
  newBar,
  schedule,
  scheduleChanged,
} from '../src/domain/model';
import { alignPlacement, composeSheet } from '../src/domain/paper';
import type { ScopeSelection } from '../src/domain/scheduleScopes';
import { sheetScheduleData } from '../src/domain/sheetSchedule';
import {
  duplicatePlacement,
  placeDrawing,
  updatePlacement,
} from '../src/domain/sheets';
import { defaultStirrupCriteria } from '../src/domain/stirrupSchema';
import { criteriaBar } from '../src/domain/stirrups';
import type { Annotation, Primitive, Project } from '../src/domain/types';
import { toCsv, toDxf, toPdf, toSheetPdf } from '../src/lib/exports';
import { defaultCsvExportOptions, planScopedCsv } from '../src/lib/scopedCsv';

function projectWithViews() {
  const p = completeOwnership({
    ...emptyProject(),
    bars: [
      {
        ...newBar('N1'),
        id: 'bar',
        diameter: 10,
        mandrel: 50,
        quantity: 3,
        multiplier: 2,
        rotation: 20,
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 500 },
        ],
      },
    ],
    details: [
      {
        id: 'representation',
        barId: 'bar',
        origin: { x: 1900, y: 0 },
        rotation: -15,
        scale: 1.2,
        mirrored: true,
      },
    ],
  });
  const repeated = setDetailRepetition(p, p.hierarchy.details[0].id, {
    factor: 4,
    elements: [],
  });
  const a = placeDrawing(repeated, p.sheets[0].id, p.hierarchy.drawings[0].id);
  const first = alignPlacement(
    updatePlacement(a.project, a.id, {
      scale: 25,
      origin: { x: 25, y: 70 },
      frame: { width: 160, height: 100 },
    }),
    a.id,
  );
  const b = duplicatePlacement(first, a.id);
  return alignPlacement(
    updatePlacement(b.project, b.id, {
      scale: 100,
      origin: { x: 220, y: 70 },
      rotation: 8,
    }),
    b.id,
  );
}

const selectConventions = (p: Project): Project => ({
  ...p,
  bars: p.bars.map((b) => ({ ...b, dimensionConvention: 'external' })),
  details: p.details.map((d) => ({ ...d, dimensionConvention: 'axis' })),
});

const captions = (lines: Primitive[]) =>
  lines
    .filter((l) => (l.role ?? l.layer) === 'COTAS' && l.text)
    .map((l) => l.text);

const pdfCaptionCount = (pdf: Uint8Array, label: string) =>
  new TextDecoder('latin1')
    .decode(pdf)
    .split(`(${label.replace(/[()]/g, '\\$&')}) Tj`).length - 1;

it('mantém as cotas do CAD na prancha, no PDF e no DXF em escalas distintas', () => {
  const p = selectConventions(projectWithViews());
  const expected = [
    '100,5 cm (ext.)',
    '50,5 cm (ext.)',
    '100,0 cm (eixo)',
    '50,0 cm (eixo)',
  ];
  const model = drawingPrimitives(p);
  expect(captions(model)).toEqual(expected);

  const page = composeSheet(p, p.sheets[0].id);
  expect(page.issues).toEqual([]);
  expect(page.views.map((v) => v.placement.scale)).toEqual([25, 100]);
  for (const view of page.views) expect(captions(view.lines)).toEqual(expected);

  const modelPdf = toPdf(p);
  const sheetPdf = toSheetPdf(p);
  for (const label of expected) {
    expect(pdfCaptionCount(modelPdf, label)).toBe(1);
    expect(pdfCaptionCount(sheetPdf, label)).toBe(2);
  }
  const dxf = new DxfParser().parseSync(toDxf(p))!;
  const dxfCaptions = dxf.entities
    .filter((entity): entity is ITextEntity => entity.type === 'TEXT')
    .filter((entity) => /\((?:ext\.|eixo)\)$/.test(entity.text));
  expect(dxfCaptions.map((entity) => entity.text)).toEqual(expected);
  const modelCaptions = model.filter((item) => item.role === 'COTAS');
  for (const [i, entity] of dxfCaptions.entries()) {
    const item = modelCaptions[i];
    expect(entity.layer).toBe(item.layer);
    expect(entity.startPoint.x).toBeCloseTo(item.points[0].x, 8);
    expect(entity.startPoint.y).toBeCloseTo(item.points[0].y, 8);
  }
});

it.each([
  { shape: 'circle', expected: ['Ø50 cm (eixo)'] },
  { shape: 'free', expected: ['37 cm reto', '27 cm reto'] },
] as const)(
  'preserva as referências do estribo $shape no CAD e nas exportações',
  ({ shape, expected }) => {
    const criteria = defaultStirrupCriteria();
    criteria.width = 500;
    criteria.diameter = 10;
    criteria.mandrel = 50;
    criteria.profile.shape = shape;
    criteria.profile.closed = shape === 'circle';
    criteria.profile.points = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
    ];
    criteria.profile.start.angle = 0;
    criteria.profile.end.angle = 0;
    const base = projectWithViews();
    const bar = criteriaBar(criteria, base.bars[0].origin, 'N1', 'bar');
    const p: Project = {
      ...base,
      bars: [{ ...bar, dimensionConvention: 'external' }],
      details: base.details.map((d) => ({
        ...d,
        dimensionConvention: 'external',
      })),
    };
    const labels = [...expected, ...expected];
    expect(captions(drawingPrimitives(p))).toEqual(labels);
    for (const view of composeSheet(p, p.sheets[0].id).views)
      expect(captions(view.lines)).toEqual(labels);
    const pdf = toPdf(p);
    const sheetPdf = toSheetPdf(p);
    for (const label of expected) {
      expect(pdfCaptionCount(pdf, label)).toBe(2);
      expect(pdfCaptionCount(sheetPdf, label)).toBe(4);
    }
    const dxf = new DxfParser().parseSync(toDxf(p))!;
    const dxfLabels = dxf.entities
      .filter((entity): entity is ITextEntity => entity.type === 'TEXT')
      .map((entity) => entity.text.replace(/%%c/g, 'Ø'))
      .filter((text) => /(?:\((?:eixo|ext\.)\)| cm reto)$/.test(text));
    expect(dxfLabels).toEqual(labels);
  },
);

it('preserva RA bloqueada e CSV nos escopos de projeto, prancha e detalhamento', () => {
  const project = projectWithViews();
  const p = { ...project, scheduleLock: createScheduleLock(project) };
  const q = selectConventions(p);
  expect(scheduleChanged(q)).toBe(false);
  expect(schedule(q)).toEqual(schedule(p));
  expect(schedule(q)[0]).toMatchObject({
    quantity: 24,
    unitLength: expect.closeTo(1.4871238898, 8),
    totalLength: expect.closeTo(24 * 1.4871238898, 8),
  });
  expect(toCsv(q)).toBe(toCsv(p));
  const sheetId = p.sheets[0].id;
  const sheetRows = (value: Project) =>
    sheetScheduleData(value, sheetId).rows.map(({ bar: _bar, ...row }) => row);
  expect(sheetRows(q)).toEqual(sheetRows(p));
  const scopes: ScopeSelection[] = [
    { kind: 'project' },
    { kind: 'sheets', mode: 'selected', sheetIds: [sheetId] },
    {
      kind: 'details',
      mode: 'selected',
      detailIds: [p.hierarchy.details[0].id],
    },
  ];
  for (const selection of scopes) {
    const options = defaultCsvExportOptions();
    const original = planScopedCsv(p, selection, options);
    expect(original.issues).toEqual([]);
    expect(original.files.length).toBeGreaterThan(0);
    expect(planScopedCsv(q, selection, options)).toEqual(original);
  }
});

it('trata unidade, precisão, arredondamento e texto manual da anotação como apresentação', () => {
  const p = selectConventions(projectWithViews());
  const annotation: Annotation = {
    id: 'manual-dimension',
    barId: p.bars[0].id,
    kind: 'dimension-aligned',
    points: [
      { x: 0, y: 0 },
      { x: 1003, y: 0 },
      { x: 400, y: 650 },
    ],
    label: '',
    color: '#888888',
    textHeight: 40,
  };
  for (const [unit, precision, expected] of [
    ['mm', 0, '~ 1005 mm'],
    ['cm', 1, '~ 100,5 cm'],
    ['m', 3, '~ 1,005 m'],
  ] as const) {
    const q = completeOwnership({
      ...p,
      annotations: [
        {
          ...annotation,
          dimensionPresentation: {
            unit,
            precision,
            rounding: { multipleTicks: 5_000_000, mode: 'nearest' },
          },
        },
      ],
    });
    const manual = {
      ...q,
      annotations: [{ ...q.annotations[0], label: '9999 · texto manual' }],
    };
    expect(captions(drawingPrimitives(q))).toEqual(
      expect.arrayContaining([expected, '100,5 cm (ext.)']),
    );
    expect(captions(drawingPrimitives(manual))).toEqual(
      expect.arrayContaining(['9999 · texto manual', '100,5 cm (ext.)']),
    );
    expect(toDxf(q)).toContain(expected);
    expect(toDxf(manual)).toContain('9999 · texto manual');
    expect(schedule(q)).toEqual(schedule(p));
    expect(schedule(manual)).toEqual(schedule(p));
    expect(toCsv(manual)).toBe(toCsv(p));
  }
});
