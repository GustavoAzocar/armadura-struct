import { describe, expect, it } from 'vitest';
import { applySealBatch } from '../src/domain/sealProject';
import { SEAL_PROJECT_SCHEMA } from '../src/domain/sealFieldSchema';
import { assertDetailEdit } from '../src/domain/detailEditing';
import { duplicateDrawing } from '../src/domain/drawingMetadata';
import { composeSheet } from '../src/domain/paper';
import { decodeProject, emptyProject, schedule } from '../src/domain/model';
import { duplicateSheet, createSheet } from '../src/domain/sheets';
import {
  applySheetTemplate,
  saveSheetTemplate,
  templateFromSheet,
  encodeSheetTemplate,
  decodeSheetTemplate,
  fieldFromImportedText,
} from '../src/domain/sheetTemplates';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import {
  applyDetailTransfer,
  previewDetailTransfer,
} from '../src/domain/detailTransfer';
import { createRecoverySession } from '../src/lib/recoverySession';
import { toCsv, toSheetPdf, toSheetDxf } from '../src/lib/exports';

function fixture() {
  const base = emptyProject();
  const second = createSheet(base, 'Segunda');
  const template = {
    ...templateFromSheet(base.sheets[0]),
    fields: [
      {
        id: 'autor',
        label: 'Autor',
        box: { x: 20, y: 20, width: 150, height: 60 },
        origin: { x: 25, y: 60 },
        text: '@AUTOR',
        font: 'courier' as const,
        height: 3,
        align: 'left' as const,
        rotation: 0,
      },
    ],
  };
  return applySheetTemplate(
    saveSheetTemplate(second.project, template),
    template.id,
    second.project.sheets.map((s) => s.id),
  );
}
function bound() {
  const p = fixture();
  return applySealBatch(p, {
    sheetIds: p.sheets.map((s) => s.id),
    author: 'Autora global',
    projectProperties: { address: 'Rua São José', date: '2024-02-29' },
    template: p.sheets[0].paperTemplate,
    fields: [{ fieldId: 'autor', definition: { field: '@AUTOR' } }],
  });
}

