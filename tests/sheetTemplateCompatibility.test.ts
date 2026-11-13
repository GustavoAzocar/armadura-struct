import { describe, expect, it } from 'vitest';
import { assertDetailEdit } from '../src/domain/detailEditing';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import {
  applyDetailTransfer,
  previewDetailTransfer,
} from '../src/domain/detailTransfer';
import { completeOwnership } from '../src/domain/hierarchy';
import { linkProjectFile } from '../src/domain/linkedProjectFiles';
import {
  createScheduleLock,
  decodeProject,
  emptyProject,
  withDistributionBandVersion,
} from '../src/domain/model';
import { applyRebarBatch, executeRebarBatch } from '../src/domain/rebarApi';
import {
  applySheetTemplate,
  removeSheetTemplate,
  saveSheetTemplate,
  templateFromSheet,
} from '../src/domain/sheetTemplates';
import { defaultStirrupCriteria } from '../src/domain/stirrupSchema';
import { criteriaBar, withStirrupRange } from '../src/domain/stirrups';
import type { Project } from '../src/domain/types';
import { toCsv } from '../src/lib/exports';

function steelProject() {
  const criteria = { ...defaultStirrupCriteria(), spacing: 200 };
  const bar = {
    ...withStirrupRange(
      criteriaBar(criteria, { x: -500, y: -500 }, 'N1', 'stirrup'),
      criteria,
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 200, y: -200 },
    ),
    multiplier: 2,
    dimensionConvention: 'external' as const,
  };
  const p = completeOwnership({ ...emptyProject(), bars: [bar] });
  const repeated = {
    ...p,
    hierarchy: {
      ...p.hierarchy,
      details: p.hierarchy.details.map((d) => ({
        ...d,
        repetition: { factor: 3, elements: [] },
      })),
    },
  };
  return linkProjectFile(
    { ...repeated, scheduleLock: createScheduleLock(repeated) },
    'Referências/Modelo.pdf',
  );
}

function setBand(project: Project) {
  const bar = project.bars[0];
  if (
    bar.quantitySource.kind !== 'distribution' ||
    bar.quantitySource.mode !== 'spacing'
  )
    throw new Error('A referência do teste deve usar espaçamento.');
  return applyRebarBatch(
    project,
    executeRebarBatch(
      project,
      [
        {
          type: 'distribution.set',
          barId: bar.id,
          distribution: { ...bar.distribution!, render: 'band' },
          count: {
            mode: 'spacing',
            spacing: bar.quantitySource.spacing,
            fit: bar.quantitySource.fit,
          },
        },
      ],
      { units: 'mm' },
    ),
  );
}

function withTemplate(project: Project) {
  const sheetId = project.sheets[0].id;
  const template = templateFromSheet(project.sheets[0]);
  return applySheetTemplate(saveSheetTemplate(project, template), template.id, [
    sheetId,
  ]);
}

