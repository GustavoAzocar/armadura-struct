import { describe, expect, it } from 'vitest';
import {
  createBarSeries,
  deleteBarSeries,
  seriesTableData,
  setSeriesTable,
} from '../src/domain/barSeries';
import { defaultSeriesTable } from '../src/domain/barSeriesSchema';
import { completeOwnership } from '../src/domain/hierarchy';
import { createDrawingMask } from '../src/domain/maskDrawing';
import {
  setMaskReference,
  withMaskReferenceVersion,
} from '../src/domain/maskReferences';
import {
  decodeProject,
  emptyProject,
  newBar,
  schedule,
  withDistributionBandVersion,
} from '../src/domain/model';
import { SERIES_MASK_PROJECT_SCHEMA } from '../src/domain/projectSchema';
import { withSealDataVersion } from '../src/domain/sealFieldSchema';
import {
  applySheetTemplate,
  saveSheetTemplate,
  templateFromSheet,
} from '../src/domain/sheetTemplates';
import { linkProjectFile } from '../src/domain/linkedProjectFiles';
import { defaultCsvExportOptions, planScopedCsv } from '../src/lib/scopedCsv';
import { assertExportable } from '../src/lib/exports';

function base() {
  return completeOwnership({
    ...emptyProject(),
    bars: [1000, 1250, 1500].map((length, i) => ({
      ...newBar(`N${i + 1}`),
      id: `b${i}`,
      diameter: 10,
      quantity: i + 1,
      multiplier: 2,
      points: [
        { x: 0, y: 0 },
        { x: length, y: 0 },
      ],
    })),
  });
}
function mask(p: ReturnType<typeof base>) {
  const detailId = p.hierarchy.details[0].id;
  const made = createDrawingMask(p, 'Fôrma', '', { key: 'model', detailId });
  return setMaskReference(made.project, detailId, made.mask.id, 'replace');
}
const series = (p: ReturnType<typeof base>) =>
  createBarSeries(p, { barIds: p.bars.map((b) => b.id), id: 's1', name: 'N5' })
    .project;

describe('compatibilidade de séries /40 e máscaras /41, composição /43', () => {
  it.each(['armadurastruct/41', 'armadurastruct/43'] as const)(
    'recusa explicitamente os dados da outra variante de %s, sem descarte silencioso',
    (schema) => {
      for (const extra of [
        { sealPropertyDefinitions: [] },
        { sealPropertyValues: { identificador: 'Preservar' } },
        {
          sheets: base().sheets.map((s) => ({
            ...s,
            sealPropertyValues: { identificador: 'Preservar' },
          })),
        },
      ])
        expect(() =>
          decodeProject(JSON.stringify({ ...base(), ...extra, schema })),
        ).toThrow(/Propriedades personalizadas.*#217/);
    },
  );
  it.each(['série primeiro', 'máscara primeiro'] as const)(
    '%s: compõe e reabre sem perder vínculos nem alterar aço',
    (order) => {
      const p = base();
      let q = order === 'série primeiro' ? mask(series(p)) : series(mask(p));
      q = setSeriesTable(
        q,
        q.sheets[0].id,
        't1',
        defaultSeriesTable('t1', 's1'),
      );
      expect(q.schema).toBe(SERIES_MASK_PROJECT_SCHEMA);
      const reopened = decodeProject(JSON.stringify(q));
      expect(reopened).toEqual(q);
      expect(schedule(reopened)).toEqual(schedule(p));
      expect(seriesTableData(reopened, 's1').totals.pieces).toBe(12);
      // (1000×1 + 1250×2 + 1500×3) × 2 = 16000 mm.
      expect(seriesTableData(reopened, 's1').totals.length).toBe(16);
      expect(reopened.maskReferences).toEqual(q.maskReferences);
      const csv = planScopedCsv(
        reopened,
        { kind: 'project' },
        { ...defaultCsvExportOptions(), variants: true },
      );
      expect(csv.issues).toEqual([]);
      expect(csv.scopes[0].pieces).toBe(12);
      expect(csv.files[0].content).toContain('N5.3');
    },
  );
  it.each([
    'armadurastruct/40',
    'armadurastruct/41',
    'armadurastruct/42',
    'armadurastruct/39',
  ] as const)('recusa composição adulterada sob cabeçalho %s', (schema) => {
    const q = mask(series(base()));
    expect(() => decodeProject(JSON.stringify({ ...q, schema }))).toThrow(
      /exigem formato/,
    );
  });
  it('conserva os leitores individuais /40 e /41 e recusa a reserva /42', () => {
    for (const p of [series(base()), mask(base())])
      expect(decodeProject(JSON.stringify(p))).toEqual(p);
    expect(() =>
      decodeProject(JSON.stringify({ ...base(), schema: 'armadurastruct/42' })),
    ).toThrow();
  });
  it('selos, modelos, faixas, vínculos e exclusão não rebaixam a composição', () => {
    let p = mask(series(base()));
    const template = templateFromSheet(p.sheets[0]);
    p = saveSheetTemplate(p, template);
    p = applySheetTemplate(p, template.id, [p.sheets[0].id]);
    p = withSealDataVersion({
      ...p,
      sealProperties: { work: 'Prancha de séries' },
    });
    p = withDistributionBandVersion(
      linkProjectFile(p, 'Referências/Base.armstruct.json'),
    );
    expect(p.schema).toBe(SERIES_MASK_PROJECT_SCHEMA);
    expect(decodeProject(JSON.stringify(p))).toEqual(p);
    p = deleteBarSeries(p, 's1');
    p = withMaskReferenceVersion(p);
    expect(p.schema).toBe(SERIES_MASK_PROJECT_SCHEMA);
    expect(decodeProject(JSON.stringify(p)).schema).toBe(
      SERIES_MASK_PROJECT_SCHEMA,
    );
  });
  it('revalida vínculos antes da consulta e das exportações, sem arquivos parciais', () => {
    const p = series(base());
    const broken = { ...p, bars: p.bars.slice(1) };
    expect(() => seriesTableData(broken, 's1')).toThrow(/não existe/);
    expect(() => assertExportable(broken)).toThrow(/não existe/);
    const plan = planScopedCsv(
      broken,
      { kind: 'project' },
      { ...defaultCsvExportOptions(), variants: true },
    );
    expect(plan.files).toEqual([]);
    expect(plan.issues.join(' ')).toMatch(/não existe/);
  });
});
