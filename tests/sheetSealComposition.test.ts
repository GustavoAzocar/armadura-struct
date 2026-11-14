import { describe, expect, it } from 'vitest';
import { completeOwnership } from '../src/domain/hierarchy';
import {
  createScheduleLock,
  emptyProject,
  newBar,
  schedule,
} from '../src/domain/model';
import { composeSheet } from '../src/domain/paper';
import {
  defaultSheetSchedule,
  setSheetSchedule,
} from '../src/domain/sheetSchedule';
import {
  applySheetTemplate,
  saveSheetTemplate,
  templateFromSheet,
  type SheetTemplateField,
} from '../src/domain/sheetTemplates';
import {
  createSheet,
  duplicatePlacement,
  placeDrawing,
} from '../src/domain/sheets';
import { toCsv, toSheetDxf, toSheetPdf } from '../src/lib/exports';
import type { Project } from '../src/domain/types';
import type { SheetSealContent } from '../src/domain/sheetSealComposition';

const field: SheetTemplateField = {
  id: 'campo',
  label: 'Campo de teste',
  box: { x: 20, y: 20, width: 155, height: 60 },
  origin: { x: 25, y: 65 },
  text: 'Texto estático',
  font: 'courier',
  height: 3,
  align: 'left',
  rotation: 0,
};

function withSeal(
  p: Project,
  sheetId: string,
  patch: Partial<SheetTemplateField> = {},
) {
  const sheet = p.sheets.find((entry) => entry.id === sheetId)!;
  const template = {
    ...templateFromSheet(sheet),
    fields: [{ ...field, ...patch }],
  };
  return {
    p: applySheetTemplate(saveSheetTemplate(p, template), template.id, [
      sheetId,
    ]),
    draft: (
      token: string,
      extra?: Partial<SheetSealContent>,
    ): SheetSealContent => ({
      templateId: template.id,
      definitions: new Map([[field.id, { field: token }]]),
      ...extra,
    }),
  };
}

