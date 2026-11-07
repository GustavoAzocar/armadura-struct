import { it, expect } from 'vitest';
import { initialExampleProject } from '../src/examples/initial';
import {
  initialReference,
  reviewInitialExample,
  initialExampleCsv,
} from '../src/examples/review';
import { decodeProject, schedule } from '../src/domain/model';
import { executeRebarBatch, applyRebarBatch } from '../src/domain/rebarApi';
import { geometry } from '../src/domain/geometry';
import { representationPrimitives } from '../src/domain/representations';
import { duplicateSheet, deleteSheet } from '../src/domain/sheets';
import { assertPaperExportable } from '../src/domain/paper';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import { toDxf, toSheetPdf } from '../src/lib/exports';

it('reconstructs both supplied drawings with stable provenance, all 64 schedules and 1181 pieces', async () => {
  const p = await initialExampleProject(),
    q = await initialExampleProject();
  expect(p).toEqual(q);
  expect(p.name).toBe('Exemplo ArmaduraStruct');
  expect(p.bars).toHaveLength(108);
  expect(p.details).toHaveLength(108);
  expect(p.sheets.map((s) => s.name)).toEqual(['01 · Vigas', '02 · Pilares']);
  expect(p.fabricationPositions).toHaveLength(64);
  expect(
    p.hierarchy.elements.filter((e) => /^V\d+$/.test(e.name)),
  ).toHaveLength(15);
  expect(
    p.hierarchy.elements.filter((e) => /^P\d+$/.test(e.name)),
  ).toHaveLength(14);
  const review = reviewInitialExample(p);
  expect(review.rows.every((r) => r.quantityMatches)).toBe(true);
  expect(review.rows.reduce((s, r) => s + r.quantity, 0)).toBe(1181);
  expect(review.errors).toEqual([]);
  expect(review.untracked).toEqual([]);
  for (const source of initialReference.sources) {
    expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const row of initialReference.positions.filter(
      (r) => r.sheetKey === source.key,
    ))
      for (const occurrence of row.occurrences) {
        expect(occurrence.traceHandles.length).toBeGreaterThan(0);
        expect(p.hierarchy.objectOrigins[occurrence.barId]).toEqual({
          projectId: `dwg:${source.sha256}`,
          objectId: occurrence.captionHandle,
        });
      }
  }
  expect(decodeProject(JSON.stringify(p))).toEqual(p);
  p.bars[0].quantity = 999;
  expect((await initialExampleProject()).bars[0].quantity).not.toBe(999);
});

it('keeps genuine developed geometry and exposes cut differences instead of forcing the original RA', async () => {
  const p = await initialExampleProject(),
    review = reviewInitialExample(p);
  expect(review.rows.filter((r) => r.lengthMatches)).toHaveLength(30);
  const straight = review.rows.find((r) => r.source.key === 'vigas:N24')!;
  expect(straight.quantity).toBe(4);
  expect(straight.totalLengthM).toBeCloseTo(28.72, 10);
  expect(straight.cutLengthRangeMm[0]).toBeCloseTo(7180, 8);
  const stirrup = review.rows.find((r) => r.source.key === 'vigas:N1')!;
  expect(stirrup.source.cutLengthMm).toBe(970);
  expect(stirrup.cutLengthRangeMm[0]).toBeCloseTo(1012.467, 3);
  expect(stirrup.lengthMatches).toBe(false);
  const bent = p.bars.find((b) => b.mark === 'V-N39')!;
  expect(geometry(bent).segments.some((s) => s.type === 'arc')).toBe(true);
  expect(geometry(bent).length).toBeCloseTo(3044.59, 2);
  expect(
    review.summaries[0].rows.reduce((s, r) => s + r.weightKg, 0),
  ).toBeCloseTo(673.189158, 5);
  expect(
    review.summaries[1].rows.reduce((s, r) => s + r.weightKg, 0),
  ).toBeCloseTo(394.190378, 5);
  expect(
    review.summaries[0].rows.reduce((s, r) => s + r.original.grossWeightKg, 0),
  ).toBeCloseTo(733.8, 8);
  expect(schedule(p).reduce((s, r) => s + r.weight, 0)).toBeCloseTo(
    1067.379537,
    5,
  );
  expect(p.bars.find((b) => b.mark === 'V-N9')!.multiplier).toBe(2);
  expect(initialExampleCsv(p)).toContain('C atual mínimo (mm)'); // headers contain lengths, not fabricated agreement
});

