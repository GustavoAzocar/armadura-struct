import { describe, expect, it } from 'vitest';
import { normalizeCad } from '../src/cad/import';
import {
  decodeProject,
  emptyProject,
  newBar,
  schedule,
} from '../src/domain/model';
import {
  composeSheet,
  modelToPaper,
  paperPrimitiveBounds,
} from '../src/domain/paper';
import { sheetSize } from '../src/domain/paperFormat';
import {
  applySheetTemplate,
  calibrateSheetTemplateGeometry,
  decodeSheetTemplate,
  duplicateSheetTemplate,
  encodeSheetTemplate,
  paperRectFromPoints,
  removeSheetTemplate,
  saveSheetTemplate,
  sheetTemplateGeometryFromMask,
  templateFromSheet,
  validateSheetTemplate,
  type SheetTemplate,
} from '../src/domain/sheetTemplates';
import {
  createSheet,
  placeDrawing,
  updatePlacement,
} from '../src/domain/sheets';
import { toCsv, toSheetDxf, toSheetPdf } from '../src/lib/exports';

function model(): SheetTemplate {
  const sheet = emptyProject().sheets[0];
  return {
    ...templateFromSheet(sheet),
    format: 'A1',
    useful: { x: 25, y: 10, width: 806, height: 574 },
    seal: { x: 660, y: 20, width: 160, height: 40 },
    fields: [
      {
        id: 'nome',
        label: 'Nome',
        box: { x: 670, y: 23, width: 90, height: 25 },
        origin: { x: 715, y: 33 },
        font: 'times',
        height: 4,
        align: 'center',
        rotation: 15,
        text: 'Pórtico 01 · Ø12',
      },
    ],
  };
}