describe('AS-13 · composição do selo em memória', () => {
  it('reusa a mesma resolução na tela, no PDF e no DXF de uma folha selecionada', () => {
    const base = { ...emptyProject(), name: 'Edifício São José' };
    const second = createSheet(base, 'Cortes');
    const { p, draft } = withSeal(second.project, second.id);
    const data = new Map([[second.id, draft('@NUMERO')]]);
    const page = composeSheet(p, second.id, false, data.get(second.id));
    const line = page.decorations.find((item) => item.text === '2');
    expect(line).toMatchObject({
      points: [field.origin],
      textHeight: 3,
      textFont: { family: 'mono' },
    });
    expect(page.issues).toEqual([]);
    expect(toSheetDxf(p, [second.id], data)).toMatch(/\r?\n1\r?\n2\r?\n/);
    expect(
      Buffer.from(toSheetPdf(p, [second.id], data)).toString('latin1'),
    ).toContain('(2) Tj');
    expect(
      composeSheet(p, second.id).decorations.some(
        (item) => item.text === field.text,
      ),
    ).toBe(true);
  });

  it('mantém quebras, fonte e rotação; sinaliza texto que ultrapassa a caixa', () => {
    const base = { ...emptyProject(), notes: 'Nádia\n\nEngenharia' };
    const sheet = base.sheets[0].id;
    const rotated = withSeal(base, sheet, {
      text: '',
      rotation: 90,
      origin: { x: 45, y: 27 },
    });
    const data = rotated.draft('@NOTAS', {
      bindings: [
        {
          templateId: rotated.draft('@NOTAS').templateId,
          fieldId: field.id,
          source: { kind: 'project' },
        },
      ],
    });
    const page = composeSheet(rotated.p, sheet, false, data);
    const lines = page.decorations.filter((item) => item.text);
    expect(lines.map((item) => item.text)).toEqual(['Nádia', 'Engenharia']);
    expect(
      lines.every(
        (item) => item.textRotation === 90 && item.textFont?.family === 'mono',
      ),
    ).toBe(true);
    expect(lines[1].points[0].x).toBeCloseTo(52.8);
    expect(lines[1].points[0].y).toBeCloseTo(27);
    expect(page.issues).toEqual([]);

    const tight = withSeal({ ...base, name: 'Edifício Estrutural' }, sheet, {
      text: '',
      box: { x: 20, y: 20, width: 25, height: 7 },
      origin: { x: 25, y: 23 },
    });
    const tightData = tight.draft('@PROJETO');
    expect(
      composeSheet(tight.p, sheet, false, tightData).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'seal-field-overflow',
        fieldId: field.id,
      }),
    );
    expect(() =>
      toSheetDxf(tight.p, [sheet], new Map([[sheet, tightData]])),
    ).toThrow(/Campo de teste/);
    expect(() =>
      toSheetPdf(tight.p, [sheet], new Map([[sheet, tightData]])),
    ).toThrow(/Campo de teste/);
  });

  it('quebra por largura usando a fonte efetiva e preserva texto literal', () => {
    const base = { ...emptyProject(), name: 'iiii iiii' };
    const sheet = base.sheets[0].id;
    const input = {
      text: '',
      box: { x: 20, y: 20, width: 15, height: 16 },
      origin: { x: 21, y: 30 },
    };
    const mono = withSeal(base, sheet, input);
    const sans = withSeal(base, sheet, { ...input, font: 'helvetica' });
    expect(
      composeSheet(
        mono.p,
        sheet,
        false,
        mono.draft('@PROJETO'),
      ).decorations.flatMap((item) => (item.text ? [item.text] : [])),
    ).toEqual(['iiii', 'iiii']);
    expect(
      composeSheet(
        sans.p,
        sheet,
        false,
        sans.draft('@PROJETO'),
      ).decorations.flatMap((item) => (item.text ? [item.text] : [])),
    ).toEqual(['iiii iiii']);
    const invalid = { ...mono.p, name: 'Sinal %%c' };
    const bad = composeSheet(invalid, sheet, false, mono.draft('@PROJETO'));
    expect(bad.issues).toContainEqual(
      expect.objectContaining({
        code: 'seal-field-text-encoding',
        fieldId: field.id,
      }),
    );
    expect(bad.decorations.some((item) => item.text)).toBe(false);
  });

  it('mostra agregados incompletos como avisos e indica origens ou campos quebrados', () => {
    const base = emptyProject();
    const sheet = base.sheets[0].id;
    const drawings = [
      { ...base.hierarchy.drawings[0], author: 'Lúcia' },
      { ...base.hierarchy.drawings[0], id: 'outro', author: undefined },
    ];
    let source = { ...base, hierarchy: { ...base.hierarchy, drawings } };
    for (const drawing of drawings)
      source = placeDrawing(source, sheet, drawing.id).project;
    const { p, draft } = withSeal(source, sheet);
    const content = draft('@AUTOR');
    const author = { templateId: content.templateId, fieldId: field.id };
    const aggregate = composeSheet(p, sheet, false, {
      ...content,
      bindings: [{ ...author, source: { kind: 'aggregate' } }],
    });
    expect(aggregate.notices).toContainEqual(
      expect.objectContaining({
        code: 'seal-field-partial',
        fieldId: field.id,
      }),
    );
    expect(aggregate.issues.some((issue) => issue.fieldId === field.id)).toBe(
      false,
    );
    expect(
      composeSheet(p, sheet, false, {
        ...content,
        bindings: [
          { ...author, source: { kind: 'drawing', drawingId: 'removido' } },
        ],
      }).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'seal-field-missing-source',
        fieldId: field.id,
      }),
    );
    expect(
      composeSheet(p, sheet, false, draft('@OUTRO')).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: 'seal-field-unknown-field',
        fieldId: field.id,
      }),
    );
  });

  it('usa o peso físico da folha com ou sem quadro e mantém a barreira da RA', () => {
    const base = emptyProject();
    const sheet = base.sheets[0].id;
    const length = (100 * 4 * 1000) / (Math.PI * 0.01 ** 2 * 7850);
    const bar = {
      ...newBar('N1'),
      diameter: 10,
      quantity: 1,
      points: [
        { x: 0, y: 0 },
        { x: length, y: 0 },
      ],
    };
    let project = completeOwnership({ ...base, bars: [bar] });
    const placement = placeDrawing(
      project,
      sheet,
      project.hierarchy.drawings[0].id,
    );
    project = duplicatePlacement(placement.project, placement.id).project;
    const { p, draft } = withSeal(project, sheet);
    const content = draft('@PESO_ACO');
    const before = schedule(p);
    const net = composeSheet(p, sheet, false, content);
    expect(
      net.decorations.some((item) => item.text?.includes('100,0 kg')),
    ).toBe(true);
    expect(net.decorations.some((item) => item.text?.includes('0%'))).toBe(
      true,
    );

    const withTable = setSheetSchedule(p, sheet, defaultSheetSchedule());
    const increased = composeSheet(withTable, sheet, false, content);
    expect(
      increased.decorations.some((item) => item.text?.includes('110,0 kg')),
    ).toBe(true);
    expect(
      increased.decorations.some((item) => item.text?.includes('10%')),
    ).toBe(true);
    expect(
      increased.schedule?.lines.some((item) => item.text === '110,0'),
    ).toBe(true);
    expect(schedule(withTable)).toEqual(before);
    expect(toCsv(withTable)).toBe(toCsv(p));

    const stale = {
      ...p,
      scheduleLock: createScheduleLock(p),
      bars: p.bars.map((entry) => ({ ...entry, quantity: entry.quantity + 1 })),
    };
    expect(
      composeSheet(stale, sheet, false, content).decorations.some(
        (item) => item.text,
      ),
    ).toBe(false);
    const manual = {
      ...content,
      bindings: [
        {
          templateId: content.templateId,
          fieldId: field.id,
          manualText: '100 kg conferidos',
        },
      ],
    };
    const reviewed = composeSheet(stale, sheet, false, manual);
    expect(
      reviewed.decorations.some((item) => item.text === '100 kg conferidos'),
    ).toBe(true);
    expect(reviewed.notices).toContainEqual(
      expect.objectContaining({ code: 'seal-field-manual' }),
    );
    expect(reviewed.issues).toContainEqual(
      expect.objectContaining({ code: 'schedule-stale' }),
    );
    expect(() =>
      toSheetPdf(stale, [sheet], new Map([[sheet, manual]])),
    ).toThrow(/desatualizada/);
    expect(() =>
      toSheetDxf(stale, [sheet], new Map([[sheet, manual]])),
    ).toThrow(/desatualizada/);
  });
});