describe('Selos persistidos no formato 39', () => {
  it('salva e reabre os vínculos usados automaticamente pela tela, PDF e DXF, preservando o legado', () => {
    const p = bound();
    expect(p.schema).toBe(SEAL_PROJECT_SCHEMA);
    const restored = decodeProject(JSON.stringify(p));
    expect(restored).toEqual(p);
    for (const sheet of restored.sheets) {
      const page = composeSheet(restored, sheet.id);
      expect(page.sealFields?.[0].text).toBe('Autora global');
      expect(toSheetDxf(restored, [sheet.id])).toContain('Autora global');
      expect(
        Buffer.from(toSheetPdf(restored, [sheet.id])).toString('latin1'),
      ).toContain('(Autora global)');
    }
    const legacy = fixture();
    expect(legacy.schema).toBe('armadurastruct/38');
    expect(decodeProject(JSON.stringify(legacy))).toEqual(legacy);
    expect(
      composeSheet(legacy, legacy.sheets[0].id).decorations.some(
        (line) => line.text === '@AUTOR',
      ),
    ).toBe(true);
    expect(schedule(p)).toEqual(schedule(legacy));
    expect(toCsv(p)).toEqual(toCsv(legacy));
  });

  it('recusa cada dado novo em um formato antigo, antes de descartar silenciosamente o conteúdo', () => {
    const p = fixture();
    const variants = [
      { ...p, sealProperties: { client: 'Cliente' } },
      {
        ...p,
        sheets: p.sheets.map((s) => ({
          ...s,
          sealProperties: { author: { mode: 'inherit' } },
        })),
      },
      { ...p, sheets: p.sheets.map((s) => ({ ...s, sealBindings: [] })) },
      {
        ...p,
        sheetTemplates: p.sheetTemplates?.map((t) => ({
          ...t,
          fields: t.fields.map((f) => ({
            ...f,
            sealBinding: { field: '@AUTOR' },
          })),
        })),
      },
      {
        ...p,
        sheets: p.sheets.map((s) => ({
          ...s,
          paperTemplate: {
            ...s.paperTemplate!,
            fields: s.paperTemplate!.fields.map((f) => ({
              ...f,
              sealBinding: { field: '@AUTOR' },
            })),
          },
        })),
      },
    ];
    for (const value of variants)
      for (const schema of [
        'armadurastruct/35',
        'armadurastruct/37',
        'armadurastruct/38',
      ])
        expect(() =>
          decodeProject(JSON.stringify({ ...value, schema })),
        ).toThrow(/formato 39/);
  });

  it('edita apenas os campos escolhidos e conserva vazios, valores locais, origem direta e overrides ao reaplicar', () => {
    let p = bound();
    const first = p.sheets[0].id,
      second = p.sheets[1].id;
    p = applySealBatch(p, {
      sheetIds: [second],
      sheetProperties: { author: { mode: 'local', value: 'Autora local' } },
      template: p.sheets[1].paperTemplate,
      fields: [{ fieldId: 'autor', manualText: 'Texto manual' }],
    });
    const before = structuredClone(p);
    const update = applySealBatch(p, {
      sheetIds: [first, second],
      author: 'Autora atual',
      sheetProperties: { address: { mode: 'local', value: '' } },
    });
    expect(composeSheet(update, first).sealFields?.[0].text).toBe(
      'Autora atual',
    );
    expect(composeSheet(update, second).sealFields?.[0].text).toBe(
      'Texto manual',
    );
    const restore = applySealBatch(update, {
      sheetIds: [second],
      template: update.sheets[1].paperTemplate,
      fields: [{ fieldId: 'autor', manualText: null }],
    });
    expect(composeSheet(restore, second).sealFields?.[0].text).toBe(
      'Autora local',
    );
    const inherited = applySealBatch(restore, {
      sheetIds: [second],
      sheetProperties: { author: { mode: 'inherit' } },
    });
    expect(composeSheet(inherited, second).sealFields?.[0]).toMatchObject({
      text: 'Autora atual',
      inherited: true,
    });
    const revision = saveSheetTemplate(p, {
      ...p.sheetTemplates![0],
      name: 'Modelo revisado',
    });
    const reapplied = applySheetTemplate(
      revision,
      revision.sheetTemplates![0].id,
      [second],
    );
    expect(composeSheet(reapplied, second).sealFields?.[0].text).toBe(
      'Texto manual',
    );
    expect(p).toEqual(before);
    expect(() =>
      applySealBatch(p, {
        sheetIds: [first, 'removida'],
        author: 'Não gravar',
      }),
    ).toThrow();
    expect(() =>
      applySealBatch(p, {
        sheetIds: [first],
        projectProperties: { date: '1900-02-29' },
      }),
    ).toThrow();
    expect(p).toEqual(before);
  });

  it('duplica sem compartilhar configurações e não redireciona vínculos ao duplicar um desenho', () => {
    let p = bound();
    const drawing = p.hierarchy.drawings[0];
    p = {
      ...p,
      hierarchy: {
        ...p.hierarchy,
        drawings: p.hierarchy.drawings.map((d) => ({
          ...d,
          author: 'Autora do desenho',
        })),
      },
    };
    p = applySealBatch(p, {
      sheetIds: [p.sheets[0].id],
      template: p.sheets[0].paperTemplate,
      sheetProperties: { author: { mode: 'local', value: 'Local' } },
      fields: [
        {
          fieldId: 'autor',
          source: { kind: 'drawing', drawingId: drawing.id },
        },
      ],
    });
    const copy = duplicateSheet(p, p.sheets[0].id);
    const a = copy.project.sheets.find((s) => s.id === copy.id)!;
    expect(a.sealBindings).toEqual(p.sheets[0].sealBindings);
    expect(a.sealBindings).not.toBe(p.sheets[0].sealBindings);
    expect(a.sealProperties?.author).not.toBe(
      p.sheets[0].sealProperties?.author,
    );
    const withDrawingCopy = duplicateDrawing(copy.project, drawing.id);
    expect(
      composeSheet(withDrawingCopy.project, copy.id).sealFields?.[0].text,
    ).toBe('Autora do desenho');
    expect(a.sealBindings?.[0].source).toEqual({
      kind: 'drawing',
      drawingId: drawing.id,
    });
    expect(decodeProject(JSON.stringify(copy.project))).toEqual(copy.project);
  });

  it('preserva o cadastro e os vínculos locais na transferência e não os coloca no pacote de detalhamento', () => {
    const p = bound(),
      source = emptyProject();
    const pack = createDetailPackage(p, p.hierarchy.details[0].id, {
      producer: { app: 'ArmaduraStruct', version: '0.6.1' },
    });
    const exchanged = readDetailPackage(JSON.stringify(pack)).project;
    expect(exchanged.sealProperties).toBeUndefined();
    expect(
      exchanged.sheets.every(
        (s) => !s.sealProperties && !s.sealBindings && !s.paperTemplate,
      ),
    ).toBe(true);
    const plan = previewDetailTransfer(p, source, {
      mode: 'insert',
      sourceDetailId: source.hierarchy.details[0].id,
      targetElementId: p.hierarchy.elements[0].id,
    });
    expect(plan.issues).toEqual([]);
    const inserted = applyDetailTransfer(p, plan);
    expect(inserted.sealProperties).toEqual(p.sealProperties);
    expect(inserted.sheets).toEqual(p.sheets);
    const replacement = previewDetailTransfer(inserted, source, {
      mode: 'replace',
      sourceDetailId: source.hierarchy.details[0].id,
      targetDetailId: plan.targetDetailId,
    });
    expect(replacement.issues).toEqual([]);
    expect(applyDetailTransfer(inserted, replacement).sheets).toEqual(p.sheets);
  });

  it('recupera os dados pela mesma sessão de autosave e bloqueia edição global durante isolamento', async () => {
    const p = bound();
    const values: Record<string, string | undefined> = {};
    const recovery = createRecoverySession({
      read: async () => ({ ...values }),
      write: async ({ put, remove }) => {
        Object.assign(values, put);
        for (const key of remove ?? []) delete values[key];
      },
    });
    await recovery.save(JSON.stringify(p));
    const restored = await recovery.start();
    expect(restored.closed).toBe(false);
    if (restored.closed) throw Error('Recuperação inesperadamente fechada.');
    expect(decodeProject(restored.raw!)).toEqual(p);
    const next = {
      ...p,
      sealProperties: { ...p.sealProperties, address: 'Alterado' },
    };
    expect(() => assertDetailEdit(p, next, p.hierarchy.details[0].id)).toThrow(
      /edição isolada/,
    );
  });

  it('exporta definições portáteis em modelo 2, sem copiar IDs de desenho nem texto manual da instância', () => {
    const p = bound(),
      model = p.sheetTemplates![0];
    const encoded = encodeSheetTemplate(model);
    expect(JSON.parse(encoded).schema).toBe('armadurastruct.sheet-template/2');
    expect(decodeSheetTemplate(encoded)).toEqual(model);
    expect(() =>
      decodeSheetTemplate(
        JSON.stringify({
          ...JSON.parse(encoded),
          schema: 'armadurastruct.sheet-template/1',
        }),
      ),
    ).toThrow(/versão 2/);
    expect(encoded).not.toContain('drawingId');
    expect(encoded).not.toContain('manualText');
  });

  it('converte somente o texto CAD escolhido, preservando fonte, altura, alinhamento e rotação', () => {
    const model = templateFromSheet(emptyProject().sheets[0]);
    const text = {
      layer: 'SELO',
      text: '@AUTOR',
      points: [{ x: 50, y: 50 }],
      textHeight: 3,
      textRotation: 15,
      textAlign: 'center' as const,
      textFont: {
        family: 'mono',
        weight: 'bold' as const,
        style: 'italic' as const,
      },
    };
    const original = {
      ...model,
      geometry: [
        text,
        { ...text, text: 'Literal', points: [{ x: 100, y: 100 }] },
      ],
    };
    const converted = fieldFromImportedText(original, 0);
    expect(converted.geometry).toEqual([original.geometry[1]]);
    expect(converted.fields[0]).toMatchObject({
      text: '@AUTOR',
      font: 'courier',
      fontWeight: 'bold',
      fontStyle: 'italic',
      height: 3,
      align: 'center',
      rotation: 15,
    });
    expect(converted.fields[0].sealBinding).toBeUndefined();
    expect(decodeSheetTemplate(encodeSheetTemplate(converted))).toEqual(
      converted,
    );
    expect(original.geometry).toHaveLength(2);
  });
});
