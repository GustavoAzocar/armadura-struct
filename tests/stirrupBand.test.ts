import DxfParser, {
  type ILwpolylineEntity,
  type ITextEntity,
} from 'dxf-parser';
import { describe, expect, it } from 'vitest';
import {
  distributionOrigins,
  distributionPrimitives,
  distributionStep,
} from '../src/domain/drafting';
import { drawingPrimitives } from '../src/domain/drawingPrimitives';
import { add, distance, geometry } from '../src/domain/geometry';
import { completeOwnership } from '../src/domain/hierarchy';
import {
  createScheduleLock,
  decodeProject,
  emptyProject,
  newBar,
  schedule,
} from '../src/domain/model';
import { alignPlacement, composeSheet } from '../src/domain/paper';
import { applyRebarBatch, executeRebarBatch } from '../src/domain/rebarApi';
import { placeDrawing, updatePlacement } from '../src/domain/sheets';
import { defaultStirrupCriteria } from '../src/domain/stirrupSchema';
import { criteriaBar, withStirrupRange } from '../src/domain/stirrups';
import type { Bar, Point, Project } from '../src/domain/types';
import { toCsv, toDxf, toSheetPdf } from '../src/lib/exports';

function fixture(end: Point) {
  const criteria = {
    ...defaultStirrupCriteria(),
    spacing: 200,
    startInset: 50,
    endInset: 75,
    fit: 'fixed' as const,
  };
  const section = criteriaBar(criteria, { x: -500, y: -500 }, 'N1', 'stirrup');
  return withStirrupRange(section, criteria, { x: 0, y: 0 }, end, {
    x: 300,
    y: -350,
  });
}

function display(
  project: Project,
  bar: Bar,
  render: NonNullable<Bar['distribution']>['render'],
) {
  const count =
    bar.quantitySource.kind === 'distribution' &&
    bar.quantitySource.mode === 'spacing'
      ? {
          mode: 'spacing' as const,
          spacing: bar.quantitySource.spacing,
          fit: bar.quantitySource.fit,
        }
      : {
          mode:
            bar.quantitySource.kind === 'distribution'
              ? ('quantity' as const)
              : ('manual' as const),
          quantity: bar.quantity,
        };
  return executeRebarBatch(
    project,
    [
      {
        type: 'distribution.set',
        barId: bar.id,
        distribution: { ...bar.distribution!, render },
        count,
      },
    ],
    { units: 'mm' },
  );
}