it('duplicate/delete sheets never add/remove steel, and paper/PDF/DXF preserve the native geometry', async () => {
  const p = await initialExampleProject(),
    before = schedule(p);
  const copied = duplicateSheet(p, p.sheets[0].id).project;
  expect(schedule(copied)).toEqual(before);
  expect(schedule(deleteSheet(p, p.sheets[1].id))).toEqual(before);
  const pages = assertPaperExportable(
    p,
    p.sheets.map((s) => s.id),
  );
  expect(pages).toHaveLength(2);
  expect(
    pages.every((p) => p.size.width === 1189 && p.size.height === 841),
  ).toBe(true);
  expect(pages[1].views[0].lines.some((l) => l.textRotation === 90)).toBe(true);
  expect(
    Buffer.from(toSheetPdf(p))
      .toString('latin1')
      .match(/\/Type \/Page\b/g),
  ).toHaveLength(2);
  const dxf = toDxf(p);
  expect(dxf).toContain('TEXT');
  expect(dxf).toContain('101'); // developed stirrup caption; original reference still says 97
});

it('editing an occurrence updates its linked drawing and comparison; units preserve placed labels in packages', async () => {
  const p = await initialExampleProject(),
    bar = p.bars.find((b) => b.mark === 'V-N24')!,
    rep = p.details.find((d) => d.barId === bar.id)!;
  const result = executeRebarBatch(
    p,
    [
      {
        type: 'bar.update',
        id: bar.id,
        patch: {
          kind: 'free',
          quantity: 5,
          points: [
            { x: 0, y: 0 },
            { x: 8000, y: 0 },
          ],
        },
      },
    ],
    { units: 'mm' },
  );
  const q = applyRebarBatch(p, result);
  const row = reviewInitialExample(q).rows.find(
    (r) => r.source.key === 'vigas:N24',
  )!;
  expect(row.quantity).toBe(7);
  expect(row.quantityMatches).toBe(false);
  expect(row.lengthMatches).toBe(false);
  expect(
    representationPrimitives(q.bars.find((b) => b.id === bar.id)!, rep, q).find(
      (l) => l.layer === 'IDENTIFICACAO',
    )!.text,
  ).toContain('C=800');
  expect(reviewInitialExample(p).rows.every((r) => r.quantityMatches)).toBe(
    true,
  );
  expect(decodeProject(JSON.stringify(q))).toEqual(q);
  const detail = p.hierarchy.objectDetails[rep.id];
  for (const unit of ['mm', 'cm', 'm'] as const) {
    const pack = createDetailPackage(p, detail, {
      unit,
      producer: { app: 'test', version: '1' },
    });
    const reopened = readDetailPackage(pack).project;
    expect(reopened.details[0].label!.origin.x).toBeCloseTo(
      p.details[0].label!.origin.x,
      8,
    );
    expect(reopened.details[0].label!.height).toBeCloseTo(
      p.details[0].label!.height,
      8,
    );
    expect(reopened.details[0].showDimensions).toBe(false);
  }
  expect(() =>
    decodeProject(JSON.stringify({ ...p, schema: 'armadurastruct/11' })),
  ).toThrow(/formato 12/);
});

it('changed steel/diameter moves actual weight to its current specification, including sizes absent from the source', async () => {
  const p = await initialExampleProject(),
    bar = p.bars.find((b) => b.mark === 'V-N24')!;
  const q = applyRebarBatch(
    p,
    executeRebarBatch(
      p,
      [
        {
          type: 'bar.update',
          id: bar.id,
          patch: { kind: 'free', diameter: 32, steel: 'CA-60' },
        },
      ],
      { units: 'mm' },
    ),
  );
  const review = reviewInitialExample(q),
    source = review.rows.find((r) => r.source.key === 'vigas:N24')!;
  expect(source.specMatches).toBe(false);
  expect(source.specifications).toContain('CA-60 Ø32');
  const extra = review.summaries[0].rows.find(
    (r) => r.original.steel === 'CA-60' && r.original.diameter === 32,
  )!;
  expect(extra.newSpecification).toBe(true);
  const contribution = schedule(q)
    .flatMap((r) => r.contributions)
    .find((c) => c.barId === bar.id)!;
  expect(extra.weightKg).toBeCloseTo(contribution.weight, 10);
  expect(
    review.summaries.flatMap((s) => s.rows).reduce((s, r) => s + r.weightKg, 0),
  ).toBeCloseTo(
    schedule(q).reduce((s, r) => s + r.weight, 0),
    10,
  );
});