describe('compatibilidade dos modelos com vínculos, cotagem e faixas', () => {
  it.each(['faixa primeiro', 'modelo primeiro'])(
    'salva e reabre os quatro recursos sem rebaixamento (%s)',
    (order) => {
      const initial = steelProject();
      const csv = toCsv(initial);
      const combined =
        order === 'faixa primeiro'
          ? withTemplate(setBand(initial))
          : setBand(withTemplate(initial));
      expect(combined.schema).toBe('armadurastruct/38');
      expect(withDistributionBandVersion(combined)).toBe(combined);
      expect(toCsv(combined)).toBe(csv);
      expect(combined.scheduleLock).toBe(initial.scheduleLock);
      expect(combined.hierarchy).toEqual(initial.hierarchy);
      const reopened = decodeProject(JSON.stringify(combined));
      expect(reopened.schema).toBe('armadurastruct/38');
      expect(reopened.linkedFiles).toEqual(initial.linkedFiles);
      expect(reopened.bars[0].dimensionConvention).toBe('external');
      expect(reopened.bars[0].distribution?.render).toBe('band');
      expect(reopened.sheets).toEqual(combined.sheets);
      expect(reopened.sheetTemplates).toEqual(combined.sheetTemplates);
      expect(reopened.scheduleLock).toEqual(initial.scheduleLock);
      expect(toCsv(reopened)).toBe(csv);
      const linked = linkProjectFile(reopened, 'Referências/Outra.pdf');
      expect(linked.schema).toBe('armadurastruct/38');
      expect(decodeProject(JSON.stringify(linked))).toEqual(linked);
    },
  );

  it('lê a revisão experimental 36 e preserva os formatos 35 e 37 sem modelos', () => {
    const initial = emptyProject();
    const legacy = {
      ...withTemplate(initial),
      schema: 'armadurastruct/36',
    };
    const reopened = decodeProject(JSON.stringify(legacy));
    expect(reopened.schema).toBe('armadurastruct/38');
    expect(reopened.sheets).toEqual(legacy.sheets);
    expect(reopened.sheetTemplates).toEqual(legacy.sheetTemplates);
    expect(decodeProject(JSON.stringify(initial)).schema).toBe(
      'armadurastruct/35',
    );
    const band = setBand(steelProject());
    expect(band.schema).toBe('armadurastruct/37');
    expect(decodeProject(JSON.stringify(band)).schema).toBe(
      'armadurastruct/37',
    );
  });

  it('recusa recursos sem suporte nos contratos antigos em vez de descartá-los', () => {
    const template = withTemplate(emptyProject());
    for (const schema of ['armadurastruct/35', 'armadurastruct/37'])
      expect(() =>
        decodeProject(JSON.stringify({ ...template, schema })),
      ).toThrow(/Modelos de prancha/);
    const band = setBand(steelProject());
    expect(() =>
      decodeProject(JSON.stringify({ ...band, schema: 'armadurastruct/36' })),
    ).toThrow(/Faixas sem traços/);
    expect(() =>
      decodeProject(
        JSON.stringify({
          ...template,
          schema: 'armadurastruct/36',
          linkedFiles: ['Referências/Antigo.pdf'],
        }),
      ),
    ).toThrow(/Arquivos vinculados/);
  });

  it('importa um pacote 24 sem perder modelos, folhas ou vínculos do destino 38', () => {
    const source = setBand(steelProject());
    const sourceDetailId = source.hierarchy.details[0].id;
    const pack = createDetailPackage(source, sourceDetailId, {
      producer: { app: 'ArmaduraStruct', version: '0.6.1' },
      unit: 'cm',
    });
    expect(pack.schema).toBe('openstruct.detail/24');
    const incoming = readDetailPackage(pack).project;
    const target = withTemplate(
      linkProjectFile(emptyProject(), 'Referências/Destino.pdf'),
    );
    const plan = previewDetailTransfer(target, incoming, {
      mode: 'insert',
      sourceDetailId,
      targetElementId: target.hierarchy.elements[0].id,
    });
    expect(plan.issues).toEqual([]);
    const inserted = applyDetailTransfer(target, plan);
    expect(inserted.schema).toBe('armadurastruct/38');
    expect(inserted.linkedFiles).toEqual(target.linkedFiles);
    expect(inserted.sheets).toEqual(target.sheets);
    expect(inserted.sheetTemplates).toEqual(target.sheetTemplates);
    expect(inserted.bars[0].distribution).toEqual(source.bars[0].distribution);
    expect(inserted.bars[0].dimensionConvention).toBe('external');
    expect(decodeProject(JSON.stringify(inserted))).toEqual(inserted);
  });

  it('protege o catálogo global durante a edição isolada, inclusive sem aplicações', () => {
    const initial = emptyProject();
    const template = templateFromSheet(initial.sheets[0]);
    const saved = saveSheetTemplate(initial, template);
    const scope = initial.hierarchy.details[0].id;
    expect(() => assertDetailEdit(initial, saved, scope)).toThrow(/isolada/);
    expect(() => assertDetailEdit(saved, saved, scope)).not.toThrow();
    const edited = saveSheetTemplate(saved, { ...template, name: 'Revisão B' });
    expect(() => assertDetailEdit(saved, edited, scope)).toThrow(/isolada/);
    expect(() =>
      assertDetailEdit(saved, removeSheetTemplate(saved, template.id), scope),
    ).toThrow(/isolada/);
  });
});