describe('Faixa de estribos sem traços individuais', () => {
  it.each([2, 1000])(
    'preserva a distribuição por quantidade de %i peças',
    (quantity) => {
      const bar = {
        ...fixture({ x: 880, y: 660 }),
        quantity,
        quantitySource: {
          kind: 'distribution' as const,
          mode: 'quantity' as const,
        },
      };
      const p = completeOwnership({ ...emptyProject(), bars: [bar] });
      expect(decodeProject(JSON.stringify(p)).bars).toEqual(p.bars);
      const changed = applyRebarBatch(p, display(p, bar, 'band'));
      const band = changed.bars[0];
      expect(band).toEqual({
        ...bar,
        distribution: { ...bar.distribution, render: 'band' },
      });
      expect(band.quantitySource).toEqual(bar.quantitySource);
      expect(distributionOrigins(band, 1000)).toEqual(
        distributionOrigins(bar, 1000),
      );
      expect(distributionStep(band)).toBe(distributionStep(bar));
      const totals = (p: Project) =>
        schedule(p).map(({ bar: _representative, ...row }) => row);
      expect(totals(changed)).toEqual(totals(p));
      expect(toCsv(changed)).toBe(toCsv(p));
      const before = distributionPrimitives(bar),
        after = distributionPrimitives(band);
      expect(after.slice(0, -1)).toEqual(before.slice(0, 3));
      expect(after.at(-1)?.text).toBe(
        before.at(-1)?.text?.replace(' (vista abreviada)', ''),
      );
      expect(
        after.every((item) =>
          item.points.every(
            (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
          ),
        ),
      ).toBe(true);
      const reverted = applyRebarBatch(
        changed,
        display(changed, band, 'ticks'),
      );
      expect(reverted.bars).toEqual(p.bars);
    },
  );

  it('recusa faixas unitárias na API e no arquivo, preservando o contrato atual', () => {
    const bar = fixture({ x: 1100, y: 0 });
    const p = completeOwnership({ ...emptyProject(), bars: [bar] });
    for (const render of ['ticks', 'band'] as const) {
      const result = executeRebarBatch(
        p,
        [
          {
            type: 'distribution.set',
            barId: bar.id,
            distribution: { ...bar.distribution!, render },
            count: { mode: 'manual', quantity: 1 },
          },
        ],
        { units: 'mm' },
      );
      expect(result).toMatchObject({
        ok: false,
        project: p,
        issues: [{ code: 'INVALID_FIELD', field: 'count.quantity' }],
      });
    }
    const noRange = completeOwnership({
      ...p,
      bars: [
        { ...bar, distribution: undefined, quantitySource: { kind: 'manual' } },
      ],
    });
    const create = executeRebarBatch(
      noRange,
      [
        {
          type: 'distribution.set',
          barId: bar.id,
          distribution: { ...bar.distribution!, render: 'band' },
          count: { mode: 'manual', quantity: 1 },
        },
      ],
      { units: 'mm' },
    );
    expect(create.ok).toBe(false);
    expect(create.project).toBe(noRange);
    for (const render of ['ticks', 'band'] as const) {
      const file = {
        ...p,
        schema: render === 'band' ? 'armadurastruct/37' : p.schema,
        bars: [
          {
            ...bar,
            quantity: 1,
            quantitySource: { kind: 'manual' },
            distribution: { ...bar.distribution!, render },
          },
        ],
      };
      expect(() => decodeProject(JSON.stringify(file))).toThrow(
        /pelo menos duas peças/,
      );
    }
  });

  it('altera só a faixa do detalhamento isolado e preserva repetição e fotografia da RA', () => {
    const bar = { ...fixture({ x: 1100, y: 0 }), multiplier: 3 };
    let p = completeOwnership({ ...emptyProject(), bars: [bar] });
    p = {
      ...p,
      hierarchy: {
        ...p.hierarchy,
        details: p.hierarchy.details.map((d) => ({
          ...d,
          repetition: { factor: 4, elements: [] },
        })),
      },
    };
    p = { ...p, scheduleLock: createScheduleLock(p) };
    const result = executeRebarBatch(
      p,
      [
        {
          type: 'distribution.set',
          barId: bar.id,
          distribution: { ...bar.distribution!, render: 'band' },
          count: { mode: 'spacing', spacing: 200, fit: 'fixed' },
        },
      ],
      { units: 'mm', scopeDetailId: p.hierarchy.details[0].id },
    );
    expect(result.ok).toBe(true);
    const changed = applyRebarBatch(p, result);
    expect(changed.scheduleLock).toBe(p.scheduleLock);
    expect(changed.hierarchy).toEqual(p.hierarchy);
    expect(schedule(changed)).toEqual(schedule(p));
    expect(toCsv(changed)).toBe(toCsv(p));
  });
  it.each([
    { x: 1100, y: 0 },
    { x: 880, y: 660 },
  ])(
    'preserva conectores, linha, legenda, geometria e aço com fim em %j',
    (end) => {
      const bar = { ...fixture(end), multiplier: 3 };
      let project = completeOwnership({ ...emptyProject(), bars: [bar] });
      project = { ...project, scheduleLock: createScheduleLock(project) };
      const result = display(project, bar, 'band');
      expect(result.ok).toBe(true);
      const changed = applyRebarBatch(project, result);
      const band = changed.bars[0];
      expect(band).toEqual({
        ...bar,
        distribution: { ...bar.distribution, render: 'band' },
      });
      if (result.ok) {
        expect(result.receipt.steelChanged).toBe(false);
        expect(result.receipt.scheduleDirty).toBe(false);
      }
      expect(changed.scheduleLock).toBe(project.scheduleLock);
      expect(distributionStep(band)).toBe(distributionStep(bar));
      expect(distributionOrigins(band)).toEqual(distributionOrigins(bar));
      expect(geometry(band)).toEqual(geometry(bar));
      expect(schedule(changed)).toEqual(schedule(project));
      expect(toCsv(changed)).toBe(toCsv(project));
      const withTicks = distributionPrimitives(bar);
      const withoutTicks = distributionPrimitives(band);
      expect(withTicks).toHaveLength(4 + bar.quantity);
      expect(withoutTicks).toEqual([
        ...withTicks.slice(0, 3),
        withTicks.at(-1),
      ]);
      const reverted = applyRebarBatch(
        changed,
        display(changed, band, 'ticks'),
      );
      expect(reverted.bars).toEqual(project.bars);
      expect(drawingPrimitives(reverted)).toEqual(drawingPrimitives(project));
      const repeated = applyRebarBatch(changed, display(changed, band, 'bars'));
      expect(drawingPrimitives(repeated).length).toBeGreaterThan(
        drawingPrimitives(reverted).length,
      );
    },
  );

  it('mantém quantidade manual, preserva a seção unitária e recusa o modo para barras livres', () => {
    const bar = {
      ...fixture({ x: 1100, y: 0 }),
      quantitySource: { kind: 'manual' as const },
    };
    const free = {
      ...newBar('N2'),
      quantity: bar.quantity,
      distribution: bar.distribution,
    };
    const unit = criteriaBar(
      defaultStirrupCriteria(),
      { x: 0, y: 0 },
      'N3',
      'unit',
    );
    const project = completeOwnership({
      ...emptyProject(),
      bars: [bar, free, unit],
    });
    const changed = applyRebarBatch(project, display(project, bar, 'band'));
    expect(changed.bars[0].quantitySource).toEqual({ kind: 'manual' });
    expect(changed.bars[1]).toBe(free);
    expect(changed.bars[2]).toBe(unit);
    expect(decodeProject(JSON.stringify(changed)).bars[2]).toEqual(unit);
    expect(distributionPrimitives(unit)).toEqual([]);
    expect(display(changed, free, 'band')).toMatchObject({
      ok: false,
      project: changed,
      issues: [{ field: 'distribution.render' }],
    });
  });

  it('grava no DXF e no PDF vetorial apenas a faixa e a legenda, sem os traços ocultos', () => {
    const bar = fixture({ x: 1100, y: 0 });
    let project = completeOwnership({ ...emptyProject(), bars: [bar] });
    const sheetId = project.sheets[0].id;
    const view = placeDrawing(
      project,
      sheetId,
      project.hierarchy.drawings[0].id,
    );
    project = updatePlacement(view.project, view.id, {
      scale: 10,
      origin: { x: 35, y: 120 },
      frame: { width: 240, height: 140 },
    });
    project = alignPlacement(project, view.id);
    const changed = applyRebarBatch(project, display(project, bar, 'band'));
    const paths = (p: Project) =>
      new DxfParser()
        .parseSync(toDxf(p))!
        .entities.filter(
          (e): e is ILwpolylineEntity => e.type === 'LWPOLYLINE',
        );
    const ticks = paths(project);
    const band = paths(changed);
    expect(ticks.length - band.length).toBe(bar.quantity);
    expect(
      band.some(
        (e) =>
          e.vertices.length === 2 &&
          distance(e.vertices[0], e.vertices[1]) === 800,
      ),
    ).toBe(true);
    const labels = new DxfParser()
      .parseSync(toDxf(changed))!
      .entities.filter((e): e is ITextEntity => e.type === 'TEXT');
    expect(labels.some((e) => e.text.includes('5 N1 %%c6,3 c/20,0 cm'))).toBe(
      true,
    );
    const composed = composeSheet(changed, sheetId);
    expect(composed.issues).toEqual([]);
    expect(
      composed.views[0].lines.filter((l) => l.role === 'DISTRIBUICAO'),
    ).toHaveLength(4);
    const pdf = (p: Project) => new TextDecoder('latin1').decode(toSheetPdf(p));
    const strokes = (raw: string) =>
      [...raw.matchAll(/[-\d.]+ [-\d.]+ m\s+[-\d.]+ [-\d.]+ l\s+S/g)].length;
    expect(strokes(pdf(project)) - strokes(pdf(changed))).toBe(bar.quantity);
    expect(pdf(changed)).toContain('5 N1 Ø6,3 c/20,0 cm');
  });

  it('move e copia a faixa mantendo a apresentação e o passo', () => {
    const bar = fixture({ x: 880, y: 660 });
    const project = completeOwnership({ ...emptyProject(), bars: [bar] });
    const changed = applyRebarBatch(project, display(project, bar, 'band'));
    const move = { x: 120, y: 80 };
    const copy = { x: 1400, y: -350 };
    const result = applyRebarBatch(
      changed,
      executeRebarBatch(
        changed,
        [
          { type: 'bar.move', id: bar.id, delta: move },
          { type: 'bar.copy', id: bar.id, newId: 'copia-faixa', delta: copy },
        ],
        { units: 'mm' },
      ),
    );
    expect(result.bars.map((b) => b.distribution?.render)).toEqual([
      'band',
      'band',
    ]);
    const origins = distributionOrigins(bar);
    expect(distributionOrigins(result.bars[0])).toEqual(
      origins.map((p) => add(p, move)),
    );
    expect(distributionOrigins(result.bars[1])).toEqual(
      origins.map((p) => add(add(p, move), copy)),
    );
    expect(result.bars.map((b) => distributionPrimitives(b).length)).toEqual([
      4, 4,
    ]);
  });
});