describe('AS-12 – modelos em milímetros de papel', () => {
  it('preserva a revisão importada e incrementa somente as edições locais seguintes', () => {
    const initial = emptyProject();
    const imported = decodeSheetTemplate(
      encodeSheetTemplate({ ...model(), revision: 7 }),
    );
    const saved = saveSheetTemplate(initial, imported);
    expect(saved.sheetTemplates?.[0].revision).toBe(7);
    const applied = applySheetTemplate(saved, imported.id, [
      initial.sheets[0].id,
    ]);
    expect(applied.sheets[0].paperTemplate?.revision).toBe(7);
    const edited = saveSheetTemplate(applied, {
      ...imported,
      name: 'Revisão local',
    });
    expect(edited.sheetTemplates?.[0].revision).toBe(8);
    expect(edited.sheets[0].paperTemplate?.revision).toBe(7);
    const copy = duplicateSheetTemplate(imported, 'Cópia independente');
    expect(copy.id).not.toBe(imported.id);
    expect(copy.revision).toBe(1);
  });

  it('calibra o mesmo segmento importado em mm, cm ou m com origem não nula', () => {
    const result = [
      [4, 1],
      [5, 10],
      [6, 1000],
    ].map(([unit, mm]) => {
      const mask = normalizeCad(
        {
          header: { $INSUNITS: unit },
          entities: [
            {
              type: 'LINE',
              layer: 'PAPEL',
              vertices: [
                { x: 40 / mm, y: 10 / mm },
                { x: 440 / mm, y: 10 / mm },
              ],
            },
          ],
        },
        'padrão.dxf',
        'DXF',
      );
      const geometry = sheetTemplateGeometryFromMask(mask);
      const [a, b] = geometry[0].points;
      return calibrateSheetTemplateGeometry(geometry, a, b, 800, {
        x: 25,
        y: 10,
      })[0].points;
    });
    expect(result).toEqual(
      Array.from({ length: 3 }, () => [
        { x: 25, y: 10 },
        { x: 825, y: 10 },
      ]),
    );
    const at = { x: 40, y: 10 };
    const text = {
      layer: 'SELO',
      points: [at],
      text: 'Obra',
      textHeight: 3,
      textRotation: 23,
    };
    expect(
      calibrateSheetTemplateGeometry([text], at, { x: 440, y: 10 }, 800)[0],
    ).toMatchObject({
      points: [{ x: 0, y: 0 }],
      textHeight: 6,
      textRotation: 23,
    });
    expect(() => calibrateSheetTemplateGeometry([text], at, at, 800)).toThrow(
      /distintos/,
    );
    expect(() =>
      calibrateSheetTemplateGeometry([text], at, { x: 440, y: 10 }, -1),
    ).toThrow(/positiva/);
  });

  it('aplica uma revisão a três folhas e mantém as vistas, quadro, aço e folha fora da seleção', () => {
    let project = { ...emptyProject(), bars: [newBar('N1')] };
    for (const name of ['Folha 2', 'Folha 3', 'Fora da seleção'])
      project = createSheet(project, name).project;
    const first = project.sheets[0].id;
    const placed = placeDrawing(
      project,
      first,
      project.hierarchy.drawings[0].id,
    );
    project = updatePlacement(placed.project, placed.id, {
      origin: { x: 40, y: 100 },
      scale: 50,
    });
    const fixture = model();
    project = saveSheetTemplate(project, fixture);
    const ids = project.sheets.slice(0, 3).map((s) => s.id);
    const applied = applySheetTemplate(project, fixture.id, ids);
    expect(applySheetTemplate(applied, fixture.id, ids)).toBe(applied);
    expect(applied.hierarchy).toBe(project.hierarchy);
    expect(applied.bars).toBe(project.bars);
    expect(applied.sheets[3]).toBe(project.sheets[3]);
    expect(schedule(applied)).toEqual(schedule(project));
    expect(toCsv(applied)).toEqual(toCsv(project));
    for (const id of ids) {
      const scene = composeSheet(applied, id);
      expect(scene.size).toEqual({ width: 841, height: 594 });
      expect(scene.useful).toEqual(fixture.useful);
      expect(scene.seal).toEqual(fixture.seal);
      expect(scene.decorations.find((line) => line.text)).toMatchObject({
        text: fixture.fields[0].text,
        textRotation: 15,
      });
      expect(
        scene.decorations.some((line) => line.text?.includes('OPENSTRUCT')),
      ).toBe(false);
    }
    const view = applied.hierarchy.placements[0];
    for (const [scale, expected] of [
      [50, 20],
      [100, 10],
    ]) {
      const p = modelToPaper({ x: 0, y: 0 }, { ...view, scale });
      const q = modelToPaper({ x: 1000, y: 0 }, { ...view, scale });
      expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeCloseTo(expected);
    }
    expect(sheetSize(project.sheets[0])).toEqual({ width: 420, height: 297 });
  });

  it('preserva as revisões incorporadas e valida a persistência de catálogos e pranchas', () => {
    const previous = emptyProject();
    const sheet = previous.sheets[0].id;
    const template = model();
    let project = applySheetTemplate(
      saveSheetTemplate(previous, template),
      template.id,
      [sheet],
    );
    project = saveSheetTemplate(project, {
      ...template,
      name: 'Segunda revisão',
    });
    expect(project.sheetTemplates?.[0].revision).toBe(2);
    expect(project.sheets[0].paperTemplate?.revision).toBe(1);
    expect(decodeSheetTemplate(encodeSheetTemplate(template))).toEqual(
      validateSheetTemplate(template),
    );
    expect(() =>
      saveSheetTemplate(
        project,
        duplicateSheetTemplate(template, 'segunda revisão'),
      ),
    ).toThrow(/Já existe/);
    const duplicate = duplicateSheetTemplate(template, 'Modelo independente');
    expect(duplicate.id).not.toBe(template.id);
    expect(duplicate.fields[0].id).not.toBe(template.fields[0].id);
    const removed = removeSheetTemplate(project, template.id);
    const reopened = decodeProject(JSON.stringify(removed));
    expect(reopened.sheets[0].paperTemplate).toEqual(
      validateSheetTemplate(template),
    );
    expect(reopened.sheetTemplates).toEqual([]);
    expect(
      decodeProject(JSON.stringify(previous)).sheets[0].paperTemplate,
    ).toBeUndefined();
    const unsafe = structuredClone(reopened);
    unsafe.sheets[0].margins.left = 80;
    expect(() => decodeProject(JSON.stringify(unsafe))).toThrow(/corresponder/);
    expect(() =>
      decodeProject(JSON.stringify({ ...reopened, schema: previous.schema })),
    ).toThrow(/formato 36/);
  });

  it('recusa áreas inválidas e mede a fonte efetiva dos textos antes da gravação', () => {
    const template = model();
    expect(paperRectFromPoints({ x: 831, y: 584 }, { x: 25, y: 10 })).toEqual(
      template.useful,
    );
    expect(() => paperRectFromPoints({ x: 0, y: 0 }, { x: 1, y: 0 })).toThrow();
    expect(() =>
      validateSheetTemplate({
        ...template,
        useful: { ...template.useful, x: -1 },
      }),
    ).toThrow(/área útil/);
    const field = {
      ...template.fields[0],
      align: 'left' as const,
      origin: { x: 670, y: 33 },
      rotation: 0,
      text: 'iiiiiiiiii',
      height: 4,
      box: { x: 670, y: 23, width: 17, height: 25 },
    };
    expect(() =>
      validateSheetTemplate({ ...template, fields: [field] }),
    ).not.toThrow();
    expect(() =>
      validateSheetTemplate({
        ...template,
        fields: [{ ...field, font: 'courier' }],
      }),
    ).toThrow(/ultrapassa/);
    expect(() =>
      validateSheetTemplate({
        ...template,
        fields: [{ ...field, text: 'Ø 😀' }],
      }),
    ).toThrow(/sem suporte/);
    const original = emptyProject();
    const equivalent = {
      ...template,
      fields: [{ ...template.fields[0], text: 'Pórtico 01 · %%C12' }],
    };
    const applied = applySheetTemplate(
      saveSheetTemplate(original, equivalent),
      template.id,
      [original.sheets[0].id],
    );
    const composition = composeSheet(applied, original.sheets[0].id);
    expect(composition.issues).toEqual([]);
    const item = composition.decorations.find(
      (line) => line.text === template.fields[0].text,
    )!;
    expect(paperPrimitiveBounds(item)).toHaveLength(4);
    const pdf = new TextDecoder('latin1').decode(toSheetPdf(applied));
    expect(pdf).toContain('/MediaBox [0 0 2383.937');
    expect(pdf).toContain('/BaseFont /Times-Roman');
    expect(pdf).not.toContain('OPENSTRUCT / ARMADURASTRUCT');
  });

  it('valida a revisão incorporada antes de compor ou exportar seus textos', () => {
    const initial = emptyProject();
    const template = model();
    const p = applySheetTemplate(
      saveSheetTemplate(initial, template),
      template.id,
      [initial.sheets[0].id],
    );
    const invalid = {
      ...p,
      sheets: p.sheets.map((sheet) => ({
        ...sheet,
        paperTemplate: {
          ...sheet.paperTemplate!,
          fields: sheet.paperTemplate!.fields.map((field) => ({
            ...field,
            box: { ...field.box, width: 1 },
          })),
        },
      })),
    };
    expect(() => composeSheet(invalid, invalid.sheets[0].id)).toThrow(/caixa/);
    expect(() => toSheetPdf(invalid)).toThrow(/caixa/);
    expect(() => toSheetDxf(invalid)).toThrow(/caixa/);
  });
});
